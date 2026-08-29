"""RAG (Retrieval-Augmented Generation) service for Sertex.

Handles:
- Chunking of extracted document text (token-based via tiktoken).
- Embedding via OpenAI `text-embedding-3-small` through the Emergent proxy.
- Cosine similarity search over MongoDB `file_chunks` collection.
- Prompt block builder to inject top-K chunks into the chat LLM system prompt.
"""
import os
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

import httpx
import numpy as np
import tiktoken

logger = logging.getLogger(__name__)

# ---- Configuration -------------------------------------------------------
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
CHUNK_TOKENS = 500          # approx tokens per chunk
CHUNK_OVERLAP = 50          # token overlap between adjacent chunks
MAX_CHUNKS_PER_FILE = 400   # hard safety cap
EMBED_BATCH = 64            # inputs per embedding request
TOP_K_DEFAULT = 5
SIMILARITY_THRESHOLD = 0.30 # minimum cosine similarity to include a chunk

_PROXY_URL = os.environ.get(
    "INTEGRATION_PROXY_URL",
    "https://integrations.emergentagent.com",
).rstrip("/")
_EMBED_ENDPOINT = f"{_PROXY_URL}/llm/openai/v1/embeddings"

_ENCODER = tiktoken.get_encoding("cl100k_base")


def _get_key() -> str:
    key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    return key


# ---- Chunking ------------------------------------------------------------
def chunk_text(
    text: str,
    tokens_per_chunk: int = CHUNK_TOKENS,
    overlap: int = CHUNK_OVERLAP,
) -> List[str]:
    """Split text into overlapping token-sized chunks.

    Uses tiktoken cl100k_base for reasonable token estimation across languages.
    Returns list of stripped, non-empty chunks.
    """
    if not text or not text.strip():
        return []
    tokens = _ENCODER.encode(text)
    if not tokens:
        return []

    step = max(1, tokens_per_chunk - overlap)
    chunks: List[str] = []
    for start in range(0, len(tokens), step):
        window = tokens[start : start + tokens_per_chunk]
        if not window:
            break
        piece = _ENCODER.decode(window).strip()
        if piece:
            chunks.append(piece)
        if len(chunks) >= MAX_CHUNKS_PER_FILE:
            logger.warning("Chunk cap reached (%d); truncating remainder", MAX_CHUNKS_PER_FILE)
            break
        if start + tokens_per_chunk >= len(tokens):
            break
    return chunks


# ---- Embedding calls -----------------------------------------------------
async def _embed_batch(texts: List[str]) -> List[List[float]]:
    """Call the Emergent OpenAI-proxy embeddings endpoint for a list of texts."""
    if not texts:
        return []
    key = _get_key()
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(
            _EMBED_ENDPOINT,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={"model": EMBEDDING_MODEL, "input": texts},
        )
        if r.status_code != 200:
            snippet = r.text[:300]
            raise RuntimeError(
                f"Embedding call failed ({r.status_code}): {snippet}"
            )
        data = r.json()
        # Data comes back in the same order as input
        return [item["embedding"] for item in data["data"]]


async def embed_texts(texts: List[str]) -> List[List[float]]:
    """Embed a (possibly large) list of texts in batches."""
    out: List[List[float]] = []
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        vectors = await _embed_batch(batch)
        out.extend(vectors)
    return out


async def embed_query(query: str) -> List[float]:
    """Embed a single query string."""
    vectors = await _embed_batch([query])
    return vectors[0] if vectors else []


# ---- MongoDB storage -----------------------------------------------------
async def ensure_indexes(db) -> None:
    """Idempotent index creation for the file_chunks collection."""
    await db.file_chunks.create_index("user_id")
    await db.file_chunks.create_index("file_id")
    await db.file_chunks.create_index([("user_id", 1), ("file_id", 1)])


async def delete_chunks_for_file(db, file_id: str, user_id: str) -> int:
    r = await db.file_chunks.delete_many({"file_id": file_id, "user_id": user_id})
    return r.deleted_count


async def count_chunks(db, user_id: str, file_id: Optional[str] = None) -> int:
    q: Dict[str, Any] = {"user_id": user_id}
    if file_id:
        q["file_id"] = file_id
    return await db.file_chunks.count_documents(q)


