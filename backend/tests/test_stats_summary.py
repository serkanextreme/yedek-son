"""Backend tests for GET /api/stats/summary (iteration_37)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com").rstrip("/")

EXPECTED_KEYS = {
    "tasks_active", "tasks_total", "notes", "files", "conversations",
    "memories", "email_accounts", "db_bytes", "db_mb", "is_admin_scope",
    # iteration_39 — storage quota fields
    "quota_mb", "quota_percent", "license_type", "license_label",
}


def _login(username: str, password: str) -> str:
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


class TestStatsSummary:
    def test_unauthorized_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/stats/summary", timeout=15)
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    def test_admin_stats_shape_and_is_admin_scope(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Shape
        missing = EXPECTED_KEYS - set(data.keys())
        assert not missing, f"Missing keys: {missing}. Got: {list(data.keys())}"
        # is_admin_scope
        assert data["is_admin_scope"] is True, f"is_admin_scope should be True, got {data['is_admin_scope']}"
        # db_mb positive float
        assert isinstance(data["db_mb"], (int, float)), f"db_mb type: {type(data['db_mb'])}"
        assert data["db_mb"] > 0, f"db_mb expected >0 for admin scope, got {data['db_mb']}"
        assert data["db_bytes"] > 0
        # tasks_active <= tasks_total
        assert data["tasks_active"] <= data["tasks_total"]
        # numeric counts non-negative
        for k in ["tasks_active", "tasks_total", "notes", "files", "conversations", "memories", "email_accounts"]:
            assert isinstance(data[k], int)
            assert data[k] >= 0

    def test_user_stats_shape_and_scope(self, user_token):
        r = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["is_admin_scope"] is False
        # For a regular user db_mb should be small/non-negative (could be 0 for fresh user)
        assert data["db_mb"] >= 0
        assert isinstance(data["db_mb"], (int, float))
        for k in ["tasks_active", "tasks_total", "notes", "files", "conversations", "memories", "email_accounts"]:
            assert isinstance(data[k], int)
            assert data[k] >= 0

    def test_admin_db_size_larger_than_user_db_size(self, admin_token, user_token):
        admin_data = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        ).json()
        user_data = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=15,
        ).json()
        # Admin sees whole-db size, user sees only own — admin should be strictly larger
        assert admin_data["db_bytes"] > user_data["db_bytes"], (
            f"Expected admin db_bytes > user db_bytes; admin={admin_data['db_bytes']} user={user_data['db_bytes']}"
        )

    def test_personal_counts_differ_between_admin_and_user(self, admin_token, user_token):
        """Personal counts must be scoped per-user even for admin."""
        admin_data = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        ).json()
        user_data = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=15,
        ).json()
        # At least one of the personal count fields should differ (very likely given
        # admin has been active and ahmet is a test user).
        personal_keys = ["tasks_total", "notes", "files", "conversations", "memories", "email_accounts"]
        admin_vec = tuple(admin_data[k] for k in personal_keys)
        user_vec = tuple(user_data[k] for k in personal_keys)
        assert admin_vec != user_vec, (
            f"Personal counts identical for admin & user — scoping may be broken. "
            f"admin={admin_vec} user={user_vec}"
        )

    def test_task_active_semantics(self, admin_token):
        """tasks_active should equal count of user's tasks where status != 'done' and archived is not true."""
        # Sanity: create a task, then verify counters move.
        headers = {"Authorization": f"Bearer {admin_token}"}
        before = requests.get(f"{BASE_URL}/api/stats/summary", headers=headers, timeout=15).json()

        # Create task
        create = requests.post(
            f"{BASE_URL}/api/tasks",
            headers=headers,
            json={"title": "TEST_stats_summary_task"},
            timeout=15,
        )
        if create.status_code not in (200, 201):
            pytest.skip(f"Could not create task (status {create.status_code}) — skipping active-count test")
        task_id = create.json().get("id")

        after = requests.get(f"{BASE_URL}/api/stats/summary", headers=headers, timeout=15).json()
        assert after["tasks_total"] == before["tasks_total"] + 1
        assert after["tasks_active"] == before["tasks_active"] + 1

        # Cleanup
        if task_id:
            requests.delete(f"{BASE_URL}/api/tasks/{task_id}", headers=headers, timeout=15)


# ------------------------------------------------------------------
# iteration_39 — Storage Quota progress bar
# ------------------------------------------------------------------
class TestStorageQuota:
    def test_admin_quota_system_wide_label_sistem(self, admin_token):
        """iteration_40: admin now gets a system-wide numeric quota (default 10 GB = 10240 MB)
        instead of None. license_type still None (admin doesn't have a license), label='Sistem'."""
        r = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["is_admin_scope"] is True
        assert isinstance(d["quota_mb"], int) and d["quota_mb"] >= 100, f"Admin quota_mb should be int >=100, got {d['quota_mb']}"
        assert isinstance(d["quota_percent"], (int, float)), f"Admin quota_percent should be numeric, got {d['quota_percent']}"
        assert d["license_type"] is None, f"Admin license_type must be None, got {d['license_type']}"
        assert d["license_label"] == "Sistem", f"Admin license_label must be 'Sistem', got {d['license_label']}"

    def test_user_trial_quota_100mb(self, user_token):
        r = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["is_admin_scope"] is False
        assert d["license_type"] == "trial", f"Expected trial, got {d['license_type']}"
        assert d["quota_mb"] == 100, f"Trial quota_mb should be 100, got {d['quota_mb']}"
        assert d["license_label"] == "Deneme (30 gün)", f"Got {d['license_label']!r}"
        # quota_percent should be db_mb/quota_mb * 100 rounded to 1 dp
        assert isinstance(d["quota_percent"], (int, float))
        expected_pct = round((d["db_mb"] / d["quota_mb"]) * 100, 1)
        assert d["quota_percent"] == expected_pct, f"quota_percent {d['quota_percent']} != {expected_pct}"
        # For a low-usage user, percent should be small
        assert d["quota_percent"] < 75.0

    def test_all_previous_keys_still_present(self, user_token):
        """Regression: all iteration_37/38 keys must still exist alongside new quota fields."""
        r = requests.get(
            f"{BASE_URL}/api/stats/summary",
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=15,
        )
        d = r.json()
        prior_keys = {
            "tasks_active", "tasks_total", "notes", "files", "conversations",
            "memories", "email_accounts", "db_bytes", "db_mb", "is_admin_scope",
        }
        missing = prior_keys - set(d.keys())
        assert not missing, f"Regression: missing keys {missing}"

    def test_new_quota_keys_present_admin_and_user(self, admin_token, user_token):
        new_keys = {"quota_mb", "quota_percent", "license_type", "license_label"}
        for tok, who in [(admin_token, "admin"), (user_token, "user")]:
            r = requests.get(
                f"{BASE_URL}/api/stats/summary",
                headers={"Authorization": f"Bearer {tok}"},
                timeout=15,
            )
            d = r.json()
            missing = new_keys - set(d.keys())
            assert not missing, f"[{who}] missing new keys {missing}"
