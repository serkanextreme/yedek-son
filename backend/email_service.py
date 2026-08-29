"""Faz 7 — Universal IMAP/SMTP Email service.

Multi-provider (Gmail, Outlook/Hotmail, Yahoo, iCloud, generic) email reading
and sending. App passwords are stored encrypted (Fernet). IMAP operations use
`imap-tools` (sync) wrapped in `asyncio.to_thread`. SMTP uses `aiosmtplib`.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import ssl
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any, Dict, List, Optional

import aiosmtplib
from cryptography.fernet import Fernet, InvalidToken
from imap_tools import MailBox, MailboxLoginError, AND

logger = logging.getLogger(__name__)


# ------------ Provider presets --------------------------------------------
# Each provider tuple: imap_host, imap_port, smtp_host, smtp_port, smtp_mode
# smtp_mode: "starttls" (port 587) or "tls" (port 465)
PROVIDERS: Dict[str, Dict[str, Any]] = {
    "gmail": {
        "imap_host": "imap.gmail.com", "imap_port": 993,
        "smtp_host": "smtp.gmail.com", "smtp_port": 587, "smtp_mode": "starttls",
        "label": "Gmail",
    },
    "outlook": {
        # Works for outlook.com, hotmail.com, live.com, msn.com
        "imap_host": "outlook.office365.com", "imap_port": 993,
        "smtp_host": "smtp-mail.outlook.com", "smtp_port": 587, "smtp_mode": "starttls",
        "label": "Outlook / Hotmail",
    },
    "yahoo": {
        "imap_host": "imap.mail.yahoo.com", "imap_port": 993,
        "smtp_host": "smtp.mail.yahoo.com", "smtp_port": 465, "smtp_mode": "tls",
        "label": "Yahoo",
    },
    "icloud": {
        "imap_host": "imap.mail.me.com", "imap_port": 993,
        "smtp_host": "smtp.mail.me.com", "smtp_port": 587, "smtp_mode": "starttls",
        "label": "iCloud",
    },
    "yandex": {
        "imap_host": "imap.yandex.com", "imap_port": 993,
        "smtp_host": "smtp.yandex.com", "smtp_port": 465, "smtp_mode": "tls",
        "label": "Yandex",
    },
    "generic": {
        "imap_host": "", "imap_port": 993,
        "smtp_host": "", "smtp_port": 587, "smtp_mode": "starttls",
        "label": "Diğer (Özel)",
    },
}


def infer_provider(email_addr: str) -> str:
    """Guess a provider key from an email address' domain."""
    if not email_addr or "@" not in email_addr:
        return "generic"
    dom = email_addr.split("@", 1)[1].lower()
    if dom in ("gmail.com", "googlemail.com"):
        return "gmail"
    if dom in ("outlook.com", "hotmail.com", "live.com", "msn.com", "outlook.com.tr", "hotmail.com.tr"):
        return "outlook"
    if dom in ("yahoo.com", "yahoo.com.tr", "ymail.com"):
        return "yahoo"
    if dom in ("icloud.com", "me.com", "mac.com"):
        return "icloud"
    if dom in ("yandex.com", "yandex.com.tr", "yandex.ru"):
        return "yandex"
    return "generic"


def get_provider_config(account: Dict[str, Any]) -> Dict[str, Any]:
    """Merge provider preset with any per-account overrides."""
    prov = account.get("provider") or "generic"
    base = PROVIDERS.get(prov, PROVIDERS["generic"]).copy()
    for k in ("imap_host", "imap_port", "smtp_host", "smtp_port", "smtp_mode"):
        v = account.get(k)
        if v is not None and v != "":
            base[k] = v
    return base


# ------------ Encryption helpers ------------------------------------------
_FERNET_CACHE: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    global _FERNET_CACHE
    if _FERNET_CACHE is not None:
        return _FERNET_CACHE
    key = os.environ.get("EMAIL_FERNET_KEY")
    if not key:
        raise RuntimeError(
            "EMAIL_FERNET_KEY missing in backend/.env — cannot handle email credentials"
        )
    _FERNET_CACHE = Fernet(key.encode() if isinstance(key, str) else key)
    return _FERNET_CACHE


