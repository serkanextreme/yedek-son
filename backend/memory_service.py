"""Long-term memory service for Sertex.

Stores user-specific facts (preferences, personal info, work context) and
injects them into chat prompts so Sertex "remembers" the user across sessions.

Storage: MongoDB collection `memories`
Schema:
    id, user_id, content, category, source, importance, created_at, updated_at

Categories: personal | preference | work | family | health | project | other
Source:     auto (LLM-extracted) | manual (user command)
Importance: 1-5 (higher = more relevant for prompt injection)
"""
import os
import re
import uuid
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from emergentintegrations.llm.chat import LlmChat, UserMessage

# Ensure .env is loaded even if this module is imported before server.py runs load_dotenv()
load_dotenv()

logger = logging.getLogger(__name__)


def _get_llm_key() -> str:
    """Read the Emergent LLM key at call time — env may be loaded after import."""
    return os.environ.get("EMERGENT_LLM_KEY", "")

# Category whitelist
VALID_CATEGORIES = {"personal", "preference", "work", "family", "health", "project", "other"}


class Memory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    content: str
    category: str = "other"
    source: str = "manual"  # 'auto' | 'manual'
    importance: int = 3  # 1..5
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class MemoryCreate(BaseModel):
    content: str
    category: str = "other"
    importance: int = 3


class MemoryUpdate(BaseModel):
    content: Optional[str] = None
    category: Optional[str] = None
    importance: Optional[int] = None


# ---------------------------------------------------------------
# Manual memory triggers — detect "hatırla" / "remember" patterns
# ---------------------------------------------------------------
MANUAL_TRIGGERS_TR = [
    r"^(sertex[,\s]+)?(bunu\s+)?hatırla[,:\s]*(.+)$",
    r"^(sertex[,\s]+)?(şunu\s+)?hatırlaman?\s+gerekli?[,:\s]*(.+)$",
    r"^(sertex[,\s]+)?not\s+et[,:\s]*(.+)$",
    r"^(sertex[,\s]+)?aklında\s+tut[,:\s]*(.+)$",
    r"^(sertex[,\s]+)?kaydet[,:\s]*(.+)$",
]

MANUAL_TRIGGERS_EN = [
    r"^(sertex[,\s]+)?remember\s+(this[,:\s]+)?(.+)$",
    r"^(sertex[,\s]+)?note\s+that[,:\s]*(.+)$",
    r"^(sertex[,\s]+)?keep\s+in\s+mind[,:\s]*(.+)$",
]


def detect_manual_memory(text: str) -> Optional[str]:
    """If user text is a manual 'remember this' command, return the content to save."""
    stripped = text.strip()
    for pattern in MANUAL_TRIGGERS_TR + MANUAL_TRIGGERS_EN:
        m = re.match(pattern, stripped, re.IGNORECASE)
        if m:
            content = m.groups()[-1].strip()
            if len(content) >= 3:
                return content
    return None


# ---------------------------------------------------------------
# Forget / delete triggers — detect "unut" / "forget" patterns
# ---------------------------------------------------------------
FORGET_TRIGGERS_TR = [
    r"^(sertex[,\s]+)?(bunu\s+)?unut[,:\s]*(.+)$",
    r"^(sertex[,\s]+)?(şunu\s+)?hatırlamayı\s+bırak[,:\s]*(.+)$",
    r"^(sertex[,\s]+)?(bunu\s+)?sil[,:\s]*(.+)$",
]

FORGET_TRIGGERS_EN = [
    r"^(sertex[,\s]+)?forget\s+(this[,:\s]+)?(.+)$",
]


def detect_forget_memory(text: str) -> Optional[str]:
    stripped = text.strip()
    for pattern in FORGET_TRIGGERS_TR + FORGET_TRIGGERS_EN:
        m = re.match(pattern, stripped, re.IGNORECASE)
        if m:
            keyword = m.groups()[-1].strip()
            if len(keyword) >= 2:
                return keyword
    return None


