"""Sertex — Chat router (Faz 9 CP4.6 refactor, 2026-07-26).

Extracted from server.py. Hosts the primary conversational endpoint —
POST /api/chat — which orchestrates:
    * manual "hafızama kaydet …" / "unut …" triggers (memory_service)
    * per-user memory injection into the system prompt
    * user-scoped RAG search (rag_service)
    * GPT-5.2 call via LlmChat (Emergent LLM key)
    * inline chart intent detection (chat_chart_service)
    * fire-and-forget auto-extraction of new memories

Factory pattern mirrors every other router in `/app/backend/routers/` so
`server.py` just mounts it via `app.include_router(build_chat_router(...),
prefix="/api")`. Behaviour is intentionally byte-identical to the previous
in-line implementation — no logic changes, only relocation.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from emergentintegrations.llm.chat import LlmChat, UserMessage

from memory_service import (
    detect_manual_memory,
    detect_forget_memory,
    extract_memories_from_text,
    save_memory,
    get_top_memories_for_prompt,
    delete_memories_matching,
    build_memory_system_prompt,
)
from rag_service import (
    search as rag_search,
    build_rag_prompt_block,
)
from chat_chart_service import try_generate_chat_chart

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Models — kept local to the router. Other modules that historically used
# these types (nothing at time of writing) can import them from here.
# ---------------------------------------------------------------------------
class ChatChart(BaseModel):
    """Inline chart embedded in an assistant message."""
    type: str = "bar"
    title: Optional[str] = None
    x_label: Optional[str] = None
    y_label: Optional[str] = None
    sheet: Optional[str] = None
    filename: Optional[str] = None
    data: List[Dict[str, Any]] = Field(default_factory=list)


class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    conversation_id: str
    role: str  # 'user' | 'assistant'
    content: str
    chart: Optional[ChatChart] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Conversation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = "Yeni Sohbet"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    language: str = "tr"  # 'tr' | 'en'


class RagSource(BaseModel):
    file_id: str
    filename: str
    chunk_index: int
    score: float


class ChatResponse(BaseModel):
    conversation_id: str
    user_message: Message
    assistant_message: Message
    sources: List[RagSource] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
SYSTEM_PROMPT_TR = (
    "Sen Sertex'sin — kullanıcının kişisel yapay zeka asistanı. "
    "Kullanıcıya 'efendim' diye hitap edebilirsin. "
    "Kısa, kesin, zeki ve hafif esprili cevaplar ver. Cevapların doğal, konuşma dilinde olsun. "
    "Kullanıcı Türkçe konuşuyor, sen de Türkçe cevap ver. Gereksiz uzun paragraflardan kaçın; "
    "genellikle 1-3 cümle yeterli, ama teknik açıklama gerekliyse daha uzun olabilir. "
    "Kendini tanıtman istenirse Sertex olduğunu söyle, başka bir isim kullanma. "
    "Emoji kullanma."
)

SYSTEM_PROMPT_EN = (
    "You are Sertex — the user's personal AI assistant. "
    "Address the user as 'sir' occasionally. "
    "Give concise, precise, intelligent and slightly witty answers. Keep it conversational. "
    "Usually 1-3 sentences unless technical detail is required. "
    "When asked to introduce yourself, always say Sertex — never use any other name. "
    "No emojis."
)


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------
def build_chat_router(db, licensed_user, emergent_llm_key: Optional[str]):
    """Return an APIRouter exposing POST /chat.

    Byte-identical to the previous server.py implementation aside from
    receiving `db`, `licensed_user`, and the LLM key as arguments instead
    of resolving them from module globals.
    """
    router = APIRouter()

    async def _resolve_base_prompt(language: str) -> str:
        """Admin, `system_settings.global` üzerinden Sertex'in sistem promptunu
        özelleştirebilir. Boş/eksikse yerleşik varsayılana düşer."""
        try:
            doc = await db.system_settings.find_one({"key": "global"}, {"_id": 0})
        except Exception:
            doc = None
        if doc:
            key = "chat_system_prompt_tr" if language == "tr" else "chat_system_prompt_en"
            val = (doc.get(key) or "").strip()
            if val:
                return val
        return SYSTEM_PROMPT_TR if language == "tr" else SYSTEM_PROMPT_EN

    @router.post("/chat", response_model=ChatResponse)
    async def chat(
        req: ChatRequest,
        background_tasks: BackgroundTasks,
        user: dict = Depends(licensed_user),
    ):
        if not emergent_llm_key:
            raise HTTPException(status_code=500, detail="LLM key not configured")

        # ---- MEMORY: manual triggers (before LLM call) --------------------
        manual_content = detect_manual_memory(req.message)
        forget_keyword = detect_forget_memory(req.message)
        memory_action_message = None  # optional short direct reply

        if manual_content:
            try:
                saved = await save_memory(
                    db, user["id"], manual_content,
                    category="other", source="manual", importance=4,
                )
                memory_action_message = f"Tamam efendim, hafızama kaydettim: \"{saved.content}\""
            except Exception as e:
                logger.warning(f"Manual memory save failed: {e}")

        elif forget_keyword:
            try:
                n = await delete_memories_matching(db, user["id"], forget_keyword)
                if n > 0:
                    memory_action_message = f"Tamam efendim, \"{forget_keyword}\" ile ilgili {n} hafıza kaydını sildim."
                else:
                    memory_action_message = f"Efendim, \"{forget_keyword}\" ile ilgili bir hafıza bulamadım."
            except Exception as e:
                logger.warning(f"Forget memory failed: {e}")

        # Get or create conversation
        if req.conversation_id:
            conv_doc = await db.conversations.find_one(
                {"id": req.conversation_id, "user_id": user["id"]}, {"_id": 0}
            )
            if not conv_doc:
                raise HTTPException(status_code=404, detail="Conversation not found")
            conversation_id = req.conversation_id
        else:
            title = req.message[:40] + ("..." if len(req.message) > 40 else "")
            conv = Conversation(title=title)
            conv_doc = conv.model_dump()
            conv_doc["user_id"] = user["id"]
            await db.conversations.insert_one(conv_doc)
            conversation_id = conv.id

        # Load prior messages for context
        prior = await db.messages.find(
            {"conversation_id": conversation_id}, {"_id": 0}
        ).sort("created_at", 1).to_list(length=200)

        # ---- MEMORY: inject top-N memories into the system prompt --------
        top_memories = await get_top_memories_for_prompt(db, user["id"], limit=25)
        base_prompt = await _resolve_base_prompt(req.language)
        memory_snippet = build_memory_system_prompt(top_memories, username=user.get("username", ""))
        system_prompt = base_prompt + memory_snippet

        # ---- RAG: retrieve relevant chunks from user's indexed files -----
        rag_chunks: List[dict] = []
        if not manual_content and not forget_keyword:
            try:
                rag_chunks = await rag_search(db, user["id"], req.message, k=5)
                if rag_chunks:
                    system_prompt += build_rag_prompt_block(rag_chunks)
            except Exception as e:
                logger.warning(f"RAG search failed: {e}")
                rag_chunks = []

        # If it was a manual memory command, short-circuit the LLM call with a direct reply
        if memory_action_message:
            assistant_text = memory_action_message
        else:
            chat_client = LlmChat(
                api_key=emergent_llm_key,
                session_id=conversation_id,
                system_message=system_prompt,
            ).with_model("openai", "gpt-5.2")

            if prior:
                history_snippets = "\n".join(
                    [f"{m['role'].upper()}: {m['content']}" for m in prior[-20:]]
                )
                context_message = (
                    f"[Önceki konuşma bağlamı — sadece hatırlaman için, cevaplama]\n{history_snippets}\n\n"
                    f"[Yeni kullanıcı mesajı]\n{req.message}"
                )
            else:
                context_message = req.message

            try:
                assistant_text = await chat_client.send_message(UserMessage(text=context_message))
            except Exception as e:
                logger.error(f"LLM error: {e}")
                raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

        # Persist both messages
        user_msg = Message(conversation_id=conversation_id, role="user", content=req.message)

        # ---- CHART-IN-CHAT: detect intent & try to build an inline chart ---
        inline_chart = None
        if not manual_content and not forget_keyword:
            try:
                inline_chart = await try_generate_chat_chart(db, user["id"], req.message)
            except Exception as e:
                logger.warning(f"Chat chart generation failed: {e}")
                inline_chart = None

        assistant_msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=str(assistant_text),
            chart=ChatChart(**inline_chart) if inline_chart else None,
        )

        await db.messages.insert_many([user_msg.model_dump(), assistant_msg.model_dump()])
        await db.conversations.update_one(
            {"id": conversation_id},
            {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
        )

        # ---- MEMORY: fire-and-forget auto-extraction from user message ----
        if not manual_content and not forget_keyword and len(req.message) > 15:
            async def _auto_extract_task():
                try:
                    extracted = await extract_memories_from_text(req.message, conversation_id)
                    saved_count = 0
                    for m in extracted:
                        try:
                            await save_memory(
                                db, user["id"], m["content"],
                                category=m.get("category", "other"),
                                source="auto",
                                importance=m.get("importance", 3),
                            )
                            saved_count += 1
                        except Exception as e:
                            logger.debug(f"[auto-extract] Save skipped: {e}")
                    if saved_count > 0:
                        logger.info(f"[auto-extract] Saved {saved_count} memories for user {user['id']}")
                except Exception as e:
                    logger.warning(f"[auto-extract] Task failed: {e}")
            background_tasks.add_task(_auto_extract_task)

        sources = [
            RagSource(
                file_id=c["file_id"],
                filename=c["filename"],
                chunk_index=c["chunk_index"],
                score=c["score"],
            )
            for c in rag_chunks
        ]
        return ChatResponse(
            conversation_id=conversation_id,
            user_message=user_msg,
            assistant_message=assistant_msg,
            sources=sources,
        )

    return router
