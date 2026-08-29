"""Backend tests for iteration_41 — Admin per-user storage quota override.

Covers:
- POST /api/admin/users with optional custom_quota_mb (Field ge=1, le=10485760)
- PATCH /api/admin/users/{uid} with optional custom_quota_mb (Field ge=0, le=10485760)
    * >0 → $set the override
    * 0  → $unset the field (fall back to license default)
    * absent → preserve prior value
- GET  /api/admin/users returns custom_quota_mb when present (password_hash never)
- GET  /api/stats/summary user branch priority chain:
    (1) custom_quota_mb>0 → quota_mb=override, license_label='Özel (Yönetici)'
    (2) else license default (trial → 100 MB, 'Deneme (30 gün)')
    (3) else FREE_QUOTA_MB=50, 'Ücretsiz'
- Validation: values -1 or 10485761 → 422
- RBAC: non-admin (ahmet) → 403 on admin endpoints
- Cleanup: unsets ahmet's custom_quota_mb at teardown so ahmet returns to trial
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com").rstrip("/")

MAX_QUOTA_MB = 10 * 1024 * 1024  # 10 TB


def _login(username, password):
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": username, "password": password},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed for {username}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("serkan", "19071987")


@pytest.fixture(scope="module")
def user_token():
    return _login("ahmet", "ahmet123")


def _admin_headers(tok):
    return {"Authorization": f"Bearer {tok}"}


def _find_user(admin_token, username):
    r = requests.get(f"{BASE_URL}/api/admin/users", headers=_admin_headers(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    for u in r.json():
        if u["username"] == username:
            return u
    return None


@pytest.fixture(scope="module")
def ahmet_uid(admin_token):
    u = _find_user(admin_token, "ahmet")
    assert u is not None, "ahmet user missing — expected pre-seeded"
    return u["id"]


@pytest.fixture(scope="module", autouse=True)
def _cleanup_ahmet_quota(admin_token, ahmet_uid):
    """Always clear ahmet's custom_quota_mb before and after this module."""
    requests.patch(
        f"{BASE_URL}/api/admin/users/{ahmet_uid}",
        headers=_admin_headers(admin_token),
        json={"custom_quota_mb": 0},
        timeout=15,
    )
    yield
    requests.patch(
        f"{BASE_URL}/api/admin/users/{ahmet_uid}",
        headers=_admin_headers(admin_token),
        json={"custom_quota_mb": 0},
        timeout=15,
    )


# ---------------------------------------------------------------
# POST /api/admin/users — create user with optional custom_quota_mb
# ---------------------------------------------------------------
class TestCreateUserWithQuota:
    def _delete(self, admin_token, uid):
        requests.delete(
            f"{BASE_URL}/api/admin/users/{uid}",
            headers=_admin_headers(admin_token),
            timeout=15,
        )

    def test_create_user_with_custom_quota_mb(self, admin_token):
        uname = f"TEST_quota_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            headers=_admin_headers(admin_token),
            json={
                "username": uname,
                "password": "pass1234",
                "role": "user",
                "custom_quota_mb": 3072,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["username"] == uname
        assert body.get("custom_quota_mb") == 3072, f"Expected 3072, got {body.get('custom_quota_mb')}"
        # password_hash must NOT be exposed
        assert "password_hash" not in body
        # Verify via list
        u = _find_user(admin_token, uname)
        assert u and u.get("custom_quota_mb") == 3072
        self._delete(admin_token, body["id"])

    def test_create_user_without_quota_field_omits_it(self, admin_token):
        uname = f"TEST_noquota_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            headers=_admin_headers(admin_token),
            json={"username": uname, "password": "pass1234", "role": "user"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Field should be absent (not present or None) — spec: "değer olmadığında/None ise doc'a yazılmaz"
        assert "custom_quota_mb" not in body or body.get("custom_quota_mb") in (None,), (
            f"Expected no custom_quota_mb, got {body.get('custom_quota_mb')}"
        )
        u = _find_user(admin_token, uname)
        assert u is not None
        assert "custom_quota_mb" not in u or u.get("custom_quota_mb") in (None,)
        self._delete(admin_token, body["id"])

    def test_create_user_with_custom_quota_mb_null_omits(self, admin_token):
        uname = f"TEST_nullq_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            headers=_admin_headers(admin_token),
            json={
                "username": uname,
                "password": "pass1234",
                "role": "user",
                "custom_quota_mb": None,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("custom_quota_mb") in (None,) or "custom_quota_mb" not in body
        self._delete(admin_token, body["id"])

    def test_create_user_quota_negative_rejected_422(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            headers=_admin_headers(admin_token),
            json={
                "username": f"TEST_neg_{uuid.uuid4().hex[:6]}",
                "password": "pass1234",
                "role": "user",
                "custom_quota_mb": -1,
            },
            timeout=15,
        )
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"

    def test_create_user_quota_above_max_rejected_422(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            headers=_admin_headers(admin_token),
            json={
                "username": f"TEST_max_{uuid.uuid4().hex[:6]}",
                "password": "pass1234",
                "role": "user",
                "custom_quota_mb": MAX_QUOTA_MB + 1,
            },
            timeout=15,
        )
        assert r.status_code == 422

    def test_create_user_quota_zero_rejected_by_create(self, admin_token):
        """CREATE uses ge=1 → 0 is invalid at pydantic level → 422."""
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            headers=_admin_headers(admin_token),
            json={
                "username": f"TEST_zero_{uuid.uuid4().hex[:6]}",
                "password": "pass1234",
                "role": "user",
                "custom_quota_mb": 0,
            },
            timeout=15,
        )
        assert r.status_code == 422, f"Expected 422 (ge=1), got {r.status_code}: {r.text}"

    def test_non_admin_cannot_create_403(self, user_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            headers=_admin_headers(user_token),
            json={
                "username": "TEST_nope",
                "password": "pass1234",
                "role": "user",
                "custom_quota_mb": 1024,
            },
            timeout=15,
        )
        assert r.status_code == 403


# ---------------------------------------------------------------
# PATCH /api/admin/users/{uid} — set / unset custom_quota_mb
# ---------------------------------------------------------------
class TestPatchUserQuota:
    def test_set_quota_5120_on_ahmet(self, admin_token, ahmet_uid):
        r = requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": 5120},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("custom_quota_mb") == 5120, body
        # Verify via listing
        u = _find_user(admin_token, "ahmet")
        assert u["custom_quota_mb"] == 5120

    def test_zero_unsets_field(self, admin_token, ahmet_uid):
        # First set
        requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": 4096},
            timeout=15,
        )
        # Then unset with 0
        r = requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": 0},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # After $unset, field should be gone or explicitly null
        assert "custom_quota_mb" not in body or body["custom_quota_mb"] in (None,), body
        # Also verify via list
        u = _find_user(admin_token, "ahmet")
        assert "custom_quota_mb" not in u or u.get("custom_quota_mb") in (None,)

    def test_absent_field_preserves_value(self, admin_token, ahmet_uid):
        # Set to a known value
        requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": 2048},
            timeout=15,
        )
        # Now patch with unrelated field only
        r = requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"role": "user"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # Value should still be 2048
        u = _find_user(admin_token, "ahmet")
        assert u.get("custom_quota_mb") == 2048, u
        # Cleanup
        requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": 0},
            timeout=15,
        )

    def test_patch_quota_negative_rejected(self, admin_token, ahmet_uid):
        r = requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": -1},
            timeout=15,
        )
        assert r.status_code == 422

    def test_patch_quota_above_max_rejected(self, admin_token, ahmet_uid):
        r = requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": MAX_QUOTA_MB + 1},
            timeout=15,
        )
        assert r.status_code == 422

    def test_non_admin_cannot_patch(self, user_token, ahmet_uid):
        r = requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(user_token),
            json={"custom_quota_mb": 1024},
            timeout=15,
        )
        assert r.status_code == 403