# ---------------------------------------------------------------
# LLM-based automatic memory extraction
# ---------------------------------------------------------------
EXTRACTION_PROMPT = """Sen bir hafıza çıkarım motorusun. Kullanıcının mesajını analiz et ve UZUN SÜRELİ olarak hatırlanmaya değer kişisel bilgiler var mı bul.

Aşağıdaki türdeki bilgileri çıkar (varsa):
- Kişisel: isim, yaş, meslek, yaşadığı şehir, aile bilgisi
- Tercih: sevdiği/sevmediği şeyler, çalışma stili, iletişim tarzı
- İş/Proje: mevcut projeleri, hedefleri, sorumlulukları
- Sağlık: kronik durumlar, alerjiler, diyet (kullanıcı paylaştıysa)

ÇOK ÖNEMLİ:
- Sadece KALICI/UZUN SÜRELİ bilgileri çıkar. Anlık durum, tek seferlik sorular, geçici konular = ÇIKARMA
- Kesin olmadığın şeyleri çıkarma
- Hiç bilgi yoksa boş liste döndür
- Her bilgiyi tek cümle, kısa ve öz yaz
- Türkçe cevap ver

Sadece geçerli JSON formatında yanıtla, başka açıklama yapma:
{"memories": [{"content": "...", "category": "personal|preference|work|family|health|project|other", "importance": 1-5}]}

Örnek 1:
Kullanıcı: "Ben Serkan, CAD-CAM operatörüyüm ve İstanbul'da yaşıyorum."
Cevap: {"memories": [{"content": "Kullanıcının adı Serkan", "category": "personal", "importance": 5}, {"content": "Mesleği CAD-CAM operatörü", "category": "work", "importance": 5}, {"content": "İstanbul'da yaşıyor", "category": "personal", "importance": 4}]}

Örnek 2:
Kullanıcı: "Bugün hava nasıl?"
Cevap: {"memories": []}

Örnek 3:
Kullanıcı: "Koyu tema seviyorum, uzun cevaplardan sıkılıyorum."
Cevap: {"memories": [{"content": "Koyu tema tercih ediyor", "category": "preference", "importance": 3}, {"content": "Kısa ve öz cevap tercih ediyor", "category": "preference", "importance": 4}]}
"""


async def extract_memories_from_text(text: str, session_id: str) -> List[dict]:
    """Use LLM to extract memory-worthy facts from user text.
    Returns list of dicts: [{content, category, importance}]
    Never raises — returns [] on any failure.
    """
    if not _get_llm_key():
        return []
    if len(text.strip()) < 8:
        return []

    try:
        chat_client = LlmChat(
            api_key=_get_llm_key(),
            session_id=f"mem-extract-{session_id}",
            system_message=EXTRACTION_PROMPT,
        ).with_model("openai", "gpt-5.2")

        response = await chat_client.send_message(
            UserMessage(text=f"Kullanıcı mesajı: {text}\n\nÇıkarılacak hafızaları JSON olarak ver:")
        )
        response_text = str(response).strip()

        # Extract JSON from response (LLM might wrap in markdown or add prose)
        json_match = re.search(r'\{[\s\S]*"memories"[\s\S]*\}', response_text)
        if not json_match:
            return []
        data = json.loads(json_match.group(0))
        memories = data.get("memories", [])
        # Validate + clean
        clean = []
        for m in memories:
            if not isinstance(m, dict):
                continue
            content = str(m.get("content", "")).strip()
            if len(content) < 3 or len(content) > 300:
                continue
            category = m.get("category", "other")
            if category not in VALID_CATEGORIES:
                category = "other"
            importance = m.get("importance", 3)
            try:
                importance = max(1, min(5, int(importance)))
            except (TypeError, ValueError):
                importance = 3
            clean.append({
                "content": content,
                "category": category,
                "importance": importance,
            })
        return clean
    except Exception as e:
        logger.warning(f"Memory extraction failed: {e}")
        return []


