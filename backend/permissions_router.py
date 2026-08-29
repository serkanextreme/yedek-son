"""Faz 8 — Multi-tenant RBAC CRUD endpoints (admin-only).

Exposes:
  /api/companies              CRUD
  /api/manager-visibility     CRUD
  /api/company-permissions    CRUD
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import require_admin
from permissions import (
    Company,
    CompanyCreate,
    CompanyUpdate,
    ManagerVisibility,
    ManagerVisibilityCreate,
    CompanyPermission,
    CompanyPermissionCreate,
    get_or_create_company,
    normalize_role,
    acting_role,
    is_super_admin,
    get_admin_caps,
    admin_effective_company_ids,
)


def build_permissions_router(db, current_user_dep) -> APIRouter:
    router = APIRouter()

    # -----------------------------------------------------------------
    # Companies
    # -----------------------------------------------------------------
    @router.get("/companies")
    async def list_companies(user: dict = Depends(current_user_dep)):
        """Süper yönetici tüm şirketleri; yönetici yalnızca etkin şirketlerini
        (kendi + tanınan ek şirketler); diğerleri yalnızca kendi şirketini görür."""
        if is_super_admin(user):
            return await db.companies.find({}, {"_id": 0}).sort("name", 1).to_list(length=2000)
        if acting_role(user) == "admin":
            eff = admin_effective_company_ids(user)
            if not eff:
                return []
            return await db.companies.find(
                {"id": {"$in": eff}}, {"_id": 0}).sort("name", 1).to_list(length=2000)
        cid = user.get("company_id")
        if not cid:
            return []
        return await db.companies.find({"id": cid}, {"_id": 0}).sort("name", 1).to_list(length=2000)

    @router.post("/companies", response_model=Company)
    async def create_company(req: CompanyCreate, user: dict = Depends(current_user_dep)):
        # Şirket açma: süper yönetici serbest. Yönetici yalnızca kendisine
        # 'can_create_company' yetkisi tanındıysa açabilir.
        if not is_super_admin(user):
            if not (acting_role(user) == "admin" and get_admin_caps(user).get("can_create_company")):
                raise HTTPException(status_code=403, detail="Yeni şirket açma yetkiniz yok")
        name = (req.name or "").strip()
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Şirket adı en az 2 karakter olmalı")
        try:
            doc = await get_or_create_company(db, name, created_by=user["id"])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return Company(**doc)

    @router.patch("/companies/{cid}", response_model=Company)
    async def update_company(cid: str, req: CompanyUpdate, user: dict = Depends(current_user_dep)):
        # Faz 8 CP5 — Admin can update any company. Manager can update
        # `due_soon_threshold` for their OWN company only. Name changes still
        # require admin (organization-wide identity).
        role = acting_role(user)
        is_admin = role == "admin"
        is_own_manager = (
            role == "manager"
            and user.get("company_id") == cid
        )
        if not (is_admin or is_own_manager):
            raise HTTPException(status_code=403, detail="Yetkiniz yok")
        existing = await db.companies.find_one({"id": cid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Şirket bulunamadı")
        set_ops: dict = {}
        unset_ops: dict = {}
        if req.name is not None:
            if not is_admin:
                raise HTTPException(status_code=403, detail="Şirket adını sadece admin değiştirebilir")
            name = req.name.strip()
            if len(name) < 2:
                raise HTTPException(status_code=400, detail="Şirket adı en az 2 karakter olmalı")
            # Uniqueness check (case-insensitive, excluding self).
            import re as _re
            dup = await db.companies.find_one({
                "name": {"$regex": f"^{_re.escape(name)}$", "$options": "i"},
                "id": {"$ne": cid},
            })
            if dup:
                raise HTTPException(status_code=400, detail="Bu isimde başka bir şirket var")
            set_ops["name"] = name
        if req.due_soon_threshold is not None:
            # Whitelist same as tasks. Negative/0 → clear (null).
            allowed = {1, 2, 3, 5, 7, 14}
            v = req.due_soon_threshold
            if v <= 0:
                unset_ops["due_soon_threshold"] = ""
            elif v not in allowed:
                raise HTTPException(status_code=400, detail="Geçersiz eşik: 1/2/3/5/7/14 gün")
            else:
                set_ops["due_soon_threshold"] = int(v)
        if set_ops or unset_ops:
            op: dict = {}
            if set_ops:
                op["$set"] = set_ops
            if unset_ops:
                op["$unset"] = unset_ops
            await db.companies.update_one({"id": cid}, op)
            # Also sync denormalized users.company_name for legacy readers.
            if "name" in set_ops:
                await db.users.update_many({"company_id": cid}, {"$set": {"company_name": set_ops["name"]}})
        updated = await db.companies.find_one({"id": cid}, {"_id": 0})
        return Company(**updated)

    @router.delete("/companies/{cid}")
    async def delete_company(cid: str, user: dict = Depends(current_user_dep)):
        require_admin(user)
        existing = await db.companies.find_one({"id": cid})
        if not existing:
            raise HTTPException(status_code=404, detail="Şirket bulunamadı")
        # Block deletion if anyone still belongs to this company (primary or
        # secondary membership). company_ids-only members are also protected.
        member_count = await db.users.count_documents(
            {"$or": [{"company_id": cid}, {"company_ids": cid}]},
        )
        if member_count > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Bu şirketin {member_count} üyesi var. Önce üyeleri başka şirkete alın.",
            )
        await db.companies.delete_one({"id": cid})
        # Cascade: remove company_permissions rows touching this company.
        await db.company_permissions.delete_many(
            {"$or": [{"viewer_company_id": cid}, {"target_company_id": cid}]},
        )
        return {"deleted": True}

    # -----------------------------------------------------------------
    # Faz 8 CP6 — Company members (multi-company assignments)
    # -----------------------------------------------------------------
    @router.get("/companies/{cid}/members")
    async def list_company_members(cid: str, user: dict = Depends(current_user_dep)):
        """List every user whose `company_ids` contains `cid`. Visible to
        admin (any company) or to a member of the target company."""
        from permissions import get_user_company_ids as _gcids
        role = acting_role(user)
        if role != "admin" and cid not in _gcids(user):
            raise HTTPException(status_code=403, detail="Yetkiniz yok")
        docs = await db.users.find(
            {"$or": [{"company_id": cid}, {"company_ids": cid}]},
            {"_id": 0, "id": 1, "username": 1, "role": 1, "company_id": 1, "company_ids": 1, "email": 1},
        ).sort("username", 1).to_list(length=5000)
        return docs

    @router.post("/companies/{cid}/members/{uid}")
    async def add_company_member(cid: str, uid: str, user: dict = Depends(current_user_dep)):
        """Admin can add anyone anywhere. A manager can add users to their
        OWN company only (must be a member of `cid`)."""
        from permissions import get_user_company_ids as _gcids
        role = acting_role(user)
        if role == "admin":
            pass
        elif role == "manager" and cid in _gcids(user):
            pass
        else:
            raise HTTPException(status_code=403, detail="Yetkiniz yok")
        company = await db.companies.find_one({"id": cid})
        if not company:
            raise HTTPException(status_code=404, detail="Şirket bulunamadı")
        target = await db.users.find_one({"id": uid})
        if not target:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        current = _gcids(target)
        if cid in current:
            # Idempotent — already a member.
            return {"added": False, "company_ids": current}
        new_list = current + [cid]
        set_ops: dict = {"company_ids": new_list}
        # If primary company_id is missing, adopt this one so legacy readers
        # keep working.
        if not target.get("company_id"):
            set_ops["company_id"] = cid
            # Denormalized name for legacy display in some panels.
            set_ops["company_name"] = company["name"]
        await db.users.update_one({"id": uid}, {"$set": set_ops})
        return {"added": True, "company_ids": new_list}

    @router.delete("/companies/{cid}/members/{uid}")
    async def remove_company_member(cid: str, uid: str, user: dict = Depends(current_user_dep)):
        """Admin can remove anyone. Manager can remove members from their
        own company only. On removal, active tasks tied to this company for
        the target user are flipped to `orphaned=True` so the company's
        manager can reclaim them from the "Yarım Kalan İşler" tab."""
        from permissions import get_user_company_ids as _gcids
        role = acting_role(user)
        if role == "admin":
            pass
        elif role == "manager" and cid in _gcids(user):
            pass
        else:
            raise HTTPException(status_code=403, detail="Yetkiniz yok")
        target = await db.users.find_one({"id": uid})
        if not target:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        current = _gcids(target)
        if cid not in current:
            return {"removed": False, "company_ids": current}
        new_list = [c for c in current if c != cid]
        set_ops: dict = {"company_ids": new_list}
        # If we removed the primary, promote the next remaining membership
        # (or clear it entirely if none left).
        if target.get("company_id") == cid:
            if new_list:
                set_ops["company_id"] = new_list[0]
                # Refresh denormalized company_name too.
                next_company = await db.companies.find_one(
                    {"id": new_list[0]}, {"_id": 0, "name": 1},
                )
                set_ops["company_name"] = (next_company or {}).get("name") or ""
            else:
                set_ops["company_id"] = None
                set_ops["company_name"] = ""
        await db.users.update_one({"id": uid}, {"$set": set_ops})
        # Faz 10 — Offboard the user from this company: archive finished tasks,
        # move unfinished tasks into the orphan pool and (if a manager exists)
        # re-assign them to the company's manager + notify.
        from team_service import offboard_user_from_company
        summary = await offboard_user_from_company(
            db, uid, cid, actor=user, target_doc=target,
        )
        return {
            "removed": True,
            "company_ids": new_list,
            "orphaned_tasks": summary["orphaned"],
            "archived_tasks": summary["archived"],
        }

    # -----------------------------------------------------------------
    # Manager visibility
    # -----------------------------------------------------------------
    @router.get("/manager-visibility")
    async def list_manager_visibility(
        manager_user_id: Optional[str] = None,
        user: dict = Depends(current_user_dep),
    ):
        require_admin(user)
        q: dict = {}
        if manager_user_id:
            q["manager_user_id"] = manager_user_id
        docs = await db.manager_visibility.find(q, {"_id": 0}).to_list(length=5000)
        return docs

    @router.post("/manager-visibility", response_model=ManagerVisibility)
    async def create_manager_visibility(
        req: ManagerVisibilityCreate, user: dict = Depends(current_user_dep),
    ):
        require_admin(user)
        # Validate referenced users exist AND roles are correct.
        manager = await db.users.find_one({"id": req.manager_user_id})
        if not manager:
            raise HTTPException(status_code=404, detail="Müdür bulunamadı")
        if normalize_role(manager.get("role")) != "manager":
            raise HTTPException(status_code=400, detail="Hedef kullanıcı müdür değil")
        employee = await db.users.find_one({"id": req.employee_user_id})
        if not employee:
            raise HTTPException(status_code=404, detail="Çalışan bulunamadı")
        if normalize_role(employee.get("role")) not in ("employee", "manager"):
            raise HTTPException(
                status_code=400,
                detail="Hedef çalışan yönetici rolünde olamaz",
            )
        if req.manager_user_id == req.employee_user_id:
            raise HTTPException(status_code=400, detail="Müdür kendini atayamaz")
        # Upsert to make this idempotent.
        existing = await db.manager_visibility.find_one({
            "manager_user_id": req.manager_user_id,
            "employee_user_id": req.employee_user_id,
        }, {"_id": 0})
        if existing:
            return ManagerVisibility(**existing)
        row = ManagerVisibility(
            manager_user_id=req.manager_user_id,
            employee_user_id=req.employee_user_id,
            granted_by=user["id"],
        )
        await db.manager_visibility.insert_one(row.model_dump())
        return row

    @router.delete("/manager-visibility/{mvid}")
    async def delete_manager_visibility(mvid: str, user: dict = Depends(current_user_dep)):
        require_admin(user)
        r = await db.manager_visibility.delete_one({"id": mvid})
        if not r.deleted_count:
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
        return {"deleted": True}

    # -----------------------------------------------------------------
    # Company permissions (cross-company visibility grants)
    # -----------------------------------------------------------------
    @router.get("/company-permissions")
    async def list_company_permissions(
        viewer_company_id: Optional[str] = None,
        target_company_id: Optional[str] = None,
        status: Optional[str] = None,
        user: dict = Depends(current_user_dep),
    ):
        """List cross-company grants. Admin sees all. A manager sees grants
        touching any of their own companies (as viewer or target — so they
        can see pending requests directed at them too)."""
        from permissions import get_user_company_ids as _gcids
        role = acting_role(user)
        q: dict = {}
        if viewer_company_id:
            q["viewer_company_id"] = viewer_company_id
        if target_company_id:
            q["target_company_id"] = target_company_id
        if status:
            q["status"] = status
        if role != "admin":
            own = _gcids(user)
            if not own:
                return []
            q["$or"] = [
                {"viewer_company_id": {"$in": own}},
                {"target_company_id": {"$in": own}},
            ]
        docs = await db.company_permissions.find(q, {"_id": 0}).to_list(length=5000)
        return docs

    @router.post("/company-permissions", response_model=CompanyPermission)
    async def create_company_permission(
        req: CompanyPermissionCreate, user: dict = Depends(current_user_dep),
    ):
        """Admin: instantly creates an ACTIVE grant. Manager: creates a
        PENDING request from their own company. The target company's manager
        must approve via the /respond endpoint before it turns active."""
        from permissions import get_user_company_ids as _gcids
        # Faz 9 CP1 — fan-out cross-perm notifications to relevant managers.
        from team_service import (
            notify_cross_perm_request as _fanout_request,
            notify_cross_perm_response as _fanout_response,
        )
        role = acting_role(user)
        if req.viewer_company_id == req.target_company_id:
            raise HTTPException(
                status_code=400,
                detail="Bir şirket zaten kendini görebilir",
            )
        viewer = await db.companies.find_one({"id": req.viewer_company_id})
        target = await db.companies.find_one({"id": req.target_company_id})
        if not viewer or not target:
            raise HTTPException(status_code=404, detail="Şirket bulunamadı")
        if role == "admin":
            initial_status = "active"
        elif role == "manager" and req.viewer_company_id in _gcids(user):
            initial_status = "pending"
        else:
            raise HTTPException(status_code=403, detail="Yetkiniz yok")
        existing = await db.company_permissions.find_one({
            "viewer_company_id": req.viewer_company_id,
            "target_company_id": req.target_company_id,
        }, {"_id": 0})
        if existing:
            if role != "admin" and existing.get("status") in ("declined", "revoked"):
                await db.company_permissions.update_one(
                    {"id": existing["id"]},
                    {"$set": {
                        "status": "pending",
                        "requested_by": user["id"],
                        "responded_by": None,
                        "responded_at": None,
                    }},
                )
                refreshed = await db.company_permissions.find_one({"id": existing["id"]}, {"_id": 0})
                await _fanout_request(db, refreshed)
                return CompanyPermission(**refreshed)
            return CompanyPermission(**existing)
        row = CompanyPermission(
            viewer_company_id=req.viewer_company_id,
            target_company_id=req.target_company_id,
            granted_by=user["id"] if initial_status == "active" else None,
            status=initial_status,
            requested_by=user["id"],
        )
        await db.company_permissions.insert_one(row.model_dump())
        row_dict = row.model_dump()
        # Fire notifications:
        #   * pending → notify TARGET managers so they can approve
        #   * active (admin-created) → notify VIEWER managers so they know
        #     they just gained visibility
        if initial_status == "pending":
            await _fanout_request(db, row_dict)
        elif initial_status == "active":
            await _fanout_response(db, row_dict, approved=True)
        return row

    @router.post("/company-permissions/{cpid}/respond")
    async def respond_company_permission(
        cpid: str,
        approve: bool,
        user: dict = Depends(current_user_dep),
    ):
        """Target-company manager (or admin) approves or declines a pending
        cross-company request. Approving flips status to `active`; declining
        flips to `declined`."""
        from permissions import get_user_company_ids as _gcids
        from team_service import notify_cross_perm_response as _fanout_response
        row = await db.company_permissions.find_one({"id": cpid}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="İstek bulunamadı")
        role = acting_role(user)
        if role == "admin":
            pass
        elif role == "manager" and row.get("target_company_id") in _gcids(user):
            pass
        else:
            raise HTTPException(status_code=403, detail="Yetkiniz yok")
        if row.get("status") not in ("pending", "declined", "revoked"):
            raise HTTPException(status_code=400, detail="Bu istek zaten yanıtlanmış")
        now_iso = __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc,
        ).isoformat()
        new_status = "active" if approve else "declined"
        await db.company_permissions.update_one(
            {"id": cpid},
            {"$set": {
                "status": new_status,
                "responded_by": user["id"],
                "responded_at": now_iso,
                "granted_by": user["id"] if approve else row.get("granted_by"),
            }},
        )
        updated = await db.company_permissions.find_one({"id": cpid}, {"_id": 0})
        # Faz 9 CP1 — Let the requester know whether their ask went through.
        await _fanout_response(db, updated, approved=bool(approve))
        return CompanyPermission(**updated)

    @router.post("/company-permissions/{cpid}/revoke")
    async def revoke_company_permission(cpid: str, user: dict = Depends(current_user_dep)):
        """Target-company manager (or admin) revokes an active grant. Either
        side may also revoke its OWN outgoing grant (viewer_company member)."""
        from permissions import get_user_company_ids as _gcids
        from team_service import notify_cross_perm_revoked as _fanout_revoked
        row = await db.company_permissions.find_one({"id": cpid}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
        role = acting_role(user)
        touched_cids = {row.get("viewer_company_id"), row.get("target_company_id")}
        if role == "admin":
            pass
        elif role == "manager" and touched_cids & set(_gcids(user)):
            pass
        else:
            raise HTTPException(status_code=403, detail="Yetkiniz yok")
        was_active = row.get("status") == "active"
        now_iso = __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc,
        ).isoformat()
        await db.company_permissions.update_one(
            {"id": cpid},
            {"$set": {
                "status": "revoked",
                "responded_by": user["id"],
                "responded_at": now_iso,
            }},
        )
        # Faz 9 CP1 — Only notify when the grant was actually active before
        # revoke. Cancelling a still-pending request just goes away silently.
        if was_active:
            updated = await db.company_permissions.find_one({"id": cpid}, {"_id": 0})
            await _fanout_revoked(db, updated)
        return {"revoked": True}

    @router.delete("/company-permissions/{cpid}")
    async def delete_company_permission(cpid: str, user: dict = Depends(current_user_dep)):
        require_admin(user)
        r = await db.company_permissions.delete_one({"id": cpid})
        if not r.deleted_count:
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
        return {"deleted": True}

    return router