def enc(plain: str) -> str:
    return _get_fernet().encrypt(plain.encode()).decode()


def dec(token: str) -> str:
    try:
        return _get_fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise RuntimeError("Şifre çözülemedi — EMAIL_FERNET_KEY değişmiş olabilir") from e


# ------------ DB helpers ---------------------------------------------------
COLL = "email_accounts"


async def ensure_indexes(db) -> None:
    try:
        await db[COLL].create_index([("user_id", 1), ("email", 1)], unique=True)
    except Exception as e:
        logger.warning("email_accounts index create failed: %s", e)


def _public_account(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Strip sensitive fields before returning to clients."""
    return {
        "id": doc["id"],
        "email": doc["email"],
        "provider": doc["provider"],
        "label": doc.get("label", ""),
        "imap_host": doc.get("imap_host") or PROVIDERS.get(doc["provider"], {}).get("imap_host"),
        "imap_port": doc.get("imap_port") or PROVIDERS.get(doc["provider"], {}).get("imap_port"),
        "smtp_host": doc.get("smtp_host") or PROVIDERS.get(doc["provider"], {}).get("smtp_host"),
        "smtp_port": doc.get("smtp_port") or PROVIDERS.get(doc["provider"], {}).get("smtp_port"),
        "smtp_mode": doc.get("smtp_mode") or PROVIDERS.get(doc["provider"], {}).get("smtp_mode"),
        "created_at": doc.get("created_at"),
        "last_synced_at": doc.get("last_synced_at"),
        "last_error": doc.get("last_error"),
    }


async def list_accounts(db, user_id: str) -> List[Dict[str, Any]]:
    docs = await db[COLL].find(
        {"user_id": user_id}, {"_id": 0, "password_enc": 0}
    ).sort("created_at", 1).to_list(length=100)
    return [_public_account(d) for d in docs]


async def get_account(db, user_id: str, account_id: str) -> Dict[str, Any]:
    doc = await db[COLL].find_one({"id": account_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise ValueError("E-posta hesabı bulunamadı")
    return doc


async def add_account(
    db,
    user_id: str,
    email: str,
    app_password: str,
    provider: Optional[str] = None,
    label: str = "",
    imap_host: Optional[str] = None,
    imap_port: Optional[int] = None,
    smtp_host: Optional[str] = None,
    smtp_port: Optional[int] = None,
    smtp_mode: Optional[str] = None,
) -> Dict[str, Any]:
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        raise ValueError("Geçerli bir e-posta adresi giriniz")
    if not app_password or len(app_password) < 4:
        raise ValueError("Uygulama şifresi çok kısa")
    prov = provider or infer_provider(email)
    if prov not in PROVIDERS:
        raise ValueError(f"Bilinmeyen sağlayıcı: {prov}")

    # Duplicate protection
    existing = await db[COLL].find_one({"user_id": user_id, "email": email})
    if existing:
        raise ValueError("Bu e-posta hesabı zaten kayıtlı")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "email": email,
        "provider": prov,
        "label": label or "",
        "imap_host": imap_host or None,
        "imap_port": imap_port or None,
        "smtp_host": smtp_host or None,
        "smtp_port": smtp_port or None,
        "smtp_mode": smtp_mode or None,
        "password_enc": enc(app_password),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_synced_at": None,
        "last_error": None,
    }
    await db[COLL].insert_one(doc)
    return _public_account(doc)


async def delete_account(db, user_id: str, account_id: str) -> int:
    r = await db[COLL].delete_one({"id": account_id, "user_id": user_id})
    return r.deleted_count


async def mark_synced(db, account_id: str, err: Optional[str] = None) -> None:
    now = datetime.now(timezone.utc).isoformat()
    await db[COLL].update_one(
        {"id": account_id},
        {"$set": {"last_synced_at": now, "last_error": err}},
    )


# ------------ IMAP operations (sync via imap-tools) -----------------------
def _open_mailbox(account: Dict[str, Any]):
    """Return an imap-tools MailBox context manager."""
    cfg = get_provider_config(account)
    host = cfg["imap_host"]
    port = cfg["imap_port"]
    if not host:
        raise ValueError("IMAP sunucusu belirtilmemiş")
    return MailBox(host, port=port, timeout=30).login(account["email"], dec(account["password_enc"]))


def _msg_to_dict(msg, include_body: bool = False) -> Dict[str, Any]:
    d = {
        "uid": msg.uid,
        "subject": msg.subject or "",
        "from": msg.from_ or "",
        "from_name": (msg.from_values.name if getattr(msg, "from_values", None) else "") or "",
        "to": list(msg.to or []),
        "cc": list(msg.cc or []),
        "date": msg.date.isoformat() if msg.date else "",
        "flags": list(msg.flags or []),
        "seen": ("\\Seen" in (msg.flags or [])),
        "size": getattr(msg, "size", 0) or 0,
        "attachments": [
            {"filename": a.filename or "", "size": len(a.payload) if a.payload else 0}
            for a in (msg.attachments or [])
        ],
    }
    if include_body:
        d["text"] = msg.text or ""
        d["html"] = msg.html or ""
    return d


def _list_messages_sync(
    account: Dict[str, Any],
    folder: str,
    limit: int,
    q: Optional[str] = None,
    unread_only: bool = False,
) -> List[Dict[str, Any]]:
    with _open_mailbox(account) as mb:
        mb.folder.set(folder)
        crit = "ALL"
        if unread_only and q:
            crit = AND(seen=False, text=q)
        elif unread_only:
            crit = AND(seen=False)
        elif q:
            crit = AND(text=q)
        out: List[Dict[str, Any]] = []
        for msg in mb.fetch(criteria=crit, limit=limit, reverse=True, bulk=True, headers_only=False, mark_seen=False):
            out.append(_msg_to_dict(msg, include_body=False))
        return out


def _get_message_sync(account: Dict[str, Any], folder: str, uid: str) -> Optional[Dict[str, Any]]:
    with _open_mailbox(account) as mb:
        mb.folder.set(folder)
        for msg in mb.fetch(AND(uid=uid), limit=1, mark_seen=True):
            return _msg_to_dict(msg, include_body=True)
    return None


def _list_folders_sync(account: Dict[str, Any]) -> List[str]:
    with _open_mailbox(account) as mb:
        return [f.name for f in mb.folder.list()]


def _delete_messages_sync(account: Dict[str, Any], folder: str, uids: List[str]) -> int:
    with _open_mailbox(account) as mb:
        mb.folder.set(folder)
        mb.delete(uids)
        return len(uids)


def _mark_seen_sync(account: Dict[str, Any], folder: str, uids: List[str], seen: bool) -> int:
    with _open_mailbox(account) as mb:
        mb.folder.set(folder)
        mb.flag(uids, "\\Seen", seen)
        return len(uids)


# ------------ Async wrappers ---------------------------------------------
async def list_messages(
    db,
    account: Dict[str, Any],
    folder: str = "INBOX",
    limit: int = 30,
    q: Optional[str] = None,
    unread_only: bool = False,
) -> List[Dict[str, Any]]:
    try:
        msgs = await asyncio.to_thread(
            _list_messages_sync, account, folder, limit, q, unread_only
        )
        await mark_synced(db, account["id"], None)
        return msgs
    except MailboxLoginError as e:
        await mark_synced(db, account["id"], f"LOGIN: {e}")
        raise ValueError("IMAP giriş başarısız — e-posta veya app-password hatalı") from e
    except Exception as e:
        await mark_synced(db, account["id"], f"IMAP: {e}")
        raise


async def get_message(db, account: Dict[str, Any], folder: str, uid: str) -> Optional[Dict[str, Any]]:
    return await asyncio.to_thread(_get_message_sync, account, folder, uid)


async def list_folders(db, account: Dict[str, Any]) -> List[str]:
    try:
        return await asyncio.to_thread(_list_folders_sync, account)
    except MailboxLoginError as e:
        raise ValueError("IMAP giriş başarısız") from e


async def delete_messages(db, account: Dict[str, Any], folder: str, uids: List[str]) -> int:
    return await asyncio.to_thread(_delete_messages_sync, account, folder, uids)


async def mark_seen(db, account: Dict[str, Any], folder: str, uids: List[str], seen: bool) -> int:
    return await asyncio.to_thread(_mark_seen_sync, account, folder, uids, seen)


# ------------ SMTP send ---------------------------------------------------
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_addrs(addrs: List[str]) -> List[str]:
    out = []
    for a in addrs or []:
        a = (a or "").strip()
        if not a:
            continue
        if not _EMAIL_RE.match(a):
            raise ValueError(f"Geçersiz e-posta adresi: {a}")
        out.append(a)
    return out


async def send_email(
    account: Dict[str, Any],
    to: List[str],
    subject: str,
    body_text: Optional[str] = None,
    body_html: Optional[str] = None,
    cc: Optional[List[str]] = None,
    bcc: Optional[List[str]] = None,
) -> Dict[str, Any]:
    to = _validate_addrs(to)
    cc = _validate_addrs(cc or [])
    bcc = _validate_addrs(bcc or [])
    if not to:
        raise ValueError("En az bir alıcı gerekli")
    if not subject and not body_text and not body_html:
        raise ValueError("Boş e-posta gönderilemez")

    cfg = get_provider_config(account)

    msg = EmailMessage()
    msg["From"] = account["email"]
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject or ""
    msg.set_content(body_text or "")
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    all_rcpt = to + cc + bcc

    smtp_mode = cfg.get("smtp_mode", "starttls")
    use_tls = smtp_mode == "tls"
    start_tls = smtp_mode == "starttls"

    try:
        await aiosmtplib.send(
            msg,
            hostname=cfg["smtp_host"],
            port=cfg["smtp_port"],
            username=account["email"],
            password=dec(account["password_enc"]),
            recipients=all_rcpt,
            use_tls=use_tls,
            start_tls=start_tls,
            validate_certs=True,
            tls_context=ssl.create_default_context(),
            timeout=30,
        )
    except aiosmtplib.SMTPAuthenticationError as e:
        raise ValueError("SMTP giriş başarısız — app-password'ü kontrol edin") from e
    except aiosmtplib.SMTPException as e:
        raise ValueError(f"SMTP hatası: {e}") from e

    return {"ok": True, "recipients": len(all_rcpt)}


# ------------ Test connection --------------------------------------------
def _test_conn_sync(account: Dict[str, Any]) -> Dict[str, Any]:
    with _open_mailbox(account) as mb:
        folders = [f.name for f in mb.folder.list()][:5]
        return {"ok": True, "folders_sample": folders}


async def test_connection(account: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return await asyncio.to_thread(_test_conn_sync, account)
    except MailboxLoginError as e:
        prov = (account.get("provider") or "").lower()
        email_addr = (account.get("email") or "").lower()
        is_ms_personal = prov == "outlook" or any(
            email_addr.endswith("@" + d)
            for d in ("hotmail.com", "outlook.com", "live.com", "msn.com",
                     "hotmail.com.tr", "outlook.com.tr")
        )
        if is_ms_personal:
            return {
                "ok": False,
                "error": (
                    "Microsoft, kişisel Hotmail/Outlook hesaplarında IMAP/SMTP + "
                    "App Password ile bağlantıyı Eylül 2024'ten itibaren kapattı. "
                    "Artık yalnızca OAuth 2.0 destekleniyor. Alternatif: Gmail "
                    "hesabı kullanın (App Password sorunsuz çalışıyor) veya "
                    "Sertex'e Microsoft OAuth entegrasyonu ekletin."
                ),
            }
        return {"ok": False, "error": "IMAP giriş başarısız — e-posta veya app-password hatalı"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
