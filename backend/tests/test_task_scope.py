"""Test scope=mine|team on GET /api/tasks — the fix for the privacy/mixing bug."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"

CREDS = {
    "admin": ("serkan", "19071987"),
    "mgr":   ("mgr_test", "mgr12345"),
    "emp":   ("emp1_test", "emp12345"),
}


def _login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, f"login {username} -> {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j["token"]


@pytest.fixture(scope="module")
def tokens():
    return {k: _login(u, p) for k, (u, p) in CREDS.items()}


@pytest.fixture(scope="module")
def uids(tokens):
    return {
        "admin": _user_id_by_username(tokens["admin"], "serkan"),
        "mgr":   _user_id_by_username(tokens["admin"], "mgr_test"),
        "emp":   _user_id_by_username(tokens["admin"], "emp1_test"),
    }


def _get_tasks(token, scope=None, archived=False):
    params = {"archived": str(archived).lower()}
    if scope:
        params["scope"] = scope
    r = requests.get(f"{API}/tasks", headers={"Authorization": f"Bearer {token}"}, params=params)
    assert r.status_code == 200, f"GET tasks {scope} -> {r.status_code} {r.text}"
    return r.json()


def _me(token):
    # Prefer /me if available, else fall back to admin/users lookup by username.
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
    if r.status_code == 200:
        return r.json()
    r = requests.get(f"{API}/me", headers={"Authorization": f"Bearer {token}"})
    if r.status_code == 200:
        return r.json()
    return None


def _user_id_by_username(admin_token, username):
    for u in requests.get(f"{API}/admin/users", headers={"Authorization": f"Bearer {admin_token}"}).json():
        if u.get("username") == username:
            return u["id"]
    return None


# ---- scope=mine default & content --------------------------------------------
def test_default_scope_is_mine_for_admin(tokens):
    admin_default = _get_tasks(tokens["admin"])
    admin_mine    = _get_tasks(tokens["admin"], scope="mine")
    ids_default = sorted(t["id"] for t in admin_default)
    ids_mine    = sorted(t["id"] for t in admin_mine)
    assert ids_default == ids_mine, "default scope must be 'mine'"


def test_admin_mine_only_own_involvement(tokens, uids):
    uid = uids["admin"]
    tasks = _get_tasks(tokens["admin"], scope="mine")
    for t in tasks:
        involved = (
            t.get("user_id") == uid
            or any((a or {}).get("user_id") == uid for a in (t.get("assignees") or []))
            or any((s or {}).get("user_id") == uid for s in (t.get("shared_with") or []))
        )
        assert involved, f"admin scope=mine leaked task {t['id']} owner={t.get('user_id')}"


def test_manager_mine_only_own_involvement(tokens, uids):
    uid = uids["mgr"]
    tasks = _get_tasks(tokens["mgr"], scope="mine")
    for t in tasks:
        involved = (
            t.get("user_id") == uid
            or any((a or {}).get("user_id") == uid for a in (t.get("assignees") or []))
            or any((s or {}).get("user_id") == uid for s in (t.get("shared_with") or []))
        )
        assert involved, f"mgr scope=mine leaked task {t['id']} owner={t.get('user_id')}"


def test_employee_mine_only_own_involvement(tokens, uids):
    uid = uids["emp"]
    tasks = _get_tasks(tokens["emp"], scope="mine")
    for t in tasks:
        involved = (
            t.get("user_id") == uid
            or any((a or {}).get("user_id") == uid for a in (t.get("assignees") or []))
            or any((s or {}).get("user_id") == uid for s in (t.get("shared_with") or []))
        )
        assert involved


# ---- scope=team --------------------------------------------------------------
def test_admin_team_excludes_self(tokens, uids):
    uid = uids["admin"]
    tasks = _get_tasks(tokens["admin"], scope="team")
    for t in tasks:
        assert t.get("user_id") != uid, f"admin team should exclude own tasks; leaked {t['id']}"


def test_manager_team_is_only_visible_team(tokens, uids):
    uid = uids["mgr"]
    admin_id = uids["admin"]
    tasks = _get_tasks(tokens["mgr"], scope="team")
    for t in tasks:
        assert t.get("user_id") != uid, "team must exclude self"
        assert t.get("user_id") != admin_id, f"manager team must NOT include admin's tasks; leaked {t['id']}"
    # user_id field must exist on every task
    for t in tasks:
        assert "user_id" in t, "response must include user_id"


def test_employee_team_is_empty(tokens):
    tasks = _get_tasks(tokens["emp"], scope="team")
    assert tasks == [], f"employee team scope should be []; got {len(tasks)}"


# ---- privacy: admin's private tasks must not leak ----------------------------
def test_admin_private_task_not_visible_to_others(tokens):
    # Create a task owned by admin, no shares.
    r = requests.post(
        f"{API}/tasks",
        headers={"Authorization": f"Bearer {tokens['admin']}"},
        json={"title": "TEST_PRIVACY_ADMIN_ONLY"},
    )
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    try:
        for who in ("mgr", "emp"):
            for sc in ("mine", "team"):
                ids = [t["id"] for t in _get_tasks(tokens[who], scope=sc)]
                assert tid not in ids, f"admin private task LEAKED to {who} scope={sc}"
    finally:
        requests.delete(f"{API}/tasks/{tid}", headers={"Authorization": f"Bearer {tokens['admin']}"})


def test_user_id_field_present(tokens):
    tasks = _get_tasks(tokens["admin"], scope="mine")
    if tasks:
        assert "user_id" in tasks[0], "Task response must include user_id"


# ---- personal share smoke: employee shares to another user -------------------
def test_employee_can_share_task(tokens, uids):
    mgr_id = uids["mgr"]
    r = requests.post(
        f"{API}/tasks",
        headers={"Authorization": f"Bearer {tokens['emp']}"},
        json={"title": "TEST_EMP_SHARE"},
    )
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    try:
        r2 = requests.put(
            f"{API}/tasks/{tid}/shares",
            headers={"Authorization": f"Bearer {tokens['emp']}"},
            json={"shares": [{"user_id": mgr_id, "perms": {"view": True}}], "notify": False},
        )
        assert r2.status_code == 200, r2.text
        mgr_mine_ids = [t["id"] for t in _get_tasks(tokens["mgr"], scope="mine")]
        assert tid in mgr_mine_ids, "shared task must appear in recipient's mine list"
    finally:
        requests.delete(f"{API}/tasks/{tid}", headers={"Authorization": f"Bearer {tokens['emp']}"})
