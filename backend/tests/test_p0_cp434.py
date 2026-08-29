"""
Sertex — Faz 9 CP4.34 P0 fix regression tests.

Covers 5 backend fixes + 1 new endpoint:
 (P0-1) Startup DB indexes on 3 lock-system collections (verified via getIndexes()).
 (P0-2) Atomic single-use unlock session — uses_remaining never < 0, second
        locked mutation returns 423.
 (P0-3) OTP invalidation atomic — reissuing produces exactly one active OTP
        and audit sequence otp_issued -> otp_invalidated -> otp_issued.
 (P0-4) User delete cascade — hard delete of a user invalidates their pending
        OTPs (invalidated_reason='user_deleted') and preserves audit rows.
 (P0-5) OTP rate limit — 5 wrong codes then 6th = 429 and audit event
        otp_rate_limited is logged.
 (P0-6/9) GET /api/tasks/{id} — admin OK, unknown id 404, non-visible task 404.
"""
import os
import uuid
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_USER, ADMIN_PASS = "serkan", "19071987"
EMP_USER, EMP_PASS = "ahmet", "ahmet123"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------- helpers ----------
def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, f"login {u} -> {r.status_code} {r.text}"
    j = r.json()
    return j["token"], j["user"]


def _sess(t):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {t}"})
    return s


@pytest.fixture(scope="module")
def admin():
    # re-login on each module import so we don't collide with UI sessions
    t, u = _login(ADMIN_USER, ADMIN_PASS)
    return {"sess": _sess(t), "user": u}


@pytest.fixture(scope="module")
def emp():
    t, u = _login(EMP_USER, EMP_PASS)
    return {"sess": _sess(t), "user": u}


@pytest.fixture
def task(admin, emp):
    """Fresh task owned by admin assigned to ahmet, with lock_edit+lock_delete
    + requires_otp on managed channel."""
    r = admin["sess"].post(f"{API}/tasks", json={
        "title": f"TEST_P0_{uuid.uuid4().hex[:6]}",
        "assignee_user_id": emp["user"]["id"],
        "assignee_name": emp["user"]["username"],
    })
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    r = admin["sess"].patch(f"{API}/tasks/{tid}/locks", json={
        "lock_flags": {"lock_edit": True, "lock_delete": True, "requires_otp": True},
    })
    assert r.status_code == 200, r.text
    yield tid
    try:
        admin["sess"].delete(f"{API}/tasks/{tid}")
    except Exception:
        pass


def _issue_otp(admin_sess, tid):
    r = admin_sess.post(f"{API}/tasks/{tid}/unlock-otp")
    assert r.status_code == 200, r.text
    return r.json()["code"]


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


# ---------- P0-1: Indexes ----------
class TestIndexes:
    def test_indexes_created_on_startup(self):
        async def _check():
            db = _mongo()
            for coll in ("task_lock_audit", "task_unlock_otps", "lock_policy_templates"):
                names = [ix["name"] for ix in await db[coll].list_indexes().to_list(length=50)]
                # id index is expected on every collection
                assert any("id" in n for n in names), f"{coll} missing id index: {names}"
            audit_names = [ix["name"] for ix in await _mongo().task_lock_audit.list_indexes().to_list(length=50)]
            assert any("task_id" in n and "created_at" in n for n in audit_names), audit_names
            otp_names = [ix["name"] for ix in await _mongo().task_unlock_otps.list_indexes().to_list(length=50)]
            assert any("task_id" in n and "code_hash" in n for n in otp_names), otp_names
            assert any("expires_at" in n for n in otp_names), otp_names
            tpl_names = [ix["name"] for ix in await _mongo().lock_policy_templates.list_indexes().to_list(length=50)]
            assert any("created_at" in n for n in tpl_names), tpl_names
            assert any("created_by" in n for n in tpl_names), tpl_names
        asyncio.get_event_loop().run_until_complete(_check())


# ---------- P0-2: atomic single-use decrement ----------
class TestSingleUseInvariant:
    def test_uses_remaining_never_negative_and_second_patch_blocked(self, admin, emp, task):
        code = _issue_otp(admin["sess"], task)
        # verify
        r = emp["sess"].post(f"{API}/tasks/{task}/unlock-verify", json={"code": code})
        assert r.status_code == 200, r.text
        assert r.json().get("unlock_uses_remaining") == 1
        # First locked mutation → succeed and consume
        r1 = emp["sess"].delete(f"{API}/tasks/{task}")
        assert r1.status_code == 200, r1.text
        # Recreate the same task shape so we can attempt the "second" mutation
        # on a freshly-locked task using the SAME code (which is now used).
        # Alternative: after DELETE, task is gone, so we assert uses_remaining
        # is not negative in DB.
        async def _check_negative():
            db = _mongo()
            neg = await db.tasks.count_documents({"unlock_uses_remaining": {"$lt": 0}})
            assert neg == 0, f"found {neg} tasks with negative uses_remaining"
        asyncio.get_event_loop().run_until_complete(_check_negative())

    def test_second_mutation_blocked_after_consume(self, admin, emp, task):
        code = _issue_otp(admin["sess"], task)
        r = emp["sess"].post(f"{API}/tasks/{task}/unlock-verify", json={"code": code})
        assert r.status_code == 200
        # First: PATCH title — succeeds
        r1 = emp["sess"].patch(f"{API}/tasks/{task}", json={"title": "TEST_first_edit"})
        assert r1.status_code == 200, r1.text
        # Second: PATCH title again — MUST 423 (single-use consumed)
        r2 = emp["sess"].patch(f"{API}/tasks/{task}", json={"title": "TEST_second_edit"})
        assert r2.status_code == 423, r2.text


