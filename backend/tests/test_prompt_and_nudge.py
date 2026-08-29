"""Backend tests for iteration_81:
- (b) Admin Chat Prompt editor: GET/PUT /api/admin/chat-prompt (admin-only, 403 for non-admin).
- (b2) Chat still works with an override prompt (POST /api/chat).
- (c) Dürt/Nudge: POST /api/tasks/{id}/nudge — repeatable, self-nudge=400, cannot-view=403, recipient gets bell.
"""
import os
import time
import requests
import pytest

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"


def _login(username: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("token") or j.get("access_token")


def _h(tok): return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_tok():
    return _login("serkan", "19071987")


@pytest.fixture(scope="module")
def mgr_tok():
    try:
        return _login("mgr_test", "mgr12345")
    except AssertionError:
        pytest.skip("mgr_test account not seeded")


@pytest.fixture(scope="module")
def emp_tok():
    try:
        return _login("emp1_test", "emp12345")
    except AssertionError:
        pytest.skip("emp1_test account not seeded")


# ------------------- (b) Chat Prompt admin -----------------------------
class TestChatPromptAdmin:
    def test_admin_get(self, admin_tok):
        r = requests.get(f"{API}/admin/chat-prompt", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        j = r.json()
        for k in ("tr", "en", "default_tr", "default_en"):
            assert k in j

    def test_non_admin_forbidden(self, mgr_tok):
        r = requests.get(f"{API}/admin/chat-prompt", headers=_h(mgr_tok), timeout=15)
        assert r.status_code == 403, r.text
        r2 = requests.put(f"{API}/admin/chat-prompt", headers=_h(mgr_tok), json={"tr": "x", "en": "y"}, timeout=15)
        assert r2.status_code == 403

    def test_put_then_get_persists(self, admin_tok):
        custom = "TEST_PROMPT_TR — sadece test amaçlı."
        r = requests.put(f"{API}/admin/chat-prompt", headers=_h(admin_tok),
                         json={"tr": custom, "en": "TEST_PROMPT_EN"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["tr"] == custom
        r2 = requests.get(f"{API}/admin/chat-prompt", headers=_h(admin_tok), timeout=15)
        assert r2.status_code == 200
        assert r2.json()["tr"] == custom
        assert r2.json()["en"] == "TEST_PROMPT_EN"

    def test_chat_still_replies_with_override(self, admin_tok):
        # POST /api/chat while override is active — must still return 200 with an assistant reply.
        r = requests.post(f"{API}/chat", headers=_h(admin_tok),
                         json={"message": "Merhaba, kısaca kendini tanıt.", "conversation_id": None},
                         timeout=90)
        # Chat endpoint may return various shapes; accept 200 and non-empty response.
        assert r.status_code == 200, r.text
        j = r.json()
        # allow either 'reply' or 'message' or 'content'
        text = (j.get("assistant_message") or {}).get("content") or j.get("reply") or j.get("message") or j.get("content") or ""
        if isinstance(text, dict):
            text = text.get("content", "")
        assert text and len(str(text)) > 0, f"empty assistant reply: {j}"

    def test_reset_to_empty(self, admin_tok):
        r = requests.put(f"{API}/admin/chat-prompt", headers=_h(admin_tok),
                         json={"tr": "", "en": ""}, timeout=15)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/admin/chat-prompt", headers=_h(admin_tok), timeout=15)
        assert r2.json()["tr"] == ""
        assert r2.json()["en"] == ""


# ------------------- (c) Nudge -----------------------------
class TestNudge:
    def test_self_nudge_400(self, admin_tok):
        # create a task for self
        payload = {"title": "TEST_selfnudge", "description": "self"}
        r = requests.post(f"{API}/tasks", headers=_h(admin_tok), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        try:
            r2 = requests.post(f"{API}/tasks/{tid}/nudge", headers=_h(admin_tok), json={"message": ""}, timeout=15)
            assert r2.status_code == 400
        finally:
            requests.delete(f"{API}/tasks/{tid}", headers=_h(admin_tok), timeout=15)

    def test_nudge_cooldown_and_recipient_bell(self, admin_tok, emp_tok):
        # find emp1_test id via /auth/me
        me = requests.get(f"{API}/auth/me", headers=_h(emp_tok), timeout=15)
        assert me.status_code == 200
        emp_id = me.json()["id"]

        # admin creates a task assigned to emp
        payload = {"title": "TEST_nudge_target", "assignee_user_id": emp_id}
        r = requests.post(f"{API}/tasks", headers=_h(admin_tok), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        try:
            # count before
            n0 = requests.get(f"{API}/notifications", headers=_h(emp_tok), timeout=15)
            assert n0.status_code == 200
            n0j = n0.json()
            items0 = n0j.get("items", []) if isinstance(n0j, dict) else n0j
            before = sum(1 for x in items0 if x.get("type") == "task_nudge")

            # first nudge succeeds + returns count_today
            r1 = requests.post(f"{API}/tasks/{tid}/nudge", headers=_h(admin_tok),
                               json={"message": "acele"}, timeout=15)
            assert r1.status_code == 200, r1.text
            j1 = r1.json()
            assert j1["sent"] is True
            assert j1.get("count_today", 0) >= 1
            assert j1.get("cooldown_seconds", 0) >= 1

            # second IMMEDIATE nudge is blocked by cooldown (429)
            r2 = requests.post(f"{API}/tasks/{tid}/nudge", headers=_h(admin_tok),
                               json={"message": "acele"}, timeout=15)
            assert r2.status_code == 429, f"expected 429 cooldown, got {r2.status_code}: {r2.text}"

            # recipient got >= 1 new task_nudge with payload.task_id
            n1 = requests.get(f"{API}/notifications", headers=_h(emp_tok), timeout=15)
            n1j = n1.json()
            items = n1j.get("items", []) if isinstance(n1j, dict) else n1j
            after = sum(1 for x in items if x.get("type") == "task_nudge")
            assert after - before >= 1, f"expected >=1 new task_nudge (before={before} after={after})"
            tn = [x for x in items if x.get("type") == "task_nudge" and (x.get("payload") or {}).get("task_id") == tid]
            assert tn, "no task_nudge with payload.task_id matching created task"
        finally:
            requests.delete(f"{API}/tasks/{tid}", headers=_h(admin_tok), timeout=15)

    def test_nudge_no_visibility_403_or_404(self, emp_tok, admin_tok):
        # emp tries to nudge admin's own task
        payload = {"title": "TEST_admin_only", "description": "priv"}
        r = requests.post(f"{API}/tasks", headers=_h(admin_tok), json=payload, timeout=15)
        assert r.status_code == 200
        tid = r.json()["id"]
        try:
            r2 = requests.post(f"{API}/tasks/{tid}/nudge", headers=_h(emp_tok), json={"message": ""}, timeout=15)
            assert r2.status_code in (403, 404), f"expected 403/404 got {r2.status_code}: {r2.text}"
        finally:
            requests.delete(f"{API}/tasks/{tid}", headers=_h(admin_tok), timeout=15)
