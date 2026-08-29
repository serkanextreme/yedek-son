"""Whisper STT service for Sertex.

Uses OpenAI Whisper (whisper-1) via emergentintegrations library with the
Emergent Universal LLM Key. Accepts audio bytes (webm/opus, mp3, wav, m4a, mp4)
and returns transcribed text.

Fallback for browsers that don't support Web Speech API (Firefox, mobile).
"""
import os
import io
import logging
from typing import Optional
from dotenv import load_dotenv

from emergentintegrations.llm.openai import OpenAISpeechToText

# Ensure .env is loaded even if imported before server.py runs load_dotenv()
load_dotenv()

logger = logging.getLogger(__name__)


def _get_llm_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")

# 25 MB is Whisper API hard limit
MAX_AUDIO_BYTES = 25 * 1024 * 1024

# Supported extensions (per Whisper API)
SUPPORTED_EXTS = {"webm", "mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "ogg"}


class NamedBytesIO(io.BytesIO):
    """BytesIO with a `name` attribute so multipart uploads work correctly."""
    def __init__(self, data: bytes, name: str):
        super().__init__(data)
        self.name = name


def _extension_from_content_type(content_type: str) -> str:
    ct = (content_type or "").lower()
    if "webm" in ct:
        return "webm"
    if "mp4" in ct or "m4a" in ct:
        return "m4a"
    if "wav" in ct:
        return "wav"
    if "ogg" in ct:
        return "ogg"
    if "mpeg" in ct or "mp3" in ct:
        return "mp3"
    return "webm"  # default for browser MediaRecorder


async def transcribe_audio(
    audio_bytes: bytes,
    filename: Optional[str] = None,
    content_type: Optional[str] = None,
    language: str = "tr",
    prompt: Optional[str] = None,
) -> str:
    """Transcribe audio bytes using OpenAI Whisper.

    Args:
        audio_bytes: raw audio file bytes
        filename: original filename (used to detect format if content_type absent)
        content_type: MIME type of the audio (e.g., 'audio/webm')
        language: ISO-639-1 code (default: 'tr' for Turkish)
        prompt: optional context prompt to guide transcription

    Returns:
        Transcribed text (string). Empty string on total failure.
    """
    if not _get_llm_key():
        raise RuntimeError("EMERGENT_LLM_KEY not configured")

    if not audio_bytes:
        raise ValueError("Empty audio data")

    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise ValueError(f"Audio too large: {len(audio_bytes)} bytes (max 25MB)")

    # Determine file extension
    ext = None
    if filename and "." in filename:
        candidate = filename.rsplit(".", 1)[-1].lower()
        if candidate in SUPPORTED_EXTS:
            ext = candidate
    if not ext:
        ext = _extension_from_content_type(content_type or "")
    if ext not in SUPPORTED_EXTS:
        ext = "webm"

    # Whisper wants a file-like object with a .name attribute for format inference
    file_obj = NamedBytesIO(audio_bytes, name=f"audio.{ext}")

    stt = OpenAISpeechToText(api_key=_get_llm_key())
    response = await stt.transcribe(
        file=file_obj,
        model="whisper-1",
        response_format="json",
        language=language,
        prompt=prompt or "Sohbet — Türkçe kişisel asistan konuşması.",
        temperature=0.0,
    )
    text = getattr(response, "text", None) or str(response)
    return text.strip()
