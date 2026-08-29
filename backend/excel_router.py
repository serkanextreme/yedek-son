"""FastAPI router for Excel automation — Faz 3."""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Response
from pydantic import BaseModel

from storage_service import get_object
from excel_service import (
    load_workbook,
    analyze_workbook,
    generate_formula,
    answer_data_question,
    build_pivot_xlsx,
    suggest_charts,
    chart_data,
)

logger = logging.getLogger(__name__)


def build_excel_router(db, current_user):
    router = APIRouter(prefix="/excel", tags=["excel"])

    class FormulaRequest(BaseModel):
        task: str
        sheet: Optional[str] = None

    class QueryRequest(BaseModel):
        question: str

    class PivotRequest(BaseModel):
        task: str
        sheet: Optional[str] = None

    async def _load_owned_workbook(file_id: str, user_id: str):
        doc = await db.files.find_one(
            {"id": file_id, "user_id": user_id, "is_deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Dosya bulunamadı")
        if doc.get("category") != "spreadsheet":
            raise HTTPException(
                status_code=400,
                detail="Bu dosya bir Excel/CSV değil",
            )
        try:
            data, _ct = get_object(doc["storage_path"])
        except Exception as e:
            logger.exception("Storage fetch failed")
            raise HTTPException(status_code=502, detail="Dosya depodan alınamadı")
        try:
            sheets = load_workbook(data)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if not sheets:
            raise HTTPException(status_code=400, detail="Dosyada okunacak sayfa yok")
        return doc, sheets

    @router.get("/{file_id}/analyze")
    async def analyze(file_id: str, user: dict = Depends(current_user)):
        doc, sheets = await _load_owned_workbook(file_id, user["id"])
        try:
            result = await analyze_workbook(sheets, doc["original_filename"])
        except Exception as e:
            logger.exception("Analyze failed")
            raise HTTPException(status_code=500, detail=f"Analiz hatası: {str(e)[:200]}")
        return {"file_id": file_id, **result}

    @router.post("/{file_id}/formula")
    async def formula(
        file_id: str,
        req: FormulaRequest,
        user: dict = Depends(current_user),
    ):
        task = (req.task or "").strip()
        if len(task) < 3:
            raise HTTPException(status_code=400, detail="Görev çok kısa")
        doc, sheets = await _load_owned_workbook(file_id, user["id"])
        try:
            result = await generate_formula(
                sheets, task, doc["original_filename"], target_sheet=req.sheet
            )
        except Exception as e:
            logger.exception("Formula gen failed")
            raise HTTPException(status_code=500, detail=f"Formül üretim hatası: {str(e)[:200]}")
        return {"file_id": file_id, **result}

    @router.post("/{file_id}/query")
    async def query(
        file_id: str,
        req: QueryRequest,
        user: dict = Depends(current_user),
    ):
        q = (req.question or "").strip()
        if len(q) < 3:
            raise HTTPException(status_code=400, detail="Soru çok kısa")
        doc, sheets = await _load_owned_workbook(file_id, user["id"])
        try:
            result = await answer_data_question(sheets, q, doc["original_filename"])
        except Exception as e:
            logger.exception("Query failed")
            raise HTTPException(status_code=500, detail=f"Sorgu hatası: {str(e)[:200]}")
        return {"file_id": file_id, **result}

    @router.post("/{file_id}/pivot")
    async def pivot(
        file_id: str,
        req: PivotRequest,
        user: dict = Depends(current_user),
    ):
        task = (req.task or "").strip()
        if len(task) < 3:
            raise HTTPException(status_code=400, detail="Görev çok kısa")
        doc, sheets = await _load_owned_workbook(file_id, user["id"])
        try:
            result = await build_pivot_xlsx(
                sheets, task, doc["original_filename"], target_sheet=req.sheet
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.exception("Pivot failed")
            raise HTTPException(status_code=500, detail=f"Pivot hatası: {str(e)[:200]}")
        # Cache the xlsx bytes on disk under /tmp keyed by file_id
        import base64
        payload = {
            "spec": result["spec"],
            "sheet_used": result["sheet_used"],
            "shape": result["shape"],
            "columns": result["columns"],
            "preview": result["preview"],
            "xlsx_b64": base64.b64encode(result["xlsx_bytes"]).decode("ascii"),
        }
        return {"file_id": file_id, **payload}

    @router.get("/{file_id}/charts")
    async def charts(file_id: str, user: dict = Depends(current_user)):
        doc, sheets = await _load_owned_workbook(file_id, user["id"])
        try:
            items = await suggest_charts(sheets, doc["original_filename"])
        except Exception as e:
            logger.exception("Chart suggest failed")
            raise HTTPException(status_code=500, detail=f"Grafik öneri hatası: {str(e)[:200]}")
        return {"file_id": file_id, "charts": items}

    class ChartDataRequest(BaseModel):
        sheet: str
        x: str
        y: Optional[str] = None
        agg: str = "sum"
        limit: int = 50

    @router.post("/{file_id}/chart-data")
    async def chart_data_endpoint(
        file_id: str,
        req: ChartDataRequest,
        user: dict = Depends(current_user),
    ):
        doc, sheets = await _load_owned_workbook(file_id, user["id"])
        try:
            result = chart_data(
                sheets,
                sheet=req.sheet,
                x=req.x,
                y=req.y,
                agg=req.agg,
                limit=max(1, min(req.limit, 200)),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.exception("Chart data failed")
            raise HTTPException(status_code=500, detail=f"Veri hazırlama hatası: {str(e)[:200]}")
        return {"file_id": file_id, **result}

    return router
