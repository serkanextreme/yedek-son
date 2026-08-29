"""Sertex — Personal data router.

Extracted from server.py (Faz 9 refactor). Groups the "personal user-scoped"
endpoints together: /notes, /memory, /conversations, /tts, /stt/whisper.
None of these touch RBAC (they're always self-scoped), so isolating them
keeps the core `server.py` slim.
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel, Field

from emergentintegrations.llm.openai import OpenAITextToSpeech

from memory_service import (
    Memory,
    MemoryCreate,
    MemoryUpdate,
    list_memories,
    save_memory,
    update_memory,
    delete_memory,
)
from whisper_service import transcribe_audio

logger = logging.getLogger(__name__)


class ChatChart(BaseModel):
    type: str = "bar"
    title: Optional[str] = None
    x_label: Optional[str] = None
    y_label: Optional[str] = None
    sheet: Optional[str] = None
    filename: Optional[str] = None
    data: List[dict] = Field(default_factory=list)


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


class Note(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    content: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class NoteCreate(BaseModel):
    content: str


class TTSRequest(BaseModel):
    text: str
    voice: str = "onyx"


def build_personal_router(db, licensed_user_dep, current_user_dep, emergent_llm_key: Optional[str]) -> APIRouter:
    router = APIRouter()

    # ------------------------------------------------------------------
    # MEMORY (Long-term memory)
    # ------------------------------------------------------------------
    @router.get("/memory", response_model=List[Memory])
    async def memory_list(user: dict = Depends(licensed_user_dep)):
        return await list_memories(db, user["id"])

    @router.post("/memory", response_model=Memory)
    async def memory_create(req: MemoryCreate, user: dict = Depends(licensed_user_dep)):
        content = (req.content or "").strip()
        if len(content) < 3:
            raise HTTPException(status_code=400, detail="İçerik en az 3 karakter olmalı")
        if len(content) > 300:
            raise HTTPException(status_code=400, detail="İçerik en fazla 300 karakter olabilir")
        try:
            return await save_memory(
                db, user["id"], content,
                category=req.category, source="manual", importance=req.importance,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.patch("/memory/{mid}", response_model=Memory)
    async def memory_update(mid: str, req: MemoryUpdate, user: dict = Depends(licensed_user_dep)):
        try:
            updated = await update_memory(db, user["id"], mid, req)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if not updated:
            raise HTTPException(status_code=404, detail="Hafıza bulunamadı")
        return updated

    @router.delete("/memory/{mid}")
    async def memory_delete(mid: str, user: dict = Depends(licensed_user_dep)):
        n = await delete_memory(db, user["id"], mid)
        return {"deleted": n}

    @router.delete("/memory")
    async def memory_delete_all(user: dict = Depends(licensed_user_dep)):
        r = await db.memories.delete_many({"user_id": user["id"]})
        return {"deleted": r.deleted_count}

    # ------------------------------------------------------------------
    # STT (Whisper)
    # ------------------------------------------------------------------
    @router.post("/stt/whisper")
    async def stt_whisper(
        audio: UploadFile = File(...),
        language: str = Form("tr"),
        user: dict = Depends(licensed_user_dep),
    ):
        if not emergent_llm_key:
            raise HTTPException(status_code=500, detail="LLM key not configured")
        try:
            audio_bytes = await audio.read()
            text = await transcribe_audio(
                audio_bytes,
                filename=audio.filename,
                content_type=audio.content_type,
                language=language or "tr",
            )
            return {"text": text}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.error(f"Whisper STT error: {e}")
            raise HTTPException(status_code=500, detail=f"STT error: {str(e)}")

    # ------------------------------------------------------------------
    # CONVERSATIONS + MESSAGES
    # ------------------------------------------------------------------
    @router.get("/conversations", response_model=List[Conversation])
    async def list_conversations(user: dict = Depends(current_user_dep)):
        docs = await db.conversations.find({"user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(length=200)
        return [Conversation(**d) for d in docs]

    @router.get("/conversations/{cid}/messages", response_model=List[Message])
    async def get_messages(cid: str, user: dict = Depends(current_user_dep)):
        conv = await db.conversations.find_one({"id": cid, "user_id": user["id"]})
        if not conv:
            raise HTTPException(status_code=404, detail="Sohbet bulunamadı")
        docs = await db.messages.find({"conversation_id": cid}, {"_id": 0}).sort("created_at", 1).to_list(length=1000)
        return [Message(**d) for d in docs]

    @router.delete("/conversations/{cid}")
    async def delete_conversation(cid: str, user: dict = Depends(current_user_dep)):
        r = await db.conversations.delete_one({"id": cid, "user_id": user["id"]})
        if r.deleted_count:
            await db.messages.delete_many({"conversation_id": cid})
        return {"deleted": r.deleted_count}

    # ------------------------------------------------------------------
    # TTS
    # ------------------------------------------------------------------
    @router.post("/tts")
    async def tts(req: TTSRequest, user: dict = Depends(licensed_user_dep)):
        if not emergent_llm_key:
            raise HTTPException(status_code=500, detail="LLM key not configured")
        text = req.text[:4000]
        try:
            tts_client = OpenAITextToSpeech(api_key=emergent_llm_key)
            audio_bytes = await tts_client.generate_speech(
                text=text, model="tts-1", voice=req.voice
            )
            return Response(content=audio_bytes, media_type="audio/mpeg")
        except Exception as e:
            logger.error(f"TTS error: {e}")
            raise HTTPException(status_code=500, detail=f"TTS error: {str(e)}")

    # ------------------------------------------------------------------
    # NOTES
    # ------------------------------------------------------------------
    @router.get("/notes", response_model=List[Note])
    async def list_notes(user: dict = Depends(licensed_user_dep)):
        docs = await db.notes.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(length=500)
        return [Note(**d) for d in docs]

    @router.post("/notes", response_model=Note)
    async def create_note(req: NoteCreate, user: dict = Depends(licensed_user_dep)):
        n = Note(content=req.content)
        nd = n.model_dump()
        nd["user_id"] = user["id"]
        await db.notes.insert_one(nd)
        return n

    @router.delete("/notes/{nid}")
    async def delete_note(nid: str, user: dict = Depends(licensed_user_dep)):
        r = await db.notes.delete_one({"id": nid, "user_id": user["id"]})
        return {"deleted": r.deleted_count}

    return router
