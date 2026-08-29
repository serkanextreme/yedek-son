"""Backend tests for Arşiv grupları — Bitmiş / İptal / Silinmiş (çöp kutusu).

Endpoints tested:
  * POST   /api/tasks/{id}/cancel            → cancelled=True + archived=True, İPTAL grubu
  * POST   /api/tasks/{id}/uncancel          → aktife döner
  * DELETE /api/tasks/{id}                   → soft-delete (deleted=True), SİLİNMİŞ grubu
  * POST   /api/tasks/{id}/restore           → çöp kutusundan geri yükle
  * DELETE /api/tasks/{id}/permanent         → admin-only kalıcı sil
  * POST   /api/tasks/trash/empty            → admin-only toplu kalıcı sil
  * GET    /api/tasks?view=cancelled|trash|archived
  * GET    /api/tasks/archive-counts
  * RBAC: employee 403 on permanent + empty-trash
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"username": "serkan", "password": "19071987"}
EMP = {"username": "emp1_test", "password": "emp12345"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {creds['username']}: {r.text}"
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {_login(ADMIN)}"}


def _create(h, title):
    r = requests.post(f"{API}/tasks", json={"title": title}, headers=h, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _titles(h, view):
    r = requests.get(f"{API}/tasks", params={"scope": "mine", "view": view}, headers=h, timeout=30)
    assert r.status_code == 200, r.text
    return [t["title"] for t in r.json()]


def test_cancel_and_uncancel(admin_h):
    tid = _create(admin_h, "ZZ_ARCH_cancel")
    r = requests.post(f"{API}/tasks/{tid}/cancel", headers=admin_h, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cancelled"] is True and body["archived"] is True
    # appears in cancelled view, NOT in active
    assert "ZZ_ARCH_cancel" in _titles(admin_h, "cancelled")
    active = requests.get(f"{API}/tasks", params={"scope": "mine"}, headers=admin_h, timeout=30).json()
    assert all(t["title"] != "ZZ_ARCH_cancel" for t in active)
    # uncancel → back to active
    r = requests.post(f"{API}/tasks/{tid}/uncancel", headers=admin_h, timeout=30)
    assert r.status_code == 200 and r.json()["cancelled"] is False and r.json()["archived"] is False
    active = requests.get(f"{API}/tasks", params={"scope": "mine"}, headers=admin_h, timeout=30).json()
    assert any(t["title"] == "ZZ_ARCH_cancel" for t in active)
    # cleanup (permanent)
    requests.delete(f"{API}/tasks/{tid}/permanent", headers=admin_h, timeout=30)


def test_soft_delete_restore_and_permanent(admin_h):
    tid = _create(admin_h, "ZZ_ARCH_delete")
    # soft delete → trash
    r = requests.delete(f"{API}/tasks/{tid}", headers=admin_h, timeout=30)
    assert r.status_code == 200 and r.json().get("trashed") is True
    assert "ZZ_ARCH_delete" in _titles(admin_h, "trash")
    # not in active nor archived(done) nor cancelled
    assert "ZZ_ARCH_delete" not in _titles(admin_h, "archived")
    assert "ZZ_ARCH_delete" not in _titles(admin_h, "cancelled")
    active = requests.get(f"{API}/tasks", params={"scope": "mine"}, headers=admin_h, timeout=30).json()
    assert all(t["title"] != "ZZ_ARCH_delete" for t in active)
    # restore → back to active (was active before delete)
    r = requests.post(f"{API}/tasks/{tid}/restore", headers=admin_h, timeout=30)
    assert r.status_code == 200 and r.json()["deleted"] is False and r.json()["archived"] is False
    active = requests.get(f"{API}/tasks", params={"scope": "mine"}, headers=admin_h, timeout=30).json()
    assert any(t["title"] == "ZZ_ARCH_delete" for t in active)
    # delete again + permanent (admin)
    requests.delete(f"{API}/tasks/{tid}", headers=admin_h, timeout=30)
    r = requests.delete(f"{API}/tasks/{tid}/permanent", headers=admin_h, timeout=30)
    assert r.status_code == 200 and r.json()["deleted"] == 1
    # gone entirely
    assert "ZZ_ARCH_delete" not in _titles(admin_h, "trash")


def test_restore_keeps_prior_archived_state(admin_h):
    """Arşivdeki (BİTMİŞ) bir görev silinip geri yüklenince yine arşivde kalmalı."""
    tid = _create(admin_h, "ZZ_ARCH_done_del")
    requests.patch(f"{API}/tasks/{tid}", json={"archived": True}, headers=admin_h, timeout=30)
    requests.delete(f"{API}/tasks/{tid}", headers=admin_h, timeout=30)  # trash
    r = requests.post(f"{API}/tasks/{tid}/restore", headers=admin_h, timeout=30)
    assert r.status_code == 200 and r.json()["archived"] is True  # returns to BİTMİŞ
    assert "ZZ_ARCH_done_del" in _titles(admin_h, "archived")
    requests.delete(f"{API}/tasks/{tid}/permanent", headers=admin_h, timeout=30)


def test_archive_counts(admin_h):
    r = requests.get(f"{API}/tasks/archive-counts", params={"scope": "mine"}, headers=admin_h, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"done", "cancelled", "deleted"}
    assert all(isinstance(v, int) for v in body.values())


def test_permanent_and_empty_require_admin():
    emp_h = {"Authorization": f"Bearer {_login(EMP)}"}
    r1 = requests.delete(f"{API}/tasks/some-id/permanent", headers=emp_h, timeout=30)
    assert r1.status_code == 403
    r2 = requests.post(f"{API}/tasks/trash/empty", headers=emp_h, timeout=30)
    assert r2.status_code == 403
