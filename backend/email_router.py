"""Faz 7 — Email router: /api/email/*"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import email_service as es

logger = logging.getLogger(__name__)


class AddAccountReq(BaseModel):
    email: str
    app_password: str
    provider: Optional[str] = None
    label: Optional[str] = ""
    imap_host: Optional[str] = None
    imap_port: Optional[int] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_mode: Optional[str] = None  # "starttls" | "tls"


class SendReq(BaseModel):
    to: List[str]
    subject: str = ""
    body_text: Optional[str] = ""
    body_html: Optional[str] = None
    cc: List[str] = Field(default_factory=list)
    bcc: List[str] = Field(default_factory=list)


class UidsReq(BaseModel):
    folder: str = "INBOX"
    uids: List[str]
    seen: Optional[bool] = None


def build_email_router(db, licensed_user):
    router = APIRouter(prefix="/email", tags=["email"])

    async def _load_account(user: dict, account_id: str):
        try:
            return await es.get_account(db, user["id"], account_id)
        except ValueError as e:
            raise HTTPException(404, str(e))

    # ---- provider metadata (used by the frontend "add account" form) -------
    @router.get("/providers")
    async def providers():
        # Strip internal-only fields
        return [
            {
                "key": k,
                "label": v.get("label", k),
                "imap_host": v.get("imap_host", ""),
                "imap_port": v.get("imap_port"),
                "smtp_host": v.get("smtp_host", ""),
                "smtp_port": v.get("smtp_port"),
                "smtp_mode": v.get("smtp_mode"),
            }
            for k, v in es.PROVIDERS.items()
        ]

    @router.get("/accounts")
    async def list_accounts(user: dict = Depends(licensed_user)):
        return await es.list_accounts(db, user["id"])

    @router.post("/accounts")
    async def add_account(req: AddAccountReq, user: dict = Depends(licensed_user)):
        # Build a scratch account dict and test the connection BEFORE inserting,
        # so a bad password never leaves a dangling DB row.
        email_lower = (req.email or "").strip().lower()
        if not email_lower or "@" not in email_lower:
            raise HTTPException(400, "Geçerli bir e-posta adresi giriniz")
        provider = req.provider or es.infer_provider(email_lower)
        if provider not in es.PROVIDERS:
            raise HTTPException(400, f"Bilinmeyen sağlayıcı: {provider}")

        existing = await db[es.COLL].find_one({"user_id": user["id"], "email": email_lower})
        if existing:
            raise HTTPException(400, "Bu e-posta hesabı zaten kayıtlı")

        scratch = {
            "email": email_lower,
            "provider": provider,
            "password_enc": es.enc(req.app_password),
            "imap_host": req.imap_host or None,
            "imap_port": req.imap_port or None,
            "smtp_host": req.smtp_host or None,
            "smtp_port": req.smtp_port or None,
            "smtp_mode": req.smtp_mode or None,
        }
        test = await es.test_connection(scratch)
        if not test.get("ok"):
            raise HTTPException(400, f"Bağlantı başarısız: {test.get('error')}")

        try:
            acc = await es.add_account(
                db,
                user["id"],
                email=email_lower,
                app_password=req.app_password,
                provider=provider,
                label=req.label or "",
                imap_host=req.imap_host,
                imap_port=req.imap_port,
                smtp_host=req.smtp_host,
                smtp_port=req.smtp_port,
                smtp_mode=req.smtp_mode,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        return acc

    @router.delete("/accounts/{account_id}")
    async def delete_account(account_id: str, user: dict = Depends(licensed_user)):
        n = await es.delete_account(db, user["id"], account_id)
        return {"deleted": n}

    @router.post("/accounts/{account_id}/test")
    async def test_account(account_id: str, user: dict = Depends(licensed_user)):
        acc = await _load_account(user, account_id)
        return await es.test_connection(acc)

    @router.get("/accounts/{account_id}/folders")
    async def folders(account_id: str, user: dict = Depends(licensed_user)):
        acc = await _load_account(user, account_id)
        try:
            return await es.list_folders(db, acc)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @router.get("/accounts/{account_id}/messages")
    async def messages(
        account_id: str,
        folder: str = "INBOX",
        limit: int = 30,
        q: Optional[str] = None,
        unread_only: bool = False,
        user: dict = Depends(licensed_user),
    ):
        acc = await _load_account(user, account_id)
        try:
            msgs = await es.list_messages(db, acc, folder=folder, limit=limit, q=q, unread_only=unread_only)
            return {"messages": msgs, "count": len(msgs)}
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            logger.exception("IMAP fetch failed")
            raise HTTPException(502, f"IMAP hatası: {e}")

    @router.get("/accounts/{account_id}/message")
    async def message(account_id: str, folder: str, uid: str, user: dict = Depends(licensed_user)):
        acc = await _load_account(user, account_id)
        try:
            m = await es.get_message(db, acc, folder=folder, uid=uid)
        except Exception as e:
            raise HTTPException(502, f"IMAP hatası: {e}")
        if not m:
            raise HTTPException(404, "Mesaj bulunamadı")
        return m

    @router.post("/accounts/{account_id}/send")
    async def send(account_id: str, req: SendReq, user: dict = Depends(licensed_user)):
        acc = await _load_account(user, account_id)
        try:
            return await es.send_email(
                acc,
                to=req.to,
                subject=req.subject,
                body_text=req.body_text or "",
                body_html=req.body_html,
                cc=req.cc,
                bcc=req.bcc,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            logger.exception("SMTP send failed")
            raise HTTPException(502, f"Gönderim hatası: {e}")

    @router.post("/accounts/{account_id}/delete-messages")
    async def delete_msgs(account_id: str, req: UidsReq, user: dict = Depends(licensed_user)):
        acc = await _load_account(user, account_id)
        try:
            n = await es.delete_messages(db, acc, req.folder, req.uids)
            return {"deleted": n}
        except Exception as e:
            raise HTTPException(502, f"IMAP hatası: {e}")

    @router.post("/accounts/{account_id}/mark-seen")
    async def mark_seen(account_id: str, req: UidsReq, user: dict = Depends(licensed_user)):
        acc = await _load_account(user, account_id)
        if req.seen is None:
            raise HTTPException(400, "seen alanı gerekli")
        try:
            n = await es.mark_seen(db, acc, req.folder, req.uids, req.seen)
            return {"updated": n}
        except Exception as e:
            raise HTTPException(502, f"IMAP hatası: {e}")

    return router
