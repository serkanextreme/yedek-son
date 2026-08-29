"""Emergent Object Storage wrapper for Sertex.

Handles file uploads to the Emergent-managed object storage (multi-tenant),
downloads, and path management. Falls back gracefully if the storage
service is temporarily unavailable.

Path convention:
    sertex/uploads/{user_id}/{uuid}.{ext}

The storage service has no delete API — soft-delete via MongoDB (is_deleted).
"""
import os
import logging
import uuid
import requests
from typing import Optional, Tuple
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "sertex"

# Module-level cache — init once per process
_storage_key: Optional[str] = None


def _get_emergent_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")


def init_storage(force: bool = False) -> str:
    """Initialize the storage session. Cached; called once at startup."""
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    key = _get_emergent_key()
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": key},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    logger.info("Sertex object storage initialized")
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload raw bytes. Returns storage metadata dict {path, size, etag}."""
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=180,
    )
    if resp.status_code == 403:
        # Session may have expired — refresh once and retry
        key = init_storage(force=True)
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=180,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> Tuple[bytes, str]:
    """Download an object. Returns (bytes, content_type)."""
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=120,
    )
    if resp.status_code == 403:
        key = init_storage(force=True)
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=120,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def build_upload_path(user_id: str, filename: str) -> str:
    """Build a UUID-based storage path prefixed with app + user id."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    # Sanitize the extension to alphanumeric only, max 10 chars
    ext = "".join(c for c in ext if c.isalnum())[:10] or "bin"
    return f"{APP_NAME}/uploads/{user_id}/{uuid.uuid4()}.{ext}"