# ---------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------
async def save_memory(db, user_id: str, content: str, category: str = "other",
                      source: str = "manual", importance: int = 3) -> Memory:
    """Save a memory. If similar content already exists, update importance instead."""
    # Dedupe: check for very similar content (case-insensitive substring)
    normalized = content.strip().lower()
    if not normalized:
        raise ValueError("Empty content")
    if category not in VALID_CATEGORIES:
        category = "other"
    importance = max(1, min(5, importance))

    # Look for near-duplicate
    existing = await db.memories.find(
        {"user_id": user_id}, {"_id": 0}
    ).to_list(length=500)
    for e in existing:
        e_norm = e.get("content", "").strip().lower()
        if not e_norm:
            continue
        # Exact match or substantial overlap
        if e_norm == normalized or (
            len(e_norm) > 10 and len(normalized) > 10 and (
                e_norm in normalized or normalized in e_norm
            )
        ):
            # Update: bump importance and updated_at
            new_importance = max(e.get("importance", 3), importance)
            await db.memories.update_one(
                {"id": e["id"]},
                {"$set": {
                    "importance": new_importance,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
            e["importance"] = new_importance
            return Memory(**{k: v for k, v in e.items() if k in Memory.model_fields})

    memory = Memory(
        content=content.strip(),
        category=category,
        source=source,
        importance=importance,
    )
    doc = memory.model_dump()
    doc["user_id"] = user_id
    await db.memories.insert_one(doc)
    return memory


async def list_memories(db, user_id: str) -> List[Memory]:
    docs = await db.memories.find({"user_id": user_id}, {"_id": 0}).to_list(length=1000)
    # Sort: importance DESC, then updated_at DESC (single pass with tuple key)
    docs.sort(
        key=lambda d: (-(d.get("importance") or 0), d.get("updated_at") or ""),
    )
    return [Memory(**{k: v for k, v in d.items() if k in Memory.model_fields}) for d in docs]


async def get_top_memories_for_prompt(db, user_id: str, limit: int = 20) -> List[str]:
    """Return top-N most important memories as plain content strings for prompt injection."""
    docs = await db.memories.find({"user_id": user_id}, {"_id": 0, "content": 1, "importance": 1, "category": 1}).to_list(length=200)
    docs.sort(key=lambda d: d.get("importance") or 0, reverse=True)
    return [d["content"] for d in docs[:limit]]


async def update_memory(db, user_id: str, mem_id: str, update: MemoryUpdate) -> Optional[Memory]:
    doc = await db.memories.find_one({"id": mem_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        return None
    patch = {}
    if update.content is not None:
        content = update.content.strip()
        if len(content) < 3 or len(content) > 300:
            raise ValueError("Content length must be 3-300 chars")
        patch["content"] = content
    if update.category is not None:
        if update.category not in VALID_CATEGORIES:
            raise ValueError("Invalid category")
        patch["category"] = update.category
    if update.importance is not None:
        patch["importance"] = max(1, min(5, int(update.importance)))
    if patch:
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.memories.update_one({"id": mem_id, "user_id": user_id}, {"$set": patch})
    fresh = await db.memories.find_one({"id": mem_id, "user_id": user_id}, {"_id": 0})
    return Memory(**{k: v for k, v in fresh.items() if k in Memory.model_fields})


async def delete_memory(db, user_id: str, mem_id: str) -> int:
    r = await db.memories.delete_one({"id": mem_id, "user_id": user_id})
    return r.deleted_count


async def delete_memories_matching(db, user_id: str, keyword: str) -> int:
    """Delete all memories whose content contains the keyword (case-insensitive)."""
    kw = keyword.strip().lower()
    if not kw:
        return 0
    docs = await db.memories.find({"user_id": user_id}, {"_id": 0, "id": 1, "content": 1}).to_list(length=1000)
    ids_to_delete = [d["id"] for d in docs if kw in (d.get("content", "") or "").lower()]
    if not ids_to_delete:
        return 0
    r = await db.memories.delete_many({"id": {"$in": ids_to_delete}, "user_id": user_id})
    return r.deleted_count


def build_memory_system_prompt(memories: List[str], username: str = "") -> str:
    """Build a system-prompt snippet from a list of memory contents."""
    if not memories:
        return ""
    lines = "\n".join(f"- {m}" for m in memories)
    return (
        f"\n\n[Kullanıcı hakkında bildiklerin — bunları doğal bir şekilde konuşmana yansıt, "
        f"tek tek tekrarlama, sadece bağlam olarak kullan]:\n{lines}\n"
    )
