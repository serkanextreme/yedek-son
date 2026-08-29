"""Backend tests — Arşiv v2: neden politikası, ayarlar, kişi yetkileri, arama."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"username": "serkan", "password": "19071987"}
EMP = {"username": "emp1_test", "password": "emp12345"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, r.text
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {_login(ADMIN)}"}


@pytest.fixture(scope="module")
def emp_uid(admin_h):
    r = requests.get(f"{API}/admin/users", headers=admin_h, timeout=30)
    return [u["id"] for u in r.json() if u["username"] == "emp1_test"][0]


def _create(h, title):
    r = requests.post(f"{API}/tasks", json={"title": title}, headers=h, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_settings_default_and_admin_caps(admin_h):
    r = requests.get(f"{API}/tasks/settings", headers=admin_h, timeout=30)
    assert r.status_code == 200
    b = r.json()
    assert b["caps"] == {"perm_delete": True, "empty_trash": True, "manage_policy": True}
    assert b["delete_reason_policy"] in ("off", "optional", "required")


def test_required_policy_blocks_reasonless_delete_and_cancel(admin_h):
    requests.put(f"{API}/tasks/settings", json={"delete_reason_policy": "required"}, headers=admin_h, timeout=30)
    try:
        tid = _create(admin_h, "ZZ_V2_req_del")
        r = requests.delete(f"{API}/tasks/{tid}", headers=admin_h, timeout=30)
        assert r.status_code == 400
        r = requests.delete(f"{API}/tasks/{tid}?reason=sebep", headers=admin_h, timeout=30)
        assert r.status_code == 200 and r.json().get("trashed")
        # cancel without reason blocked
        tid2 = _create(admin_h, "ZZ_V2_req_cancel")
        r = requests.post(f"{API}/tasks/{tid2}/cancel", headers=admin_h, timeout=30)
        assert r.status_code == 400
        r = requests.post(f"{API}/tasks/{tid2}/cancel", json={"reason": "iptal sebebi"}, headers=admin_h, timeout=30)
        assert r.status_code == 200 and r.json().get("cancel_reason") == "iptal sebebi"
        # cleanup
        requests.delete(f"{API}/tasks/{tid}/permanent", headers=admin_h, timeout=30)
        requests.delete(f"{API}/tasks/{tid2}/permanent", headers=admin_h, timeout=30)
    finally:
        requests.put(f"{API}/tasks/settings", json={"delete_reason_policy": "optional", "trash_autoclean_enabled": False, "trash_autoclean_days": 30}, headers=admin_h, timeout=30)


def test_caps_grant_and_enforcement(admin_h, emp_uid):
    emp_h = {"Authorization": f"Bearer {_login(EMP)}"}
    # before: no caps → 403 on empty-trash + PUT settings
    assert requests.post(f"{API}/tasks/trash/empty", headers=emp_h, timeout=30).status_code == 403
    assert requests.put(f"{API}/tasks/settings", json={"delete_reason_policy": "off"}, headers=emp_h, timeout=30).status_code == 403
    # non-admin cannot grant caps
    assert requests.patch(f"{API}/users/{emp_uid}/archive-caps", json={"perm_delete": True}, headers=emp_h, timeout=30).status_code == 403
    # admin grants empty_trash
    r = requests.patch(f"{API}/users/{emp_uid}/archive-caps", json={"empty_trash": True}, headers=admin_h, timeout=30)
    assert r.status_code == 200 and r.json()["archive_caps"]["empty_trash"] is True
    emp_h2 = {"Authorization": f"Bearer {_login(EMP)}"}
    assert requests.get(f"{API}/tasks/settings", headers=emp_h2, timeout=30).json()["caps"]["empty_trash"] is True
    assert requests.post(f"{API}/tasks/trash/empty", headers=emp_h2, timeout=30).status_code == 200
    # still no manage_policy
    assert requests.put(f"{API}/tasks/settings", json={"delete_reason_policy": "off"}, headers=emp_h2, timeout=30).status_code == 403
    # cleanup revoke
    requests.patch(f"{API}/users/{emp_uid}/archive-caps", json={"empty_trash": False, "perm_delete": False, "manage_policy": False}, headers=admin_h, timeout=30)


def test_archive_search_scopes_archive_only(admin_h):
    tid = _create(admin_h, "ZZ_V2_SEARCHABLE_UNIQUE")
    requests.delete(f"{API}/tasks/{tid}?reason=x", headers=admin_h, timeout=30)  # to trash (archived)
    r = requests.get(f"{API}/tasks/search", params={"q": "SEARCHABLE_UNIQUE", "scope": "mine"}, headers=admin_h, timeout=30)
    assert r.status_code == 200
    titles = [t["title"] for t in r.json()]
    assert "ZZ_V2_SEARCHABLE_UNIQUE" in titles
    # short query returns empty
    assert requests.get(f"{API}/tasks/search", params={"q": "a"}, headers=admin_h, timeout=30).json() == []
    requests.delete(f"{API}/tasks/{tid}/permanent", headers=admin_h, timeout=30)
