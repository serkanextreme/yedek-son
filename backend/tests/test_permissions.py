"""Faz 8 — Multi-tenant RBAC permission tests.

Covers:
  - Companies CRUD (admin-only)
  - Manager visibility CRUD
  - Company permissions (cross-company) CRUD
  - Role normalization (legacy 'user' → 'employee')
  - Task visibility: employee sees own only, manager sees visibility rows,
    admin sees everything, cross-company grants respected.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _uniq(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _login(username: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _issue_trial_license(admin_tok: str, user_id: str) -> None:
    """Generate a trial license then redeem it for the target user so they can hit /api/tasks."""
    # Generate a fresh trial key.
    r = requests.post(
        f"{API}/admin/licenses/generate",
        headers=_h(admin_tok),
        json={"license_type": "trial", "count": 1},
    )
    assert r.status_code == 200, r.text
    keys = r.json().get("keys") or r.json().get("codes") or r.json()
    if isinstance(keys, list):
        key = keys[0].get("key") if isinstance(keys[0], dict) else keys[0]
    elif isinstance(keys, dict):
        key = keys.get("key")
    else:
        key = None
    assert key, f"unexpected generate response: {r.json()}"
    # Assign via admin patch (skip login flow for the target).
    r = requests.patch(
        f"{API}/admin/licenses/assign-to-user",
        headers=_h(admin_tok),
        json={"key": key, "user_id": user_id},
    )
    # Fallback: this endpoint may not exist — try user-side redeem instead.
    if r.status_code == 404:
        # login as user, redeem
        user_doc = _find_user_by_id(admin_tok, user_id)
        assert user_doc, "user not found"
        tok = _login(user_doc["username"], _KNOWN_PASSWORDS[user_id])
        rr = requests.post(f"{API}/license/redeem", headers=_h(tok), json={"key": key})
        assert rr.status_code == 200, rr.text


_KNOWN_PASSWORDS: dict = {}


def _find_user_by_id(admin_tok: str, uid: str):
    r = requests.get(f"{API}/admin/users", headers=_h(admin_tok))
    assert r.status_code == 200, r.text
    for u in r.json():
        if u.get("id") == uid:
            return u
    return None


def _create_user(admin_tok: str, username: str, password: str, role: str = "employee",
                 company_id: str = None, with_license: str = "trial") -> dict:
    body = {"username": username, "password": password, "role": role, "with_license": with_license}
    if company_id:
        body["company_id"] = company_id
    if role == "admin":
        body.pop("with_license", None)
    r = requests.post(f"{API}/admin/users", headers=_h(admin_tok), json=body)
    assert r.status_code == 200, r.text
    doc = r.json()
    _KNOWN_PASSWORDS[doc["id"]] = password
    return doc


def _delete_user(admin_tok: str, uid: str) -> None:
    requests.delete(f"{API}/admin/users/{uid}", headers=_h(admin_tok))


def _create_company(admin_tok: str, name: str) -> dict:
    r = requests.post(f"{API}/companies", headers=_h(admin_tok), json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()


def _delete_company(admin_tok: str, cid: str) -> None:
    requests.delete(f"{API}/companies/{cid}", headers=_h(admin_tok))


# =====================================================================
# 1) Role migration & normalization
# =====================================================================
class TestRoleNormalization:
    def test_legacy_user_becomes_employee_via_admin_users(self, admin_token):
        # Existing users (ahmet, serhat) should be role=employee post-migration.
        r = requests.get(f"{API}/admin/users", headers=_h(admin_token))
        assert r.status_code == 200
        roles = {u["username"]: u.get("role") for u in r.json()}
        assert roles.get("serkan") == "admin"
        # ahmet + serhat existed pre-migration as 'user' — must be 'employee' now.
        for u in ("ahmet", "serhat"):
            if u in roles:
                assert roles[u] == "employee", f"{u} still has legacy role: {roles[u]}"

    def test_create_user_with_legacy_user_role_is_normalized(self, admin_token):
        uname = _uniq("legacy")
        r = requests.post(
            f"{API}/admin/users",
            headers=_h(admin_token),
            json={"username": uname, "password": "test123", "role": "user"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("role") == "employee"
        _delete_user(admin_token, r.json()["id"])

    def test_create_user_with_manager_role(self, admin_token):
        uname = _uniq("mgr")
        r = requests.post(
            f"{API}/admin/users",
            headers=_h(admin_token),
            json={"username": uname, "password": "test123", "role": "manager"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("role") == "manager"
        _delete_user(admin_token, r.json()["id"])

    def test_create_user_invalid_role_rejected(self, admin_token):
        uname = _uniq("bad")
        r = requests.post(
            f"{API}/admin/users",
            headers=_h(admin_token),
            json={"username": uname, "password": "test123", "role": "superuser"},
        )
        assert r.status_code == 400


# =====================================================================
# 2) Companies CRUD
# =====================================================================
class TestCompaniesCRUD:
    def test_create_and_list_company_admin(self, admin_token):
        name = _uniq("AcmeCo")
        c = _create_company(admin_token, name)
        assert c["name"] == name
        assert "id" in c
        r = requests.get(f"{API}/companies", headers=_h(admin_token))
        assert r.status_code == 200
        assert any(x["id"] == c["id"] for x in r.json())
        _delete_company(admin_token, c["id"])

    def test_create_company_case_insensitive_dedup(self, admin_token):
        name = _uniq("Dedup")
        c1 = _create_company(admin_token, name)
        # Same name in different case must return the SAME company id.
        c2 = _create_company(admin_token, name.upper())
        assert c1["id"] == c2["id"]
        _delete_company(admin_token, c1["id"])

    def test_create_company_too_short_rejected(self, admin_token):
        r = requests.post(f"{API}/companies", headers=_h(admin_token), json={"name": "A"})
        assert r.status_code == 400

    def test_non_admin_cannot_create_company(self, admin_token):
        # Create a temp employee, login, try to create company.
        uname = _uniq("emp")
        u = _create_user(admin_token, uname, "test123", role="employee")
        tok = _login(uname, "test123")
        r = requests.post(f"{API}/companies", headers=_h(tok), json={"name": _uniq("Nope")})
        assert r.status_code == 403
        _delete_user(admin_token, u["id"])

    def test_update_company_syncs_users_company_name(self, admin_token):
        name = _uniq("Old")
        c = _create_company(admin_token, name)
        u = _create_user(admin_token, _uniq("member"), "test123", company_id=c["id"])
        new_name = _uniq("New")
        r = requests.patch(f"{API}/companies/{c['id']}", headers=_h(admin_token), json={"name": new_name})
        assert r.status_code == 200
        # Member's denorm should be updated.
        member = _find_user_by_id(admin_token, u["id"])
        assert member["company_name"] == new_name
        _delete_user(admin_token, u["id"])
        _delete_company(admin_token, c["id"])

    def test_delete_company_with_members_blocked(self, admin_token):
        c = _create_company(admin_token, _uniq("Full"))
        u = _create_user(admin_token, _uniq("stuck"), "test123", company_id=c["id"])
        r = requests.delete(f"{API}/companies/{c['id']}", headers=_h(admin_token))
        assert r.status_code == 400
        # Cleanup: unassign then delete.
        requests.patch(
            f"{API}/admin/users/{u['id']}", headers=_h(admin_token),
            json={"company_id": ""},
        )
        _delete_user(admin_token, u["id"])
        _delete_company(admin_token, c["id"])


# =====================================================================
# 3) Manager visibility CRUD
# =====================================================================
class TestManagerVisibility:
    def test_create_visibility_admin(self, admin_token):
        c = _create_company(admin_token, _uniq("MV"))
        mgr = _create_user(admin_token, _uniq("m"), "test123", role="manager", company_id=c["id"])
        emp = _create_user(admin_token, _uniq("e"), "test123", role="employee", company_id=c["id"])
        r = requests.post(
            f"{API}/manager-visibility", headers=_h(admin_token),
            json={"manager_user_id": mgr["id"], "employee_user_id": emp["id"]},
        )
        assert r.status_code == 200, r.text
        mv = r.json()
        # Idempotent: second call returns SAME row.
        r2 = requests.post(
            f"{API}/manager-visibility", headers=_h(admin_token),
            json={"manager_user_id": mgr["id"], "employee_user_id": emp["id"]},
        )
        assert r2.status_code == 200
        assert r2.json()["id"] == mv["id"]
        # Delete.
        d = requests.delete(f"{API}/manager-visibility/{mv['id']}", headers=_h(admin_token))
        assert d.status_code == 200
        # cleanup
        _delete_user(admin_token, mgr["id"])
        _delete_user(admin_token, emp["id"])
        _delete_company(admin_token, c["id"])

    def test_create_visibility_wrong_role_rejected(self, admin_token):
        # Non-manager cannot be the "manager" side.
        c = _create_company(admin_token, _uniq("Wrong"))
        emp1 = _create_user(admin_token, _uniq("e1"), "test123", role="employee", company_id=c["id"])
        emp2 = _create_user(admin_token, _uniq("e2"), "test123", role="employee", company_id=c["id"])
        r = requests.post(
            f"{API}/manager-visibility", headers=_h(admin_token),
            json={"manager_user_id": emp1["id"], "employee_user_id": emp2["id"]},
        )
        assert r.status_code == 400
        _delete_user(admin_token, emp1["id"])
        _delete_user(admin_token, emp2["id"])
        _delete_company(admin_token, c["id"])

    def test_non_admin_cannot_use_visibility_endpoints(self, admin_token):
        emp = _create_user(admin_token, _uniq("ne"), "test123")
        tok = _login(emp["username"], "test123")
        r = requests.get(f"{API}/manager-visibility", headers=_h(tok))
        assert r.status_code == 403
        r = requests.post(f"{API}/manager-visibility", headers=_h(tok), json={
            "manager_user_id": emp["id"], "employee_user_id": emp["id"],
        })
        assert r.status_code == 403
        _delete_user(admin_token, emp["id"])


# =====================================================================
# 4) Company permissions (cross-company) CRUD
# =====================================================================
class TestCompanyPermissions:
    def test_grant_and_revoke_cross_company(self, admin_token):
        a = _create_company(admin_token, _uniq("A"))
        b = _create_company(admin_token, _uniq("B"))
        r = requests.post(
            f"{API}/company-permissions", headers=_h(admin_token),
            json={"viewer_company_id": a["id"], "target_company_id": b["id"]},
        )
        assert r.status_code == 200, r.text
        row = r.json()
        # Idempotent.
        r2 = requests.post(
            f"{API}/company-permissions", headers=_h(admin_token),
            json={"viewer_company_id": a["id"], "target_company_id": b["id"]},
        )
        assert r2.status_code == 200
        assert r2.json()["id"] == row["id"]
        # Delete.
        d = requests.delete(f"{API}/company-permissions/{row['id']}", headers=_h(admin_token))
        assert d.status_code == 200
        _delete_company(admin_token, a["id"])
        _delete_company(admin_token, b["id"])

    def test_self_reference_rejected(self, admin_token):
        c = _create_company(admin_token, _uniq("Self"))
        r = requests.post(
            f"{API}/company-permissions", headers=_h(admin_token),
            json={"viewer_company_id": c["id"], "target_company_id": c["id"]},
        )
        assert r.status_code == 400
        _delete_company(admin_token, c["id"])

    def test_cascade_delete_company_removes_permissions(self, admin_token):
        a = _create_company(admin_token, _uniq("Casc"))
        b = _create_company(admin_token, _uniq("Ade"))
        # A -> B grant.
        r = requests.post(
            f"{API}/company-permissions", headers=_h(admin_token),
            json={"viewer_company_id": a["id"], "target_company_id": b["id"]},
        )
        assert r.status_code == 200
        # Delete company B; the permission row referencing it should vanish.
        _delete_company(admin_token, b["id"])
        rows = requests.get(f"{API}/company-permissions", headers=_h(admin_token)).json()
        assert not any(row["target_company_id"] == b["id"] for row in rows)
        _delete_company(admin_token, a["id"])


# =====================================================================
# 5) Task visibility (RBAC end-to-end)
# =====================================================================
class TestTaskVisibility:
    """Simulates a real B2B scenario:
    Company Alpha { managerA, empA1, empA2 } · Company Beta { managerB, empB1 }.
    - empA1 sees only their own task.
    - managerA (with visibility on empA1) sees empA1's task + own.
    - managerA (no visibility on empA2) does NOT see empA2's task.
    - managerA (no cross-company grant) does NOT see empB1's task.
    - After cross-company grant + visibility, managerA sees empB1's task.
    - admin sees everything.
    """
    def test_full_scenario(self, admin_token):
        alpha = _create_company(admin_token, _uniq("Alpha"))
        beta = _create_company(admin_token, _uniq("Beta"))
        mgrA = _create_user(admin_token, _uniq("mgrA"), "test123", role="manager", company_id=alpha["id"])
        empA1 = _create_user(admin_token, _uniq("empA1"), "test123", role="employee", company_id=alpha["id"])
        empA2 = _create_user(admin_token, _uniq("empA2"), "test123", role="employee", company_id=alpha["id"])
        mgrB = _create_user(admin_token, _uniq("mgrB"), "test123", role="manager", company_id=beta["id"])
        empB1 = _create_user(admin_token, _uniq("empB1"), "test123", role="employee", company_id=beta["id"])

        # Login as each user.
        tokA1 = _login(empA1["username"], "test123")
        tokA2 = _login(empA2["username"], "test123")
        tokMA = _login(mgrA["username"], "test123")
        tokB1 = _login(empB1["username"], "test123")
        _ = _login(mgrB["username"], "test123")  # warms brute-force counter, not used

        # Each user creates a task.
        for tok, title in [
            (tokA1, "empA1-task"), (tokA2, "empA2-task"),
            (tokMA, "mgrA-task"), (tokB1, "empB1-task"),
        ]:
            r = requests.post(f"{API}/tasks", headers=_h(tok), json={"title": title})
            assert r.status_code == 200, r.text

        # empA1 should see only own task.
        r = requests.get(f"{API}/tasks", headers=_h(tokA1))
        titles = {t["title"] for t in r.json()}
        assert "empA1-task" in titles
        assert "empA2-task" not in titles
        assert "empB1-task" not in titles

        # managerA (no visibility yet) should see only own task.
        r = requests.get(f"{API}/tasks", headers=_h(tokMA))
        titles = {t["title"] for t in r.json()}
        assert "mgrA-task" in titles
        assert "empA1-task" not in titles
        assert "empA2-task" not in titles

        # Grant visibility mgrA → empA1.
        r = requests.post(
            f"{API}/manager-visibility", headers=_h(admin_token),
            json={"manager_user_id": mgrA["id"], "employee_user_id": empA1["id"]},
        )
        assert r.status_code == 200

        # Now mgrA should see empA1's task AND own, but NOT empA2 (no visibility).
        r = requests.get(f"{API}/tasks", headers=_h(tokMA))
        titles = {t["title"] for t in r.json()}
        assert "mgrA-task" in titles
        assert "empA1-task" in titles
        assert "empA2-task" not in titles
        assert "empB1-task" not in titles

        # Grant mgrA visibility on empB1 (cross-company) WITHOUT company grant — should still block.
        r = requests.post(
            f"{API}/manager-visibility", headers=_h(admin_token),
            json={"manager_user_id": mgrA["id"], "employee_user_id": empB1["id"]},
        )
        assert r.status_code == 200
        r = requests.get(f"{API}/tasks", headers=_h(tokMA))
        titles = {t["title"] for t in r.json()}
        assert "empB1-task" not in titles  # blocked: no company permission

        # Add company permission Alpha -> Beta; now mgrA should see empB1.
        r = requests.post(
            f"{API}/company-permissions", headers=_h(admin_token),
            json={"viewer_company_id": alpha["id"], "target_company_id": beta["id"]},
        )
        assert r.status_code == 200
        r = requests.get(f"{API}/tasks", headers=_h(tokMA))
        titles = {t["title"] for t in r.json()}
        assert "empB1-task" in titles

        # Admin sees all 4.
        r = requests.get(f"{API}/tasks", headers=_h(admin_token))
        titles = {t["title"] for t in r.json()}
        for t in ("empA1-task", "empA2-task", "mgrA-task", "empB1-task"):
            assert t in titles, f"admin missing {t}"

        # Cleanup — delete users first (they own tasks), then companies.
        for u in (mgrA, empA1, empA2, mgrB, empB1):
            _delete_user(admin_token, u["id"])
        _delete_company(admin_token, alpha["id"])
        _delete_company(admin_token, beta["id"])


# =====================================================================
# 6) Task edit/delete RBAC (unauthorized 404, not accidental leaks)
# =====================================================================
class TestTaskEditPermissions:
    def test_employee_cannot_patch_others_task_returns_404(self, admin_token):
        c = _create_company(admin_token, _uniq("EditCo"))
        e1 = _create_user(admin_token, _uniq("e1"), "test123", role="employee", company_id=c["id"])
        e2 = _create_user(admin_token, _uniq("e2"), "test123", role="employee", company_id=c["id"])
        tok1 = _login(e1["username"], "test123")
        tok2 = _login(e2["username"], "test123")
        # e1 creates task.
        r = requests.post(f"{API}/tasks", headers=_h(tok1), json={"title": "e1-only"})
        assert r.status_code == 200
        tid = r.json()["id"]
        # e2 tries to patch it — 404 (no leak).
        r = requests.patch(f"{API}/tasks/{tid}", headers=_h(tok2), json={"title": "hacked"})
        assert r.status_code == 404
        # e2 tries to delete it — returns 0 (silent no-op).
        r = requests.delete(f"{API}/tasks/{tid}", headers=_h(tok2))
        assert r.status_code == 200
        assert r.json()["deleted"] == 0
        # Verify task still exists for e1.
        r = requests.get(f"{API}/tasks", headers=_h(tok1))
        assert any(t["id"] == tid for t in r.json())
        _delete_user(admin_token, e1["id"])
        _delete_user(admin_token, e2["id"])
        _delete_company(admin_token, c["id"])


# =====================================================================
# 7) Companies list scoping for non-admin
# =====================================================================
class TestCompanyListScoping:
    def test_employee_sees_only_own_company(self, admin_token):
        a = _create_company(admin_token, _uniq("Own"))
        b = _create_company(admin_token, _uniq("Other"))
        emp = _create_user(admin_token, _uniq("scope"), "test123", company_id=a["id"])
        tok = _login(emp["username"], "test123")
        r = requests.get(f"{API}/companies", headers=_h(tok))
        assert r.status_code == 200
        ids = {c["id"] for c in r.json()}
        assert a["id"] in ids
        assert b["id"] not in ids
        _delete_user(admin_token, emp["id"])
        _delete_company(admin_token, a["id"])
        _delete_company(admin_token, b["id"])


# =====================================================================
# 8) zzz cleanup — must be last alphabetically to run last on loadfile
# =====================================================================
def test_zzz_cleanup_final_state(admin_token):
    """Verify no test residue remains: no TEST_* companies, no orphan users.

    Exceptions (persistent Faz 8 test fixtures — see test_credentials.md):
      mgr_test, emp1_test — the manager/employee pair used by the frontend
      testing agent, kept alive across runs.
    """
    PERSISTENT = {"mgr_test", "emp1_test"}
    r = requests.get(f"{API}/admin/users", headers=_h(admin_token))
    assert r.status_code == 200
    for u in r.json():
        uname = u.get("username", "")
        if uname in PERSISTENT:
            continue
        assert not uname.startswith(("legacy_", "mgr_", "e1_", "e2_", "e_", "m_",
                                     "member_", "stuck_", "empA1_", "empA2_",
                                     "empB1_", "mgrA_", "mgrB_", "scope_", "ne_",
                                     "emp_")), f"orphan test user leaked: {uname}"
    # Companies leak check — allow persistent 'Test Company A' fixture.
    PERSISTENT_COMPANIES = {"Test Company A"}
    r = requests.get(f"{API}/companies", headers=_h(admin_token))
    for c in r.json():
        if c["name"] in PERSISTENT_COMPANIES:
            continue
        assert not c["name"].startswith(("AcmeCo_", "Dedup_", "Old_", "New_", "Full_",
                                        "MV_", "Wrong_", "A_", "B_", "Self_", "Casc_",
                                        "Ade_", "Alpha_", "Beta_", "EditCo_", "Own_",
                                        "Other_", "Nope_")), f"orphan test company leaked: {c['name']}"
