"""Faz 7 — E-mail Integration backend tests (Universal IMAP/SMTP).

Covers:
- GET /api/email/providers (public — returns 6 provider presets)
- GET /api/email/accounts empty state for freshly-created user
- POST /api/email/accounts with fake creds → 400 (connection test) + rollback
- Invalid email format → 400 with Turkish error
- DELETE /api/email/accounts/{nonexistent} → {deleted: 0}
- Auth guard: 401 without Bearer on /accounts
- License guard: 402 NO_LICENSE for user without an active license
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"


# --------------- helpers -----------------------------------------------------
def _login(username: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _admin_create_user(admin_token: str, username: str, password: str, with_license: str | None = None) -> dict:
    """Create a fresh user via admin endpoint. with_license ∈ trial|monthly|yearly|lifetime|None."""
    payload = {"username": username, "password": password, "role": "user"}
    if with_license:
        payload["with_license"] = with_license
    r = requests.post(
        f"{API}/admin/users",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    assert r.status_code in (200, 201), f"create user failed: {r.status_code} {r.text}"
    return r.json()


def _admin_delete_user(admin_token: str, uid: str):
    try:
        requests.delete(
            f"{API}/admin/users/{uid}",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
    except Exception:
        pass


# --------------- fixtures ----------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_USER, ADMIN_PASS)


@pytest.fixture(scope="module")
def licensed_user(admin_token):
    """Fresh user with a trial license — cleaned up on module teardown."""
    tag = uuid.uuid4().hex[:8]
    uname = f"TEST_email_lic_{tag}"
    pwd = "Passw0rd!"
    u = _admin_create_user(admin_token, uname, pwd, with_license="trial")
    token = _login(uname, pwd)
    yield {"username": uname, "password": pwd, "token": token, "id": u["id"]}
    _admin_delete_user(admin_token, u["id"])


@pytest.fixture(scope="module")
def unlicensed_user(admin_token):
    """Fresh user WITHOUT a license — cleaned up on module teardown."""
    tag = uuid.uuid4().hex[:8]
    uname = f"TEST_email_nolic_{tag}"
    pwd = "Passw0rd!"
    u = _admin_create_user(admin_token, uname, pwd, with_license=None)
    # Try to login — server may still let user login even without license (RedeemScreen path)
    r = requests.post(f"{API}/auth/login", json={"username": uname, "password": pwd}, timeout=15)
    token = r.json().get("token") if r.status_code == 200 else None
    yield {"username": uname, "password": pwd, "token": token, "id": u["id"]}
    _admin_delete_user(admin_token, u["id"])


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# --------------- tests -------------------------------------------------------
class TestProvidersEndpoint:
    """GET /api/email/providers should return 6 preset providers."""

    def test_providers_returns_list_with_all_expected_keys(self):
        r = requests.get(f"{API}/email/providers", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        keys = {p["key"] for p in data}
        for expected in ("gmail", "outlook", "yahoo", "icloud", "yandex", "generic"):
            assert expected in keys, f"missing provider {expected}"

    def test_provider_structure(self):
        r = requests.get(f"{API}/email/providers", timeout=15)
        data = r.json()
        gmail = next(p for p in data if p["key"] == "gmail")
        # host + port + mode present
        assert gmail["imap_host"] == "imap.gmail.com"
        assert gmail["imap_port"] == 993
        assert gmail["smtp_host"] == "smtp.gmail.com"
        assert gmail["smtp_port"] == 587
        assert gmail["smtp_mode"] == "starttls"

        outlook = next(p for p in data if p["key"] == "outlook")
        assert outlook["imap_host"] == "outlook.office365.com"
        assert outlook["smtp_host"] == "smtp-mail.outlook.com"
        assert outlook["smtp_mode"] == "starttls"

        yahoo = next(p for p in data if p["key"] == "yahoo")
        assert yahoo["smtp_port"] == 465
        assert yahoo["smtp_mode"] == "tls"


class TestAccountsListing:
    """GET /api/email/accounts."""

    def test_new_user_empty_list(self, licensed_user):
        r = requests.get(f"{API}/email/accounts", headers=_auth(licensed_user["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == []

    def test_no_bearer_returns_401(self):
        r = requests.get(f"{API}/email/accounts", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


class TestAddAccountRollback:
    """POST /api/email/accounts must test the connection and roll back on failure."""

    def test_fake_creds_returns_400_and_no_persistence(self, licensed_user):
        payload = {
            "email": "sertex-test@hotmail.com",
            "app_password": "fake-app-pass-1234",
            "provider": "outlook",
        }
        r = requests.post(
            f"{API}/email/accounts",
            json=payload,
            headers=_auth(licensed_user["token"]),
            timeout=45,  # connection test may take up to ~30s
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
        detail = r.json().get("detail", "")
        # Should mention connection failure — either 'bağlantı' or 'giriş' or 'başarısız'
        assert any(k in detail.lower() for k in ("bağlantı", "giriş", "başarısız", "authentication")), detail

        # Verify account list is still empty (rollback worked)
        r2 = requests.get(
            f"{API}/email/accounts", headers=_auth(licensed_user["token"]), timeout=15
        )
        assert r2.status_code == 200
        emails = [a["email"] for a in r2.json()]
        assert "sertex-test@hotmail.com" not in emails, (
            f"Broken account was NOT rolled back — accounts: {r2.json()}"
        )

    def test_invalid_email_format_400_turkish(self, licensed_user):
        r = requests.post(
            f"{API}/email/accounts",
            json={"email": "notanemail", "app_password": "some-pass-1234", "provider": "generic"},
            headers=_auth(licensed_user["token"]),
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "Geçerli bir e-posta adresi giriniz" in r.json().get("detail", "")


class TestDeleteAccount:
    def test_delete_nonexistent_returns_zero(self, licensed_user):
        r = requests.delete(
            f"{API}/email/accounts/{uuid.uuid4()}",
            headers=_auth(licensed_user["token"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"deleted": 0}


class TestAuthAndLicenseGuards:
    """All account-scoped endpoints require Bearer + active license."""

    def test_accounts_without_bearer_is_401(self):
        r = requests.get(f"{API}/email/accounts", timeout=15)
        assert r.status_code in (401, 403)

    def test_add_account_without_bearer_is_401(self):
        r = requests.post(
            f"{API}/email/accounts",
            json={"email": "a@b.com", "app_password": "xxxxxxxx"},
            timeout=15,
        )
        assert r.status_code in (401, 403)

    def test_unlicensed_user_gets_402_on_accounts(self, unlicensed_user):
        tok = unlicensed_user["token"]
        if not tok:
            pytest.skip("Unlicensed user could not login — cannot verify 402")
        r = requests.get(f"{API}/email/accounts", headers=_auth(tok), timeout=15)
        assert r.status_code == 402, f"expected 402 NO_LICENSE, got {r.status_code} {r.text}"
        assert "NO_LICENSE" in r.json().get("detail", "")

    def test_unlicensed_user_gets_402_on_add(self, unlicensed_user):
        tok = unlicensed_user["token"]
        if not tok:
            pytest.skip("Unlicensed user could not login")
        r = requests.post(
            f"{API}/email/accounts",
            json={"email": "x@y.com", "app_password": "xxxxxxxx", "provider": "gmail"},
            headers=_auth(tok),
            timeout=15,
        )
        assert r.status_code == 402
