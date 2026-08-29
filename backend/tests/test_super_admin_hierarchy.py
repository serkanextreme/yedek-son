"""Süper Yönetici / Kurucu (owner) rol hiyerarşisi — RBAC regression guard.

Doğrulanan davranışlar:
  * Kurucu (serkan) = super_admin + is_owner, dokunulmaz.
  * Sistem uçları (system-quota, super-admins, health, client-logs) = yalnızca süper yönetici.
  * Yönetici (admin) = şirket kapsamlı (yalnızca kendi şirketindeki kullanıcıları görür).
  * Süper yönetici → yöneticiye özel fonksiyon tanır (create_company / view_company_tasks).
  * Süreli süper yönetici: kurucu atar/geri alır; kurucu üzerinde işlem yapılamaz.

Not: Canlı API'ye vurur; kendi test verisini oluşturur ve sonunda temizler.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
OWNER = {"username": "serkan", "password": "19071987"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        return None
    return r.json().get("token")


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_h():
    tok = _login(OWNER)
    assert tok, "Owner (serkan) login failed"
    return _h(tok)


@pytest.fixture(scope="module")
def scenario(owner_h):
    """Create an isolated company + an admin + an employee. Yields ids; cleans up."""
    suffix = uuid.uuid4().hex[:6]
    cname = f"RBACTEST-{suffix}"
    cid = requests.post(f"{API}/companies", headers=owner_h, json={"name": cname}, timeout=30).json()["id"]
    admin_u = f"rbac_admin_{suffix}"
    emp_u = f"rbac_emp_{suffix}"
    pw = "rbactest12345"
    admin = requests.post(f"{API}/admin/users", headers=owner_h,
                          json={"username": admin_u, "password": pw, "role": "admin", "company_id": cid},
                          timeout=30).json()
    emp = requests.post(f"{API}/admin/users", headers=owner_h,
                        json={"username": emp_u, "password": pw, "role": "employee", "company_id": cid},
                        timeout=30).json()
    data = {"cid": cid, "admin_id": admin["id"], "emp_id": emp["id"],
            "admin_u": admin_u, "emp_u": emp_u, "pw": pw}
    yield data
    # cleanup
    fresh = _h(_login(OWNER))
    for uid in (admin["id"], emp["id"]):
        requests.delete(f"{API}/admin/users/{uid}?mode=hard", headers=fresh, timeout=30)


def _owner_id(owner_h):
    return requests.get(f"{API}/auth/me", headers=owner_h, timeout=30).json()["id"]


def test_owner_is_super_and_owner(owner_h):
    me = requests.get(f"{API}/auth/me", headers=owner_h, timeout=30).json()
    assert me["is_owner"] is True
    assert me["is_super_admin"] is True
    assert me["role"] == "super_admin"


def test_admin_is_company_scoped(owner_h, scenario):
    at = _login({"username": scenario["admin_u"], "password": scenario["pw"]})
    ah = _h(at)
    me = requests.get(f"{API}/auth/me", headers=ah, timeout=30).json()
    assert me["role"] == "admin" and not me["is_super_admin"]
    users = requests.get(f"{API}/admin/users", headers=ah, timeout=30).json()
    names = {u["username"] for u in users}
    assert names <= {scenario["admin_u"], scenario["emp_u"]}, f"admin saw foreign users: {names}"


def test_system_endpoints_super_only(owner_h, scenario):
    ah = _h(_login({"username": scenario["admin_u"], "password": scenario["pw"]}))
    for path in ("/admin/system-quota", "/admin/super-admins", "/admin/health", "/admin/client-logs"):
        r = requests.get(f"{API}{path}", headers=ah, timeout=30)
        assert r.status_code == 403, f"{path} should be 403 for admin, got {r.status_code}"
    # owner allowed
    oh = _h(_login(OWNER))
    assert requests.get(f"{API}/admin/system-quota", headers=oh, timeout=30).status_code == 200


def test_owner_untouchable_by_admin(owner_h, scenario):
    oid = _owner_id(_h(_login(OWNER)))
    ah = _h(_login({"username": scenario["admin_u"], "password": scenario["pw"]}))
    assert requests.patch(f"{API}/admin/users/{oid}", headers=ah, json={"role": "employee"}, timeout=30).status_code == 403
    assert requests.delete(f"{API}/admin/users/{oid}?mode=hard", headers=ah, timeout=30).status_code in (403, 400)
    assert requests.post(f"{API}/admin/users/{oid}/impersonate", headers=ah, timeout=30).status_code == 403


def test_admin_cannot_promote_super(owner_h, scenario):
    ah = _h(_login({"username": scenario["admin_u"], "password": scenario["pw"]}))
    r = requests.post(f"{API}/admin/users/{scenario['admin_id']}/super-admin", headers=ah, json={"hours": 2}, timeout=30)
    assert r.status_code == 403


def test_create_company_requires_cap(owner_h, scenario):
    oh = _h(_login(OWNER))
    ah = _h(_login({"username": scenario["admin_u"], "password": scenario["pw"]}))
    # without cap → 403
    assert requests.post(f"{API}/companies", headers=ah, json={"name": f"NOCAP-{uuid.uuid4().hex[:5]}"}, timeout=30).status_code == 403
    # grant cap → allowed
    requests.patch(f"{API}/admin/users/{scenario['admin_id']}/admin-caps", headers=oh,
                   json={"can_create_company": True}, timeout=30)
    ah2 = _h(_login({"username": scenario["admin_u"], "password": scenario["pw"]}))
    newco = requests.post(f"{API}/companies", headers=ah2, json={"name": f"CAPCO-{uuid.uuid4().hex[:5]}"}, timeout=30)
    assert newco.status_code in (200, 201), newco.text


def test_temp_super_admin_promote_and_revoke(owner_h, scenario):
    oh = _h(_login(OWNER))
    aid = scenario["admin_id"]
    r = requests.post(f"{API}/admin/users/{aid}/super-admin", headers=oh, json={"hours": 2}, timeout=30)
    assert r.status_code == 200 and r.json()["role"] == "super_admin"
    ah = _h(_login({"username": scenario["admin_u"], "password": scenario["pw"]}))
    me = requests.get(f"{API}/auth/me", headers=ah, timeout=30).json()
    assert me["is_super_admin"] is True and me["super_admin_until"]
    # temp super can hit system endpoint now
    assert requests.get(f"{API}/admin/system-quota", headers=ah, timeout=30).status_code == 200
    # ...but still cannot touch the owner
    oid = _owner_id(oh)
    assert requests.patch(f"{API}/admin/users/{oid}", headers=ah, json={"role": "employee"}, timeout=30).status_code == 403
    # owner revokes early
    oh2 = _h(_login(OWNER))
    rr = requests.delete(f"{API}/admin/users/{aid}/super-admin", headers=oh2, timeout=30)
    assert rr.status_code == 200 and rr.json()["role"] == "admin"
