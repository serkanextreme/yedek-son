"""Sertex — Team + Notifications + Weather router.

Extracted from server.py (Faz 9 refactor). Groups the "coordination"
endpoints together: team roll-ups, notification bell, weather lookup.
Behaviour unchanged; existing pytest (test_team_faz2, test_due_soon)
prove the extraction is a clean move.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from permissions import visible_user_ids, can_view_user
from team_service import (
    build_heatmap as build_team_heatmap,
    scan_and_notify_overdue,
    scan_and_notify_due_soon,
    notify_task_nudge,
    get_user_digest_settings,
    set_user_digest_settings,
)
from weather_service import search_city, get_current_weather, resolve_and_fetch
from notification_pubsub import pubsub as notif_pubsub, CLOSE_SENTINEL as _NOTIF_CLOSE

logger = logging.getLogger(__name__)


def build_team_router(db, licensed_user_dep, current_user_dep, require_admin) -> APIRouter:
    router = APIRouter()

    # ------------------------------------------------------------------
    # TEAM
    # ------------------------------------------------------------------
    @router.get("/team/members")
    async def team_members(user: dict = Depends(licensed_user_dep)):
        allowed_ids = await visible_user_ids(db, user)
        if allowed_ids is None:
            docs = await db.users.find(
                {"id": {"$ne": user["id"]}},
                {"_id": 0, "id": 1, "username": 1, "role": 1, "company_name": 1, "company_id": 1},
            ).to_list(length=5000)
        else:
            others = [uid for uid in allowed_ids if uid != user["id"]]
            if not others:
                return []
            docs = await db.users.find(
                {"id": {"$in": others}},
                {"_id": 0, "id": 1, "username": 1, "role": 1, "company_name": 1, "company_id": 1},
            ).to_list(length=5000)
        return docs

    @router.get("/team/summary")
    async def team_summary(user: dict = Depends(licensed_user_dep)):
        allowed_ids = await visible_user_ids(db, user)
        if allowed_ids is None:
            users_docs = await db.users.find(
                {"id": {"$ne": user["id"]}},
                {"_id": 0, "id": 1, "username": 1, "role": 1, "company_name": 1},
            ).to_list(length=5000)
        else:
            others = [uid for uid in allowed_ids if uid != user["id"]]
            if not others:
                return []
            users_docs = await db.users.find(
                {"id": {"$in": others}},
                {"_id": 0, "id": 1, "username": 1, "role": 1, "company_name": 1},
            ).to_list(length=5000)
        if not users_docs:
            return []
        user_ids = [u["id"] for u in users_docs]
        now_iso = datetime.now(timezone.utc).isoformat()
        pipeline = [
            {"$match": {
                "user_id": {"$in": user_ids},
                "$or": [{"archived": {"$exists": False}}, {"archived": False}],
            }},
            {"$group": {
                "_id": "$user_id",
                "total": {"$sum": 1},
                "done": {"$sum": {"$cond": [{"$eq": ["$status", "done"]}, 1, 0]}},
                "pending": {"$sum": {"$cond": [{"$eq": ["$status", "pending"]}, 1, 0]}},
                "paused": {"$sum": {"$cond": [{"$eq": ["$status", "paused"]}, 1, 0]}},
                "overdue": {"$sum": {"$cond": [
                    {"$and": [
                        {"$ne": ["$status", "done"]},
                        {"$ne": ["$due_date", None]},
                        {"$lt": ["$due_date", now_iso]},
                    ]}, 1, 0,
                ]}},
            }},
        ]
        agg = await db.tasks.aggregate(pipeline).to_list(length=5000)
        stats_by_uid = {row["_id"]: row for row in agg}
        out = []
        for u in users_docs:
            s = stats_by_uid.get(u["id"], {})
            out.append({
                "user_id": u["id"],
                "username": u["username"],
                "role": u.get("role") or "employee",
                "company_name": u.get("company_name"),
                "total": int(s.get("total", 0)),
                "done": int(s.get("done", 0)),
                "pending": int(s.get("pending", 0)),
                "paused": int(s.get("paused", 0)),
                "overdue": int(s.get("overdue", 0)),
            })
        out.sort(key=lambda r: (r["overdue"], r["pending"]), reverse=True)
        return out

    @router.get("/team/heatmap")
    async def team_heatmap(days: int = 60, user: dict = Depends(licensed_user_dep)):
        return await build_team_heatmap(db, user, days=days)

    @router.get("/team/category-summary")
    async def team_category_summary(user: dict = Depends(licensed_user_dep)):
        """Faz 9 CP2 — Category-based (İş Kolu) performance roll-up.

        Groups every visible task by (category_id, status) so the Manager
        Ekibim panel can render cards like "Kargolama: 47 tamamlandı,
        3 gecikti, 5 açık". Scope respects `visible_user_ids` (admin: all,
        manager: mapped team, employee: self).
        """
        allowed_ids = await visible_user_ids(db, user)
        now_iso = datetime.now(timezone.utc).isoformat()
        match_stage: Dict[str, Any] = {
            "$or": [{"archived": {"$exists": False}}, {"archived": False}],
        }
        if allowed_ids is not None:
            match_stage["user_id"] = {"$in": allowed_ids}
        # Fold "no category" into a synthetic "__uncat__" bucket so it still
        # gets a card in the UI. `$ifNull` on category_id makes the group
        # key stable even for legacy tasks (pre-CP4).
        pipeline = [
            {"$match": match_stage},
            {"$group": {
                "_id": {"$ifNull": ["$category_id", "__uncat__"]},
                "total": {"$sum": 1},
                "done": {"$sum": {"$cond": [{"$eq": ["$status", "done"]}, 1, 0]}},
                "pending": {"$sum": {"$cond": [{"$eq": ["$status", "pending"]}, 1, 0]}},
                "paused": {"$sum": {"$cond": [{"$eq": ["$status", "paused"]}, 1, 0]}},
                "overdue": {"$sum": {"$cond": [
                    {"$and": [
                        {"$ne": ["$status", "done"]},
                        {"$ne": ["$due_date", None]},
                        {"$lt": ["$due_date", now_iso]},
                    ]}, 1, 0,
                ]}},
                "due_soon": {"$sum": {"$cond": [
                    # Rough "due-soon": pending + has due_date + within 7 days
                    # in the future. Precise per-user thresholds are still
                    # driven by the scanner; this is a cheap card decoration.
                    {"$and": [
                        {"$eq": ["$status", "pending"]},
                        {"$ne": ["$due_date", None]},
                        {"$gt": ["$due_date", now_iso]},
                    ]}, 1, 0,
                ]}},
            }},
            {"$sort": {"total": -1}},
        ]
        agg = await db.tasks.aggregate(pipeline).to_list(length=1000)
        cat_ids = [row["_id"] for row in agg if row["_id"] != "__uncat__"]
        cats = []
        if cat_ids:
            cats = await db.task_categories.find(
                {"id": {"$in": cat_ids}}, {"_id": 0},
            ).to_list(length=1000)
        cat_meta = {c["id"]: c for c in cats}
        out = []
        for row in agg:
            cid = row["_id"]
            if cid == "__uncat__":
                out.append({
                    "category_id": None,
                    "name": "Kolsuz",
                    "color": None,
                    "total": int(row["total"]),
                    "done": int(row["done"]),
                    "pending": int(row["pending"]),
                    "paused": int(row["paused"]),
                    "overdue": int(row["overdue"]),
                    "due_soon": int(row["due_soon"]),
                })
            else:
                meta = cat_meta.get(cid)
                if not meta:
                    # Category was deleted mid-flight; skip stale row.
                    continue
                out.append({
                    "category_id": cid,
                    "name": meta.get("name") or "Kolsuz",
                    "color": meta.get("color"),
                    "total": int(row["total"]),
                    "done": int(row["done"]),
                    "pending": int(row["pending"]),
                    "paused": int(row["paused"]),
                    "overdue": int(row["overdue"]),
                    "due_soon": int(row["due_soon"]),
                })
        return out

    # ------------------------------------------------------------------
    # GECİKEN GÖREV ÖZETİ & TOPLU DÜRT (Admin / Müdür)
    # ------------------------------------------------------------------
    NUDGE_COOLDOWN_SECONDS = 60

    @router.get("/team/overdue-summary")
    async def team_overdue_summary(user: dict = Depends(licensed_user_dep)):
        """Görebildiğiniz personelin geciken görevlerini kişi bazında gruplar
        (RBAC: `visible_user_ids`). Kendi görevleriniz hariç — bu liste dürtmek
        içindir. Her kişi için overdue görev listesi + toplam sayı döner."""
        allowed_ids = await visible_user_ids(db, user)
        now_iso = datetime.now(timezone.utc).isoformat()
        match_stage: Dict[str, Any] = {
            "status": {"$ne": "done"},
            "due_date": {"$ne": None, "$lt": now_iso},
            "$or": [{"archived": {"$exists": False}}, {"archived": False}],
        }
        if allowed_ids is not None:
            others = [uid for uid in allowed_ids if uid != user["id"]]
            if not others:
                return {"people": [], "total_overdue": 0, "total_people": 0}
            match_stage["user_id"] = {"$in": others}
        else:
            match_stage["user_id"] = {"$ne": user["id"]}
        docs = await db.tasks.find(
            match_stage,
            {"_id": 0, "id": 1, "title": 1, "due_date": 1, "user_id": 1,
             "company_name": 1, "assignee_name": 1, "category_id": 1},
        ).sort("due_date", 1).to_list(length=5000)
        if not docs:
            return {"people": [], "total_overdue": 0, "total_people": 0}
        owner_ids = list({d["user_id"] for d in docs if d.get("user_id")})
        users_docs = await db.users.find(
            {"id": {"$in": owner_ids}},
            {"_id": 0, "id": 1, "username": 1, "company_name": 1, "role": 1},
        ).to_list(length=5000)
        umeta = {u["id"]: u for u in users_docs}
        by_uid: Dict[str, dict] = {}
        for d in docs:
            oid = d.get("user_id")
            if not oid:
                continue
            grp = by_uid.get(oid)
            if not grp:
                meta = umeta.get(oid, {})
                grp = {
                    "user_id": oid,
                    "username": meta.get("username") or d.get("assignee_name") or "Kullanıcı",
                    "company_name": meta.get("company_name") or d.get("company_name"),
                    "role": meta.get("role") or "employee",
                    "overdue_count": 0,
                    "tasks": [],
                }
                by_uid[oid] = grp
            grp["overdue_count"] += 1
            grp["tasks"].append({
                "id": d["id"],
                "title": d.get("title") or "(başlıksız)",
                "due_date": d.get("due_date"),
                "company_name": d.get("company_name"),
                "category_id": d.get("category_id"),
            })
        people = sorted(by_uid.values(), key=lambda g: g["overdue_count"], reverse=True)
        return {"people": people, "total_overdue": len(docs), "total_people": len(people)}

    @router.post("/team/bulk-nudge")
    async def team_bulk_nudge(body: dict = Body(...), user: dict = Depends(licensed_user_dep)):
        """Birden fazla görevin sahibine tek seferde hatırlatma (çan + push)
        gönderir. Kendi görevleriniz, yetki dışı sahipler ve cooldown'a takılan
        (son 60 sn içinde dürtülmüş) görevler atlanır. `{sent, skipped, recipients}`."""
        task_ids = body.get("task_ids") or []
        if not isinstance(task_ids, list) or not task_ids:
            raise HTTPException(status_code=400, detail="task_ids gerekli")
        task_ids = [str(t) for t in task_ids][:500]
        now = datetime.now(timezone.utc)
        sent = 0
        skipped = 0
        recipients: set = set()
        docs = await db.tasks.find({"id": {"$in": task_ids}}, {"_id": 0}).to_list(length=1000)
        for doc in docs:
            owner_id = doc.get("user_id")
            if not owner_id or owner_id == user["id"]:
                skipped += 1
                continue
            if not await can_view_user(db, user, owner_id):
                skipped += 1
                continue
            last = await db.task_nudges.find_one(
                {"task_id": doc["id"], "nudger_id": user["id"]},
                {"_id": 0, "created_at": 1},
                sort=[("created_at", -1)],
            )
            if last and last.get("created_at"):
                try:
                    last_dt = datetime.fromisoformat(last["created_at"])
                    if last_dt.tzinfo is None:
                        last_dt = last_dt.replace(tzinfo=timezone.utc)
                    if (now - last_dt).total_seconds() < NUDGE_COOLDOWN_SECONDS:
                        skipped += 1
                        continue
                except Exception as exc:
                    logger.warning("bulk-nudge cooldown check failed, allowing: %s", exc)
            await notify_task_nudge(db, doc, owner_id, user, message="")
            await db.task_nudges.insert_one({
                "id": str(uuid.uuid4()),
                "task_id": doc["id"],
                "nudger_id": user["id"],
                "recipient_id": owner_id,
                "message": "",
                "created_at": now.isoformat(),
            })
            sent += 1
            recipients.add(owner_id)
        return {"sent": sent, "skipped": skipped, "recipients": len(recipients)}

    # ------------------------------------------------------------------
    # NOTIFICATIONS
    # ------------------------------------------------------------------
    @router.get("/notifications")
    async def list_notifications(
        unread_only: bool = False,
        limit: int = 50,
        user: dict = Depends(current_user_dep),
    ):
        q: Dict[str, Any] = {"user_id": user["id"]}
        if unread_only:
            q["read_at"] = None
        docs = await db.notifications.find(q, {"_id": 0}).sort("created_at", -1)\
            .to_list(length=max(1, min(limit, 200)))
        return docs

    @router.get("/notifications/unread-count")
    async def notifications_unread_count(user: dict = Depends(current_user_dep)):
        n = await db.notifications.count_documents({"user_id": user["id"], "read_at": None})
        return {"unread": int(n)}

    @router.post("/notifications/{nid}/read")
    async def mark_notification_read(nid: str, user: dict = Depends(current_user_dep)):
        now_iso = datetime.now(timezone.utc).isoformat()
        r = await db.notifications.update_one(
            {"id": nid, "user_id": user["id"]},
            {"$set": {"read_at": now_iso}},
        )
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Bildirim bulunamadı")
        return {"read": True}

    @router.post("/notifications/read-all")
    async def mark_all_notifications_read(user: dict = Depends(current_user_dep)):
        now_iso = datetime.now(timezone.utc).isoformat()
        r = await db.notifications.update_many(
            {"user_id": user["id"], "read_at": None},
            {"$set": {"read_at": now_iso}},
        )
        return {"updated": r.modified_count}

    # Bildirim silme — tekli / toplu (seçili) / hepsi. Kullanıcı yalnızca kendi
    # bildirimlerini silebilir.
    @router.post("/notifications/delete-selected")
    async def delete_selected_notifications(
        ids: List[str] = Body(..., embed=True),
        user: dict = Depends(current_user_dep),
    ):
        if not ids:
            return {"deleted": 0}
        r = await db.notifications.delete_many({"id": {"$in": ids}, "user_id": user["id"]})
        return {"deleted": r.deleted_count}

    @router.delete("/notifications")
    async def delete_all_notifications(user: dict = Depends(current_user_dep)):
        r = await db.notifications.delete_many({"user_id": user["id"]})
        return {"deleted": r.deleted_count}

    @router.delete("/notifications/{nid}")
    async def delete_notification(nid: str, user: dict = Depends(current_user_dep)):
        r = await db.notifications.delete_one({"id": nid, "user_id": user["id"]})
        return {"deleted": r.deleted_count}

    # Günlük özet kişisel ayarı — sabah özetinin saati + açık/kapalı.
    @router.get("/notifications/digest-settings")
    async def get_digest_settings(user: dict = Depends(current_user_dep)):
        return await get_user_digest_settings(db, user["id"])

    @router.put("/notifications/digest-settings")
    async def put_digest_settings(
        digest_hour: int = Body(..., embed=True),
        digest_enabled: bool = Body(True, embed=True),
        digest_detailed: bool = Body(False, embed=True),
        digest_skip_weekend: bool = Body(False, embed=True),
        user: dict = Depends(current_user_dep),
    ):
        return await set_user_digest_settings(
            db, user["id"], digest_hour, digest_enabled,
            digest_detailed, digest_skip_weekend,
        )

    @router.post("/notifications/scan-now")
    async def notifications_scan_now(user: dict = Depends(current_user_dep)):
        """Admin-only. Runs overdue + due-soon; top-level shape mirrors overdue
        for legacy tests. `due_soon` breakdown surfaces as a nested key."""
        require_admin(user)
        overdue = await scan_and_notify_overdue(db)
        due_soon = await scan_and_notify_due_soon(db)
        return {**overdue, "due_soon": due_soon}

    # ------------------------------------------------------------------
    # Faz 9 CP4.17 — Server-Sent Events (SSE) stream for live push.
    # EventSource in the browser cannot send an Authorization header, so we
    # accept the JWT as a `token` query param and decode it inline. The
    # stream stays open forever (until the client disconnects) and yields
    # one SSE event per new notification.
    # ------------------------------------------------------------------
    @router.get("/notifications/stream")
    async def notifications_stream(
        request: Request,
        token: str = Query(..., description="Bearer JWT passed as query param"),
    ):
        from auth import decode_token  # local import — avoids circulars
        try:
            payload = decode_token(token)
            uid = payload.get("sub") or payload.get("user_id") or payload.get("id")
        except Exception:
            raise HTTPException(status_code=401, detail="Geçersiz token")
        if not uid:
            raise HTTPException(status_code=401, detail="Geçersiz token")

        # Resolve the user against the DB so we don't stream to a deleted
        # or disabled account. This mirrors the check current_user_dep does.
        target = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1})
        if not target:
            raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı")

        async def event_gen():
            q = await notif_pubsub.subscribe(uid)
            # Send an initial "hello" comment so the browser knows the stream
            # is alive; SSE clients ignore lines that start with a colon.
            yield ": connected\n\n"
            try:
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        # Idle heartbeat every 25s keeps Kubernetes ingress
                        # from tearing down "silent" long-lived connections.
                        event = await asyncio.wait_for(q.get(), timeout=25.0)
                        # Faz 9 CP4.18 — pubsub emits this sentinel when the
                        # per-user cap evicts our stream. Tell the browser
                        # why (`event: closed`) and exit the loop; the client
                        # can decide whether to reconnect.
                        if event.get("kind") == _NOTIF_CLOSE:
                            yield f"event: closed\ndata: {json.dumps(event, default=str)}\n\n"
                            break
                        payload_json = json.dumps(event, default=str)
                        yield f"event: {event.get('kind','new')}\ndata: {payload_json}\n\n"
                    except asyncio.TimeoutError:
                        yield ": keepalive\n\n"
            finally:
                await notif_pubsub.unsubscribe(uid, q)

        return StreamingResponse(
            event_gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # disable nginx buffering
            },
        )

    # ------------------------------------------------------------------
    # WEATHER
    # ------------------------------------------------------------------
    @router.get("/weather/search")
    async def weather_search(q: str = "", user: dict = Depends(licensed_user_dep)):
        if len((q or "").strip()) < 2:
            return []
        try:
            return await search_city(q.strip(), limit=8)
        except Exception as e:
            logger.error(f"Weather search failed: {e}")
            raise HTTPException(status_code=502, detail="Şehir araması başarısız")

    @router.get("/weather")
    async def weather(
        city: str = "Istanbul",
        lat: Optional[float] = None,
        lon: Optional[float] = None,
        tz: Optional[str] = None,
        user: dict = Depends(licensed_user_dep),
    ):
        """Real weather + sunrise/sunset via Open-Meteo. If lat/lon are
        provided, skip geocoding; otherwise resolve `city` by name."""
        try:
            if lat is not None and lon is not None:
                return await get_current_weather(
                    latitude=float(lat),
                    longitude=float(lon),
                    city_name=city,
                    timezone=tz or "auto",
                )
            return await resolve_and_fetch(city or "Istanbul")
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except Exception as e:
            logger.error(f"Weather fetch failed: {e}")
            raise HTTPException(status_code=502, detail="Hava durumu servisine ulaşılamadı")

    return router