# ---------------------------------------------------------------
# GET /api/admin/users response shape
# ---------------------------------------------------------------
class TestListUsersExposesQuota:
    def test_list_users_shows_custom_quota_mb_when_set(self, admin_token, ahmet_uid):
        # set
        requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": 3072},
            timeout=15,
        )
        r = requests.get(
            f"{BASE_URL}/api/admin/users",
            headers=_admin_headers(admin_token),
            timeout=15,
        )
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) >= 2
        # password_hash must NEVER be present
        for u in users:
            assert "password_hash" not in u
            assert "_id" not in u
        ahmet = next(u for u in users if u["username"] == "ahmet")
        assert ahmet.get("custom_quota_mb") == 3072
        # cleanup
        requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": 0},
            timeout=15,
        )


# ---------------------------------------------------------------
# GET /api/stats/summary priority chain (override > license > free)
# ---------------------------------------------------------------
class TestStatsSummaryPriorityChain:
    def test_override_wins_over_trial(self, admin_token, ahmet_uid, user_token):
        # 5 GB override
        requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": 5120},
            timeout=15,
        )
        stats = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers=_admin_headers(user_token),
            timeout=15,
        ).json()
        assert stats["is_admin_scope"] is False
        assert stats["quota_mb"] == 5120, stats
        assert stats["license_label"] == "Özel (Yönetici)", stats
        # cleanup
        requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": 0},
            timeout=15,
        )

    def test_after_unset_returns_to_trial_default(self, admin_token, ahmet_uid, user_token):
        # ensure unset
        requests.patch(
            f"{BASE_URL}/api/admin/users/{ahmet_uid}",
            headers=_admin_headers(admin_token),
            json={"custom_quota_mb": 0},
            timeout=15,
        )
        stats = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers=_admin_headers(user_token),
            timeout=15,
        ).json()
        assert stats["is_admin_scope"] is False
        assert stats["quota_mb"] == 100, f"Ahmet trial should default to 100 MB, got {stats['quota_mb']}"
        assert stats["license_label"] == "Deneme (30 gün)"
        assert stats["license_type"] == "trial"

    def test_new_user_with_override_uses_override_immediately(self, admin_token):
        """Create user with custom_quota_mb → stats/summary reflects override
        without needing a license (license_type stays None or license default)."""
        uname = f"TEST_ovr_{uuid.uuid4().hex[:6]}"
        pw = "pass1234"
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            headers=_admin_headers(admin_token),
            json={
                "username": uname,
                "password": pw,
                "role": "user",
                "custom_quota_mb": 2048,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        new_uid = r.json()["id"]
        try:
            # Login as new user
            tok = _login(uname, pw)
            stats = requests.get(
                f"{BASE_URL}/api/stats/summary",
                headers=_admin_headers(tok),
                timeout=15,
            ).json()
            assert stats["quota_mb"] == 2048, stats
            assert stats["license_label"] == "Özel (Yönetici)", stats
        finally:
            requests.delete(
                f"{BASE_URL}/api/admin/users/{new_uid}",
                headers=_admin_headers(admin_token),
                timeout=15,
            )
