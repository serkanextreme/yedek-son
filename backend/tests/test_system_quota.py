"""Backend tests for iteration_40 — Admin system-wide storage quota.

Covers:
- GET /api/admin/system-quota (admin only, 403 for non-admin)
- PUT /api/admin/system-quota (validation, 403 for non-admin)
- /api/stats/summary now returns quota_mb=<system_setting> for admin,
  license_label='Sistem', is_admin_scope=true
- Quota reshapes math: db_mb / quota_mb * 100 rounded to 1 dp
- Cleanup: restores system quota to 10240 MB (10 GB) at end
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com").rstrip("/")

DEFAULT_QUOTA_MB = 10240
MIN_QUOTA_MB = 100
MAX_QUOTA_MB = 10 * 1024 * 1024  # 10 TB


def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {username}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("serkan", "19071987")


@pytest.fixture(scope="module")
def user_token():
    return _login("ahmet", "ahmet123")


@pytest.fixture(scope="module", autouse=True)
def _restore_quota(admin_token):
    """Ensure quota is 10 GB before and after this module runs."""
    requests.put(
        f"{BASE_URL}/api/admin/system-quota",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"quota_mb": DEFAULT_QUOTA_MB},
        timeout=15,
    )
    yield
    requests.put(
        f"{BASE_URL}/api/admin/system-quota",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"quota_mb": DEFAULT_QUOTA_MB},
        timeout=15,
    )


class TestGetSystemQuota:
    def test_admin_can_read(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("quota_mb", "min_mb", "max_mb", "default_mb"):
            assert k in d, f"missing key {k}"
        assert d["default_mb"] == DEFAULT_QUOTA_MB
        assert d["min_mb"] == MIN_QUOTA_MB
        assert d["max_mb"] == MAX_QUOTA_MB
        assert isinstance(d["quota_mb"], int) and d["quota_mb"] >= MIN_QUOTA_MB

    def test_non_admin_forbidden(self, user_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=15,
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"

    def test_unauthenticated_401(self):
        r = requests.get(f"{BASE_URL}/api/admin/system-quota", timeout=15)
        assert r.status_code == 401


class TestPutSystemQuota:
    def test_admin_can_update_and_read(self, admin_token):
        # Update to 1 GB
        r = requests.put(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"quota_mb": 1024},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["quota_mb"] == 1024

        # Verify persisted via GET
        got = requests.get(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        ).json()
        assert got["quota_mb"] == 1024

    def test_admin_update_reflects_in_stats_summary(self, admin_token):
        # Set to 256000 (250 GB)
        requests.put(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"quota_mb": 256000},
            timeout=15,
        )
        stats = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        ).json()
        assert stats["is_admin_scope"] is True
        assert stats["quota_mb"] == 256000
        assert stats["license_label"] == "Sistem"
        # quota_percent must be db_mb/quota_mb*100 rounded to 1 dp
        expected = round((stats["db_mb"] / 256000) * 100, 1)
        assert stats["quota_percent"] == expected

    def test_stats_summary_math_reshapes_low_pct_after_increase(self, admin_token):
        # Set quota to 10 MB below the DB size wouldn't validate (< min);
        # instead just verify: after raising quota from small to huge, pct drops.
        # Set to MIN (100 MB) first
        requests.put(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"quota_mb": MIN_QUOTA_MB},
            timeout=15,
        )
        low = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        ).json()
        pct_at_min = low["quota_percent"]

        # Now bump to 250 GB
        requests.put(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"quota_mb": 256000},
            timeout=15,
        )
        high = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        ).json()
        pct_at_high = high["quota_percent"]

        # Percent at min quota must be strictly larger than at high quota
        # (unless db_mb is 0.0, in which case both are 0.0 and equal). Assert >=.
        assert pct_at_high <= pct_at_min, (
            f"Expected reshape to lower pct: min-quota pct={pct_at_min}, high-quota pct={pct_at_high}"
        )
        # Math check with the exact user scenario: db_mb=8192 (8 GB), if quota=10240 → pct=80,
        # if quota=256000 → pct=3.2. Assert the formula holds for real db_mb values.
        assert high["quota_percent"] == round((high["db_mb"] / 256000) * 100, 1)

    def test_below_min_rejected(self, admin_token):
        r = requests.put(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"quota_mb": MIN_QUOTA_MB - 1},
            timeout=15,
        )
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"

    def test_zero_rejected(self, admin_token):
        r = requests.put(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"quota_mb": 0},
            timeout=15,
        )
        assert r.status_code == 422

    def test_above_max_rejected(self, admin_token):
        r = requests.put(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"quota_mb": MAX_QUOTA_MB + 1},
            timeout=15,
        )
        assert r.status_code == 422

    def test_non_admin_forbidden(self, user_token):
        r = requests.put(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {user_token}"},
            json={"quota_mb": 500},
            timeout=15,
        )
        assert r.status_code == 403

    def test_unauthenticated_401(self):
        r = requests.put(
            f"{BASE_URL}/api/admin/system-quota",
            json={"quota_mb": 500},
            timeout=15,
        )
        assert r.status_code == 401


class TestAdminStatsSummaryQuota:
    def test_admin_default_10gb(self, admin_token):
        # Reset to default
        requests.put(
            f"{BASE_URL}/api/admin/system-quota",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"quota_mb": DEFAULT_QUOTA_MB},
            timeout=15,
        )
        stats = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        ).json()
        assert stats["is_admin_scope"] is True
        assert stats["quota_mb"] == DEFAULT_QUOTA_MB
        assert stats["license_label"] == "Sistem"
        assert stats["quota_percent"] == round((stats["db_mb"] / DEFAULT_QUOTA_MB) * 100, 1)
        # All 10 legacy stat keys present
        legacy = {"tasks_active", "tasks_total", "notes", "files", "conversations",
                  "memories", "email_accounts", "db_bytes", "db_mb", "is_admin_scope"}
        assert legacy.issubset(set(stats.keys()))

    def test_user_still_gets_license_based_quota(self, user_token):
        stats = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=15,
        ).json()
        assert stats["is_admin_scope"] is False
        # ahmet has trial license → quota_mb=100
        assert stats["license_label"] in ("Deneme (30 gün)",), f"Got {stats['license_label']!r}"
        assert stats["quota_mb"] == 100
