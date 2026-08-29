"""FastAPI router for file management: upload, list, download, summarize, ask, delete, RAG index."""
import logging
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, BackgroundTasks, Response
from pydantic import BaseModel

from file_service import (
    FileRecord,
    MAX_UPLOAD_BYTES,
    get_extension,
    is_supported_extension,
    extract_content,
    summarize_text,
    answer_question,
)
from storage_service import put_object, get_object, build_upload_path
from rag_service import (
    index_file as rag_index_file,
    delete_chunks_for_file,
    count_chunks,
)

logger = logging.getLogger(__name__)


def build_files_router(db, current_user):
    """Factory that binds a router to the shared db + current_user dependency."""

    router = APIRouter(prefix="/files", tags=["files"])

    class AskRequest(BaseModel):
        question: str

    async def _get_owned_file(file_id: str, user_id: str) -> dict:
        doc = await db.files.find_one(
            {"id": file_id, "user_id": user_id, "is_deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Dosya bulunamadı")
        return doc

    async def _index_file_task(file_id: str, user_id: str, filename: str, text: str):
        """Background task: chunk + embed + persist. Updates file record with status."""
        try:
            await db.files.update_one(
                {"id": file_id, "user_id": user_id},
                {"$set": {"rag_status": "indexing", "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
            result = await rag_index_file(
                db,
                file_id=file_id,
                user_id=user_id,
                filename=filename,
                text=text,
            )
            await db.files.update_one(
                {"id": file_id, "user_id": user_id},
                {"$set": {
                    "rag_status": result["status"],
                    "rag_chunks": result.get("chunks", 0),
                    "rag_error": result.get("error"),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
        except Exception as e:
            logger.exception(f"Auto-index failed for {file_id}")
            await db.files.update_one(
                {"id": file_id, "user_id": user_id},
                {"$set": {"rag_status": "failed", "rag_error": str(e)[:300]}},
            )

    @router.post("", response_model=FileRecord)
    async def upload_file(
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        user: dict = Depends(current_user),
    ):
        # ---- Validate ----
        filename = (file.filename or "upload.bin").strip()
        ext = get_extension(filename)
        if not is_supported_extension(ext):
            raise HTTPException(
                status_code=400,
                detail=f".{ext} formatı desteklenmiyor. Desteklenen: PDF, Word, Excel, PowerPoint, TXT, CSV, Görsel, Ses",
            )

        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Boş dosya")
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"Dosya çok büyük: {len(data)/1024/1024:.1f} MB (maks 50 MB)",
            )

        content_type = file.content_type or "application/octet-stream"

        # ---- Upload to object storage ----
        try:
            storage_path = build_upload_path(user["id"], filename)
            storage_result = put_object(storage_path, data, content_type)
            canonical_path = storage_result.get("path", storage_path)
        except Exception as e:
            logger.exception("Storage upload failed")
            raise HTTPException(status_code=502, detail=f"Depolama hatası: {str(e)[:200]}")

        # ---- Extract content ----
        extraction = await extract_content(data, filename, content_type)

        record = FileRecord(
            user_id=user["id"],
            original_filename=filename,
            storage_path=canonical_path,
            content_type=content_type,
            extension=ext,
            category=extraction["category"],
            size=len(data),
            extracted_text=extraction["text"],
            extracted_chars=len(extraction["text"] or ""),
            extraction_status=extraction["status"],
            extraction_error=extraction["error"],
        )
        doc = record.model_dump()
        # Initialize RAG status
        doc["rag_status"] = "pending" if extraction["text"] and extraction["text"].strip() else "empty"
        doc["rag_chunks"] = 0
        doc["rag_error"] = None
        await db.files.insert_one(doc)

        # Schedule background indexing when we have content
        if doc["rag_status"] == "pending":
            background_tasks.add_task(
                _index_file_task,
                record.id,
                user["id"],
                filename,
                extraction["text"],
            )

        # Reflect the persisted rag_status back on the returned record
        return FileRecord(**{**doc, "id": record.id})

    @router.get("", response_model=List[FileRecord])
    async def list_files(user: dict = Depends(current_user)):
        docs = await db.files.find(
            {"user_id": user["id"], "is_deleted": {"$ne": True}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(length=500)
        # Strip extracted_text from list view (can be huge)
        for d in docs:
            d["extracted_text"] = ""
        return [FileRecord(**d) for d in docs]

    @router.get("/rag/status")
    async def rag_status(user: dict = Depends(current_user)):
        """Aggregate RAG index stats for the current user."""
        pipeline = [
            {"$match": {"user_id": user["id"], "is_deleted": {"$ne": True}}},
            {"$group": {
                "_id": "$rag_status",
                "count": {"$sum": 1},
                "chunks": {"$sum": {"$ifNull": ["$rag_chunks", 0]}},
            }},
        ]
        buckets = await db.files.aggregate(pipeline).to_list(length=20)
        stats = {b["_id"] or "unknown": {"files": b["count"], "chunks": b["chunks"]} for b in buckets}
        total_chunks = await count_chunks(db, user["id"])
        return {"buckets": stats, "total_chunks": total_chunks}

    @router.post("/rag/reindex-all")
    async def reindex_all(
        background_tasks: BackgroundTasks,
        user: dict = Depends(current_user),
    ):
        """Kick off background indexing for every un-indexed file this user owns."""
        cursor = db.files.find(
            {
                "user_id": user["id"],
                "is_deleted": {"$ne": True},
                "$or": [
                    {"rag_status": {"$exists": False}},
                    {"rag_status": {"$in": ["pending", "failed", None]}},
                    {"rag_status": "empty"},
                ],
            },
            {"_id": 0, "id": 1, "original_filename": 1, "extracted_text": 1, "extraction_status": 1},
        )
        docs = await cursor.to_list(length=1000)
        scheduled = 0
        for d in docs:
            text = d.get("extracted_text") or ""
            if not text.strip():
                continue
            await db.files.update_one(
                {"id": d["id"], "user_id": user["id"]},
                {"$set": {"rag_status": "indexing", "rag_error": None}},
            )
            background_tasks.add_task(
                _index_file_task, d["id"], user["id"], d["original_filename"], text
            )
            scheduled += 1
        return {"scheduled": scheduled, "total_candidates": len(docs)}

    @router.get("/{file_id}", response_model=FileRecord)
    async def get_file(file_id: str, user: dict = Depends(current_user)):
        doc = await _get_owned_file(file_id, user["id"])
        return FileRecord(**doc)

    @router.get("/{file_id}/download")
    async def download_file(
        file_id: str,
        user: dict = Depends(current_user),
    ):
        doc = await _get_owned_file(file_id, user["id"])
        try:
            data, ct = get_object(doc["storage_path"])
        except Exception as e:
            logger.exception("Storage download failed")
            raise HTTPException(status_code=502, detail="Depolamadan indirme başarısız")
        headers = {
            "Content-Disposition": f'attachment; filename="{doc["original_filename"]}"'
        }
        return Response(
            content=data,
            media_type=doc.get("content_type") or ct,
            headers=headers,
        )

    @router.post("/{file_id}/summarize")
    async def summarize_file(file_id: str, user: dict = Depends(current_user)):
        doc = await _get_owned_file(file_id, user["id"])
        if not doc.get("extracted_text"):
            raise HTTPException(
                status_code=400,
                detail="Bu dosya için çıkarılmış içerik bulunmuyor",
            )
        if doc.get("summary"):
            return {"summary": doc["summary"], "cached": True}
        try:
            summary = await summarize_text(
                doc["extracted_text"], doc["original_filename"]
            )
        except Exception as e:
            logger.exception("Summarize failed")
            raise HTTPException(status_code=500, detail=f"Özetleme hatası: {str(e)[:200]}")
        await db.files.update_one(
            {"id": file_id, "user_id": user["id"]},
            {"$set": {"summary": summary, "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        return {"summary": summary, "cached": False}

    @router.post("/{file_id}/ask")
    async def ask_file(file_id: str, req: AskRequest, user: dict = Depends(current_user)):
        q = (req.question or "").strip()
        if len(q) < 2:
            raise HTTPException(status_code=400, detail="Soru çok kısa")
        doc = await _get_owned_file(file_id, user["id"])
        if not doc.get("extracted_text"):
            raise HTTPException(
                status_code=400,
                detail="Bu dosyanın içeriği çıkarılamamış",
            )
        try:
            answer = await answer_question(
                doc["extracted_text"], q, doc["original_filename"]
            )
        except Exception as e:
            logger.exception("Q&A failed")
            raise HTTPException(status_code=500, detail=f"Yanıt hatası: {str(e)[:200]}")
        return {"answer": answer, "file_id": file_id, "question": q}

    @router.post("/{file_id}/reindex")
    async def reindex_file(
        file_id: str,
        background_tasks: BackgroundTasks,
        user: dict = Depends(current_user),
    ):
        """Force re-indexing of the file into the RAG store."""
        doc = await _get_owned_file(file_id, user["id"])
        text = doc.get("extracted_text") or ""
        if not text.strip():
            raise HTTPException(
                status_code=400,
                detail="Bu dosyanın içeriği çıkarılamamış — yeniden indekslenemez",
            )
        await db.files.update_one(
            {"id": file_id, "user_id": user["id"]},
            {"$set": {"rag_status": "indexing", "rag_error": None}},
        )
        background_tasks.add_task(
            _index_file_task, file_id, user["id"], doc["original_filename"], text
        )
        return {"status": "indexing", "file_id": file_id}

    @router.delete("/{file_id}")
    async def delete_file(file_id: str, user: dict = Depends(current_user)):
        r = await db.files.update_one(
            {"id": file_id, "user_id": user["id"]},
            {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Dosya bulunamadı")
        # Also purge the file's RAG chunks
        removed = await delete_chunks_for_file(db, file_id, user["id"])
        return {"deleted": 1, "chunks_removed": removed}

    return router