async def index_file(
    db,
    *,
    file_id: str,
    user_id: str,
    filename: str,
    text: str,
) -> Dict[str, Any]:
    """Chunk + embed + persist. Returns {status, chunks, tokens}."""
    if not text or not text.strip():
        return {"status": "empty", "chunks": 0}

    # Wipe stale chunks so re-index is idempotent
    await delete_chunks_for_file(db, file_id, user_id)

    chunks = chunk_text(text)
    if not chunks:
        return {"status": "empty", "chunks": 0}

    try:
        vectors = await embed_texts(chunks)
    except Exception as e:
        logger.exception("Embedding failed for file %s", file_id)
        return {"status": "failed", "chunks": 0, "error": str(e)[:300]}

    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for idx, (chunk, vec) in enumerate(zip(chunks, vectors)):
        docs.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "file_id": file_id,
            "filename": filename,
            "chunk_index": idx,
            "text": chunk,
            "embedding": vec,
            "created_at": now,
        })
    if docs:
        await db.file_chunks.insert_many(docs)
    return {"status": "ok", "chunks": len(docs)}


# ---- Similarity search ---------------------------------------------------
def _cosine_topk(
    query_vec: List[float],
    matrix: np.ndarray,
    k: int,
) -> List[tuple]:
    """Return list of (index, score) for top-k cosine similarities."""
    if matrix.size == 0:
        return []
    q = np.asarray(query_vec, dtype=np.float32)
    qn = np.linalg.norm(q)
    if qn == 0:
        return []
    q = q / qn
    # Normalise rows once
    row_norms = np.linalg.norm(matrix, axis=1)
    row_norms[row_norms == 0] = 1.0
    normed = matrix / row_norms[:, None]
    sims = normed @ q
    # Argpartition for speed on large N
    kk = min(k, sims.shape[0])
    top_idx = np.argpartition(-sims, kk - 1)[:kk]
    top_idx = top_idx[np.argsort(-sims[top_idx])]
    return [(int(i), float(sims[i])) for i in top_idx]


async def search(
    db,
    user_id: str,
    query: str,
    k: int = TOP_K_DEFAULT,
    threshold: float = SIMILARITY_THRESHOLD,
) -> List[Dict[str, Any]]:
    """Return top-k chunks matching the query for the given user.

    Each item: {file_id, filename, chunk_index, text, score}
    """
    if not query or not query.strip():
        return []

    # Fetch all chunks for the user (fine for personal use; scale later with
    # Atlas Vector Search or per-file candidate pre-filter).
    cursor = db.file_chunks.find(
        {"user_id": user_id},
        {"_id": 0, "embedding": 1, "text": 1, "file_id": 1, "filename": 1, "chunk_index": 1},
    )
    docs = await cursor.to_list(length=20000)
    if not docs:
        return []

    try:
        qvec = await embed_query(query)
    except Exception as e:
        logger.warning("Query embed failed: %s", e)
        return []
    if not qvec:
        return []

    matrix = np.asarray([d["embedding"] for d in docs], dtype=np.float32)
    top = _cosine_topk(qvec, matrix, k)
    results: List[Dict[str, Any]] = []
    for idx, score in top:
        if score < threshold:
            continue
        d = docs[idx]
        results.append({
            "file_id": d["file_id"],
            "filename": d.get("filename", ""),
            "chunk_index": d.get("chunk_index", 0),
            "text": d["text"],
            "score": round(score, 4),
        })
    return results


def build_rag_prompt_block(chunks: List[Dict[str, Any]]) -> str:
    """Format retrieved chunks into a system-prompt suffix."""
    if not chunks:
        return ""
    parts = [
        "\n\n[KULLANICI BİLGİ BANKASI — YÜKLEDİĞİ DOSYALARDAN İLGİLİ PARÇALAR]",
        "Aşağıdaki parçalar kullanıcının yüklediği dosyalardan seçildi. "
        "Cevabında bu bilgileri kullan. Bu bilgilere dayandığında kaynağı belirt "
        "(örn: 'X.pdf'den'). Bilgi eksikse tahmin yürütme; 'yüklediğin dosyalarda "
        "bu bilgi yok efendim' de.",
    ]
    for i, c in enumerate(chunks, 1):
        parts.append(
            f"\n--- Kaynak {i}: {c['filename']} (parça #{c['chunk_index']}, "
            f"benzerlik={c['score']}) ---\n{c['text']}"
        )
    parts.append("\n[BİLGİ BANKASI SONU]\n")
    return "\n".join(parts)