# ---------- P0-3: OTP invalidation atomic ----------
class TestOtpInvalidationAtomic:
    def test_reissue_invalidates_prior_and_only_new_verifies(self, admin, emp, task):
        code1 = _issue_otp(admin["sess"], task)
        code2 = _issue_otp(admin["sess"], task)
        assert code1 != code2
        # First code → 400 invalid/used
        r = emp["sess"].post(f"{API}/tasks/{task}/unlock-verify", json={"code": code1})
        assert r.status_code == 400, r.text
        # Second code → 200
        r = emp["sess"].post(f"{API}/tasks/{task}/unlock-verify", json={"code": code2})
        assert r.status_code == 200, r.text
        # Audit sequence check
        r = admin["sess"].get(f"{API}/tasks/{task}/lock-audit")
        assert r.status_code == 200
        events = [row["event_type"] for row in r.json()["rows"]]
        # newest first
        assert events.count("otp_issued") >= 2
        assert "otp_invalidated" in events
        # otp_issued (idx of newer)  should come before otp_invalidated in the desc list
        # i.e. issued(2) then invalidated then issued(1) somewhere
        idx_issued = [i for i, e in enumerate(events) if e == "otp_issued"]
        idx_invalid = events.index("otp_invalidated")
        assert idx_issued[0] < idx_invalid < idx_issued[1]


# ---------- P0-5: OTP rate limit ----------
class TestOtpRateLimit:
    def test_five_wrong_then_429(self, admin, emp, task):
        _issue_otp(admin["sess"], task)  # ensure there IS an active OTP so the check reaches rate limit logic
        wrong_codes = ["000000", "111111", "222222", "333333", "444444"]
        for wc in wrong_codes:
            r = emp["sess"].post(f"{API}/tasks/{task}/unlock-verify", json={"code": wc})
            assert r.status_code == 400, f"wrong code should 400 got {r.status_code}: {r.text}"
        # 6th
        r = emp["sess"].post(f"{API}/tasks/{task}/unlock-verify", json={"code": "555555"})
        assert r.status_code == 429, f"expected 429 got {r.status_code}: {r.text}"
        assert "başarısız" in r.json().get("detail", "").lower() or "deneme" in r.json().get("detail", "").lower()
        # audit has otp_rate_limited
        r = admin["sess"].get(f"{API}/tasks/{task}/lock-audit")
        events = [row["event_type"] for row in r.json()["rows"]]
        assert "otp_rate_limited" in events


# ---------- P0-4: User delete cascade ----------
class TestUserDeleteCascade:
    def test_hard_delete_invalidates_pending_otps(self, admin):
        # create a throwaway user
        uname = f"TEST_del_{uuid.uuid4().hex[:6]}"
        r = admin["sess"].post(f"{API}/admin/users", json={
            "username": uname, "password": "pass12345", "role": "employee",
        })
        assert r.status_code == 200, r.text
        new_user = r.json()
        uid = new_user["id"]
        # assign them a locked task and issue OTP
        r = admin["sess"].post(f"{API}/tasks", json={
            "title": f"TEST_cascade_{uuid.uuid4().hex[:6]}",
            "assignee_user_id": uid,
            "assignee_name": uname,
        })
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        r = admin["sess"].patch(f"{API}/tasks/{tid}/locks", json={
            "lock_flags": {"lock_edit": True, "requires_otp": True}
        })
        assert r.status_code == 200
        _issue_otp(admin["sess"], tid)
        # hard delete user
        r = admin["sess"].delete(f"{API}/admin/users/{uid}?mode=hard")
        assert r.status_code == 200, r.text
        # verify pending OTPs invalidated
        async def _check():
            db = _mongo()
            cnt = await db.task_unlock_otps.count_documents({
                "issued_for": uid,
                "used_at": None,
                "invalidated_reason": "user_deleted",
            })
            assert cnt >= 1, f"expected >=1 invalidated OTP for deleted user, got {cnt}"
            # audit rows preserved (KVKK) — hard mode keeps them
            audit_cnt = await db.task_lock_audit.count_documents({"task_id": tid})
            assert audit_cnt >= 1
        asyncio.get_event_loop().run_until_complete(_check())


# ---------- P0-6/9: GET /api/tasks/{id} ----------
class TestSingleTaskGet:
    def test_admin_can_get_by_id(self, admin, task):
        r = admin["sess"].get(f"{API}/tasks/{task}")
        assert r.status_code == 200, r.text
        assert r.json()["id"] == task

    def test_unknown_id_returns_404(self, admin):
        r = admin["sess"].get(f"{API}/tasks/nonexistent-{uuid.uuid4().hex}")
        assert r.status_code == 404, r.text

    def test_employee_cannot_get_task_not_visible(self, admin, emp):
        # Create a task owned by admin (not assigned to ahmet)
        r = admin["sess"].post(f"{API}/tasks", json={"title": f"TEST_priv_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200
        tid = r.json()["id"]
        try:
            r = emp["sess"].get(f"{API}/tasks/{tid}")
            assert r.status_code == 404, f"expected 404 for non-visible task got {r.status_code}: {r.text}"
        finally:
            admin["sess"].delete(f"{API}/tasks/{tid}")
