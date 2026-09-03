"""Sertex — Görev Şablonları (Task Templates) router.

Factory: `build_templates_router(db, licensed_user_dep)` → APIRouter (no prefix).

Amaç: Sık kullanılan görevleri "şablon" olarak sakla; "Yeni Görev" akışında
şablondan başlat (instantiate) → gerçek görev oluşur, kullanıcı düzenler.

Tasarım kararı (hiçbir mevcut akışı bozmamak için): şablonlar AYRI koleksiyonda
(`task_templates`) tutulur, böylece görev sorgularına (liste/istatistik/arşiv/
zamanlayıcı) ASLA sızmaz. Şablon dosya ekleri de ayrı koleksiyonda
(`task_template_attachments`). "Şablondan başlat" ise mevcut `tasks` +
`task_attachments` içine kopyalar (Görev Kopyalama'daki storage-kopya mantığı).

Kapsam:
  * scope="personal" → yalnızca sahibi görür/kullanır
  * scope="shared"   → sahibinin şirketindeki herkes görür/kullanır
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response, Query
from pydantic import BaseModel, Field
from urllib.parse import quote

from permissions import acting_role, get_user_company_ids
from storage_service import put_object, get_object, build_upload_path
from .tasks_models import Subtask, Task, TaskAttachment, AttachmentInitReq, AttachmentCompleteReq, _now_iso

log = logging.getLogger(__name__)

_TPL_ATTACH_MAX_BYTES = 100 * 1024 * 1024  # 100 MB / dosya


# ---------------------------------------------------------------------------
# Modeller
# ---------------------------------------------------------------------------
class TaskTemplate(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str                                   # şablon adı (ör. "Haftalık Rapor")
    title: str = ""                             # oluşacak görevin başlığı
    description: str = ""
    category_id: Optional[str] = None
    reminder_days: Optional[int] = None
    reminder_disabled: bool = False
    subtasks: List[dict] = Field(default_factory=list)   # [{id, text}]
    scope: str = "personal"                     # personal | shared
    company_id: Optional[str] = None            # shared için sahibinin şirketi
    owner_id: str
    created_by: str
    created_by_name: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)


class TaskTemplateCreate(BaseModel):
    name: str
    title: str = ""
    description: str = ""
    category_id: Optional[str] = None
    reminder_days: Optional[int] = None
    reminder_disabled: bool = False
    subtasks: List[dict] = Field(default_factory=list)
    scope: str = "personal"


class TaskTemplateUpdate(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    category_id: Optional[str] = None
    reminder_days: Optional[int] = None
    reminder_disabled: Optional[bool] = None
    subtasks: Optional[List[dict]] = None
    scope: Optional[str] = None


class TemplateInstantiateReq(BaseModel):
    # None → şablonun kendi iş kolu kullanılır. Bir değer verilirse onunla yaz.
    category_id: Optional[str] = None


def _clean_subtasks(items: Optional[List[dict]]) -> List[dict]:
    out: List[dict] = []
    for s in items or []:
        text = (s.get("text") or "").strip() if isinstance(s, dict) else ""
        if not text:
            continue
        out.append({"id": (s.get("id") if isinstance(s, dict) else None) or str(uuid.uuid4()), "text": text[:500]})
    return out


def build_templates_router(db, licensed_user_dep) -> APIRouter:
    router = APIRouter()
    _tpl_upload_sessions: Dict[str, Dict[str, Any]] = {}

    def _tpl_out(doc: dict) -> TaskTemplate:
        doc.setdefault("subtasks", [])
        return TaskTemplate(**doc)

    def _can_view_template(tpl: dict, user: dict) -> bool:
        if acting_role(user) == "admin":
            return True
        if tpl.get("owner_id") == user["id"]:
            return True
        if tpl.get("scope") == "shared":
            cids = get_user_company_ids(user) or ([user.get("company_id")] if user.get("company_id") else [])
            return tpl.get("company_id") in cids
        return False

    def _can_manage_template(tpl: dict, user: dict) -> bool:
        if acting_role(user) == "admin":
            return True
        return tpl.get("created_by") == user["id"] or tpl.get("owner_id") == user["id"]

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    @router.get("/task-templates", response_model=List[TaskTemplate])
    async def list_templates(user: dict = Depends(licensed_user_dep)):
        uid = user["id"]
        if acting_role(user) == "admin":
            q: Dict[str, Any] = {}
        else:
            cids = get_user_company_ids(user) or ([user.get("company_id")] if user.get("company_id") else [])
            ors: List[dict] = [{"owner_id": uid}]
            if cids:
                ors.append({"scope": "shared", "company_id": {"$in": cids}})
            q = {"$or": ors}
        rows = await db.task_templates.find(q, {"_id": 0}).sort("created_at", -1).to_list(length=500)
        return [_tpl_out(r) for r in rows]

    @router.post("/task-templates", response_model=TaskTemplate)
    async def create_template(req: TaskTemplateCreate, user: dict = Depends(licensed_user_dep)):
        name = (req.name or "").strip()
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Şablon adı en az 2 karakter olmalı")
        scope = "shared" if req.scope == "shared" else "personal"
        company_id = user.get("company_id")
        if scope == "shared" and not company_id:
            # Şirketi olmayan kullanıcı ortak şablon oluşturamaz → kişisele düşür.
            scope = "personal"
        tpl = TaskTemplate(
            name=name,
            title=(req.title or "").strip(),
            description=(req.description or "").strip(),
            category_id=req.category_id or None,
            reminder_days=req.reminder_days,
            reminder_disabled=bool(req.reminder_disabled),
            subtasks=_clean_subtasks(req.subtasks),
            scope=scope,
            company_id=company_id if scope == "shared" else None,
            owner_id=user["id"],
            created_by=user["id"],
            created_by_name=user.get("username"),
        )
        await db.task_templates.insert_one(tpl.model_dump())
        return tpl

    @router.get("/task-templates/{tpl_id}", response_model=TaskTemplate)
    async def get_template(tpl_id: str, user: dict = Depends(licensed_user_dep)):
        tpl = await db.task_templates.find_one({"id": tpl_id}, {"_id": 0})
        if not tpl or not _can_view_template(tpl, user):
            raise HTTPException(status_code=404, detail="Şablon bulunamadı")
        return _tpl_out(tpl)

    @router.patch("/task-templates/{tpl_id}", response_model=TaskTemplate)
    async def update_template(tpl_id: str, req: TaskTemplateUpdate, user: dict = Depends(licensed_user_dep)):
        tpl = await db.task_templates.find_one({"id": tpl_id}, {"_id": 0})
        if not tpl:
            raise HTTPException(status_code=404, detail="Şablon bulunamadı")
        if not _can_manage_template(tpl, user):
            raise HTTPException(status_code=403, detail="Bu şablonu düzenleme yetkiniz yok")
        upd: Dict[str, Any] = {}
        if req.name is not None:
            n = req.name.strip()
            if len(n) < 2:
                raise HTTPException(status_code=400, detail="Şablon adı en az 2 karakter olmalı")
            upd["name"] = n
        if req.title is not None:
            upd["title"] = req.title.strip()
        if req.description is not None:
            upd["description"] = req.description.strip()
        if req.category_id is not None:
            upd["category_id"] = req.category_id or None
        if req.reminder_days is not None:
            upd["reminder_days"] = req.reminder_days
        if req.reminder_disabled is not None:
            upd["reminder_disabled"] = bool(req.reminder_disabled)
        if req.subtasks is not None:
            upd["subtasks"] = _clean_subtasks(req.subtasks)
        if req.scope is not None:
            new_scope = "shared" if req.scope == "shared" else "personal"
            if new_scope == "shared":
                cid = user.get("company_id") or tpl.get("company_id")
                if not cid:
                    raise HTTPException(status_code=400, detail="Ortak şablon için şirket gerekli")
                upd["scope"] = "shared"
                upd["company_id"] = cid
            else:
                upd["scope"] = "personal"
                upd["company_id"] = None
        upd["updated_at"] = _now_iso()
        await db.task_templates.update_one({"id": tpl_id}, {"$set": upd})
        out = await db.task_templates.find_one({"id": tpl_id}, {"_id": 0})
        return _tpl_out(out)

    @router.delete("/task-templates/{tpl_id}")
    async def delete_template(tpl_id: str, user: dict = Depends(licensed_user_dep)):
        tpl = await db.task_templates.find_one({"id": tpl_id}, {"_id": 0})
        if not tpl:
            return {"deleted": 0}
        if not _can_manage_template(tpl, user):
            raise HTTPException(status_code=403, detail="Bu şablonu silme yetkiniz yok")
        await db.task_templates.delete_one({"id": tpl_id})
        # Şablon dosya eklerini de kalıcı sil (ayrı koleksiyon).
        await db.task_template_attachments.delete_many({"task_id": tpl_id})
        return {"deleted": 1}

    # ------------------------------------------------------------------
    # Şablondan başlat — gerçek görev oluştur (kopya bana atanır, üstte)
    # ------------------------------------------------------------------
    @router.post("/task-templates/{tpl_id}/instantiate", response_model=Task)
    async def instantiate_template(tpl_id: str, req: TemplateInstantiateReq, user: dict = Depends(licensed_user_dep)):
        tpl = await db.task_templates.find_one({"id": tpl_id}, {"_id": 0})
        if not tpl or not _can_view_template(tpl, user):
            raise HTTPException(status_code=404, detail="Şablon bulunamadı")
        owner_id = user["id"]
        now = _now_iso()
        top = await db.tasks.find_one(
            {"user_id": owner_id, "sort_order": {"$ne": None}},
            {"_id": 0, "sort_order": 1},
            sort=[("sort_order", -1)],
        )
        new_sort = (float(top["sort_order"]) + 1.0) if top and top.get("sort_order") is not None else None
        subs = [
            Subtask(text=s.get("text", ""), done=False, status="pending").model_dump()
            for s in (tpl.get("subtasks") or []) if (s.get("text") or "").strip()
        ]
        owner_doc = await db.users.find_one({"id": owner_id}, {"_id": 0, "company_id": 1, "company_name": 1})
        category_id = req.category_id if req.category_id is not None else tpl.get("category_id")
        task = Task(
            title=(tpl.get("title") or tpl.get("name") or "Görev"),
            description=tpl.get("description", ""),
            status="pending",
            user_id=owner_id,
            reminder_days=tpl.get("reminder_days"),
            reminder_disabled=bool(tpl.get("reminder_disabled", False)),
            subtasks=subs,
            sort_order=new_sort,
            category_id=category_id,
            company_id=(owner_doc or {}).get("company_id"),
            company_name=(owner_doc or {}).get("company_name"),
            assignee_name=user.get("username"),
            created_by=owner_id,
            created_at=now,
            updated_at=now,
        )
        await db.tasks.insert_one(task.model_dump())
        # Şablon dosya eklerini → yeni görevin eklerine kopyala (storage-copy).
        atts = await db.task_template_attachments.find(
            {"task_id": tpl_id, "is_deleted": {"$ne": True}}, {"_id": 0},
        ).to_list(length=500)
        for a in atts:
            try:
                data, ct = await asyncio.to_thread(get_object, a["storage_path"])
                fname = a.get("original_filename") or "dosya"
                new_path = build_upload_path(owner_id, fname)
                result = await asyncio.to_thread(put_object, new_path, data, a.get("content_type") or ct)
                canonical = result.get("path", new_path)
                natt = TaskAttachment(
                    task_id=task.id,
                    company_id=task.company_id,
                    storage_path=canonical,
                    original_filename=fname,
                    content_type=a.get("content_type") or ct,
                    size=int(a.get("size") or len(data)),
                    uploaded_by=owner_id,
                    uploaded_by_name=user.get("username"),
                )
                await db.task_attachments.insert_one(natt.model_dump())
            except Exception:  # pragma: no cover — ek kopyalama best-effort
                log.exception("instantiate: template attachment copy failed")
        out = await db.tasks.find_one({"id": task.id}, {"_id": 0})
        return Task(**out)

    # ------------------------------------------------------------------
    # Şablon dosya ekleri — chunked upload + object storage (ayrı koleksiyon)
    # ------------------------------------------------------------------
    @router.get("/task-templates/{tpl_id}/attachments")
    async def list_tpl_attachments(tpl_id: str, user: dict = Depends(licensed_user_dep)):
        tpl = await db.task_templates.find_one({"id": tpl_id}, {"_id": 0})
        if not tpl or not _can_view_template(tpl, user):
            raise HTTPException(status_code=404, detail="Şablon bulunamadı")
        rows = await db.task_template_attachments.find(
            {"task_id": tpl_id, "is_deleted": {"$ne": True}}, {"_id": 0},
        ).sort("created_at", -1).to_list(length=500)
        return [TaskAttachment(**r).model_dump() for r in rows]

    @router.post("/task-templates/{tpl_id}/attachments/init")
    async def init_tpl_attachment(tpl_id: str, req: AttachmentInitReq, user: dict = Depends(licensed_user_dep)):
        tpl = await db.task_templates.find_one({"id": tpl_id}, {"_id": 0})
        if not tpl or not _can_manage_template(tpl, user):
            raise HTTPException(status_code=404, detail="Şablon bulunamadı")
        fname = (req.filename or "dosya.bin").strip()[:255]
        if not fname:
            raise HTTPException(status_code=400, detail="Dosya adı gerekli")
        if req.total_size and req.total_size > _TPL_ATTACH_MAX_BYTES:
            raise HTTPException(status_code=400, detail="Dosya çok büyük (maks 100 MB)")
        upload_id = str(uuid.uuid4())
        _tpl_upload_sessions[upload_id] = {
            "tpl_id": tpl_id,
            "user_id": user["id"],
            "filename": fname,
            "content_type": req.content_type or "application/octet-stream",
            "received": 0,
            "buffer": bytearray(),
        }
        return {"upload_id": upload_id}

    @router.post("/task-templates/{tpl_id}/attachments/chunk")
    async def upload_tpl_chunk(
        tpl_id: str,
        upload_id: str = Form(...),
        index: int = Form(0),
        chunk: UploadFile = File(...),
        user: dict = Depends(licensed_user_dep),
    ):
        sess = _tpl_upload_sessions.get(upload_id)
        if not sess or sess["user_id"] != user["id"] or sess["tpl_id"] != tpl_id:
            raise HTTPException(status_code=404, detail="Yükleme oturumu bulunamadı")
        data = await chunk.read()
        new_total = sess["received"] + len(data)
        if new_total > _TPL_ATTACH_MAX_BYTES:
            _tpl_upload_sessions.pop(upload_id, None)
            raise HTTPException(status_code=400, detail="Dosya çok büyük (maks 100 MB)")
        sess["buffer"].extend(data)
        sess["received"] = new_total
        return {"received": new_total}

    @router.post("/task-templates/{tpl_id}/attachments/complete", response_model=TaskAttachment)
    async def complete_tpl_attachment(tpl_id: str, req: AttachmentCompleteReq, user: dict = Depends(licensed_user_dep)):
        sess = _tpl_upload_sessions.get(req.upload_id)
        if not sess or sess["user_id"] != user["id"] or sess["tpl_id"] != tpl_id:
            raise HTTPException(status_code=404, detail="Yükleme oturumu bulunamadı")
        tpl = await db.task_templates.find_one({"id": tpl_id}, {"_id": 0})
        if not tpl or not _can_manage_template(tpl, user):
            _tpl_upload_sessions.pop(req.upload_id, None)
            raise HTTPException(status_code=404, detail="Şablon bulunamadı")
        try:
            file_bytes = bytes(sess["buffer"])
            if not file_bytes:
                raise HTTPException(status_code=400, detail="Boş dosya")
            storage_path = build_upload_path(user["id"], sess["filename"])
            result = await asyncio.to_thread(put_object, storage_path, file_bytes, sess["content_type"])
            canonical = result.get("path", storage_path)
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("Template attachment upload failed")
            raise HTTPException(status_code=502, detail=f"Depolama hatası: {str(exc)[:200]}")
        finally:
            _tpl_upload_sessions.pop(req.upload_id, None)
        att = TaskAttachment(
            task_id=tpl_id,
            company_id=tpl.get("company_id"),
            storage_path=canonical,
            original_filename=sess["filename"],
            content_type=sess["content_type"],
            size=len(file_bytes),
            uploaded_by=user["id"],
            uploaded_by_name=user.get("username"),
        )
        await db.task_template_attachments.insert_one(att.model_dump())
        return att

    @router.get("/task-templates/{tpl_id}/attachments/{att_id}/download")
    async def download_tpl_attachment(tpl_id: str, att_id: str, user: dict = Depends(licensed_user_dep)):
        tpl = await db.task_templates.find_one({"id": tpl_id}, {"_id": 0})
        if not tpl or not _can_view_template(tpl, user):
            raise HTTPException(status_code=404, detail="Şablon bulunamadı")
        rec = await db.task_template_attachments.find_one(
            {"id": att_id, "task_id": tpl_id, "is_deleted": {"$ne": True}}, {"_id": 0},
        )
        if not rec:
            raise HTTPException(status_code=404, detail="Dosya bulunamadı")
        try:
            data, ct = await asyncio.to_thread(get_object, rec["storage_path"])
        except Exception:
            log.exception("Template attachment download failed")
            raise HTTPException(status_code=502, detail="Depolamadan indirme başarısız")
        raw_name = rec.get("original_filename") or "dosya"
        ascii_name = raw_name.replace('"', "'")
        return Response(
            content=data,
            media_type=rec.get("content_type") or ct,
            headers={
                "Content-Disposition": (
                    f'attachment; filename="{ascii_name}"; '
                    f"filename*=UTF-8''{quote(raw_name)}"
                )
            },
        )

    @router.delete("/task-templates/{tpl_id}/attachments/{att_id}")
    async def delete_tpl_attachment(tpl_id: str, att_id: str, user: dict = Depends(licensed_user_dep)):
        tpl = await db.task_templates.find_one({"id": tpl_id}, {"_id": 0})
        if not tpl or not _can_manage_template(tpl, user):
            raise HTTPException(status_code=404, detail="Şablon bulunamadı")
        rec = await db.task_template_attachments.find_one(
            {"id": att_id, "task_id": tpl_id, "is_deleted": {"$ne": True}}, {"_id": 0},
        )
        if not rec:
            raise HTTPException(status_code=404, detail="Dosya bulunamadı")
        await db.task_template_attachments.update_one(
            {"id": att_id}, {"$set": {"is_deleted": True, "deleted_at": _now_iso()}},
        )
        return {"deleted": 1}

    return router
