"""
Sertex Faz 3.5 — Chat-embedded live charts backend tests.

Covers:
- POST /api/chat with chart-intent Turkish message + spreadsheet → assistant_message.chart populated
- Non-chart Turkish message → chart is None
- Chart-intent message with NO spreadsheet → chart is None (silent fallback)
- Chart persisted with assistant message → GET /api/conversations/{id}/messages returns chart intact
- x==y edge case (pie/category count) → does not raise, returns chart
- Unlicensed user hitting /api/chat gets 402 NO_LICENSE (chart logic doesn't bypass gating)
- RAG + memory extraction still work in the same request that produced a chart

Cleanup: All uploaded spreadsheet files are deleted after the test module.
Does NOT delete ahmet's license.
"""
import os
import uuid
import time
from pathlib import Path

import pytest
import requests


# ---- Env helpers (mirrors backend_test.py) ---------------------------------
def _read_env(key: str, default: str = "") -> str:
    v = os.environ.get(key)
    if v:
        return v
    for path in ("/app/backend/.env", "/app/frontend/.env"):
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, val = line.split("=", 1)
                    if k.strip() == key:
                        return val.strip().strip('"').strip("'")
        except OSError:
            continue
    return default


BASE_URL = _read_env("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_USER = _read_env("INITIAL_USERNAME", "serkan")
ADMIN_PASS = _read_env("INITIAL_PASSWORD", "19071987")
AHMET_USER = "ahmet"
AHMET_PASS = "ahmet123"

FIXTURE = Path("/app/backend/tests/fixtures/satislar.xlsx")


def _bearer(t):
    return {"Authorization": f"Bearer {t}"}


def _login(username: str, password: str) -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"username": username, "password": password},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["token"]


# ---- Fixtures --------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_USER, ADMIN_PASS)


@pytest.fixture(scope="module")
def ahmet_token(admin_token):
    """Login as ahmet. Assumes user exists with an active license per test_credentials.md."""
    try:
        return _login(AHMET_USER, AHMET_PASS)
    except requests.HTTPError:
        # Create via admin as a safety net (will still require license for /api/chat)
        r = requests.post(
            f"{API}/admin/users",
            json={"username": AHMET_USER, "password": AHMET_PASS, "role": "user"},
            headers=_bearer(admin_token),
            timeout=30,
        )
        assert r.status_code in (200, 201), f"Failed to create ahmet: {r.status_code} {r.text}"
        return _login(AHMET_USER, AHMET_PASS)


@pytest.fixture(scope="module")
def fixture_bytes():
    assert FIXTURE.exists(), f"Fixture missing: {FIXTURE}"
    return FIXTURE.read_bytes()


@pytest.fixture(scope="module")
def ahmet_spreadsheet_id(ahmet_token, fixture_bytes):
    """Upload the sample spreadsheet as ahmet, yield file_id, delete after tests."""
    files = {
        "file": (
            f"TEST_satislar_{uuid.uuid4().hex[:8]}.xlsx",
            fixture_bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    r = requests.post(
        f"{API}/files",
        headers=_bearer(ahmet_token),
        files=files,
        timeout=60,
    )
    assert r.status_code in (200, 201), f"Upload failed: {r.status_code} {r.text}"
    fid = r.json()["id"]
    yield fid
    try:
        requests.delete(f"{API}/files/{fid}", headers=_bearer(ahmet_token), timeout=15)
    except Exception:
        pass


@pytest.fixture(scope="module")
def unlicensed_user(admin_token):
    """Create a fresh regular user WITHOUT a license, yield (username, password, token)."""
    uname = f"TEST_unl_{uuid.uuid4().hex[:6]}"
    pwd = "unlicensed123"
    r = requests.post(
        f"{API}/admin/users",
        json={"username": uname, "password": pwd, "role": "user"},
        headers=_bearer(admin_token),
        timeout=30,
    )
    assert r.status_code in (200, 201), f"Failed to create unlicensed user: {r.text}"
    uid = r.json().get("id")
    token = _login(uname, pwd)
    yield {"username": uname, "password": pwd, "token": token, "id": uid}
    # Cleanup
    if uid:
        try:
            requests.delete(f"{API}/admin/users/{uid}", headers=_bearer(admin_token), timeout=15)
        except Exception:
            pass


def _chat(token: str, message: str, conversation_id=None, timeout=180):
    payload = {"message": message, "language": "tr"}
    if conversation_id:
        payload["conversation_id"] = conversation_id
    return requests.post(f"{API}/chat", headers=_bearer(token), json=payload, timeout=timeout)


# ---- 1) Non-chart message (no chart even if spreadsheet exists) -----------
class TestChartIntentDetection:
    def test_greeting_chart_is_none(self, ahmet_token, ahmet_spreadsheet_id):
        r = _chat(ahmet_token, "selam")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["assistant_message"].get("chart") is None

    def test_license_query_chart_is_none(self, ahmet_token, ahmet_spreadsheet_id):
        r = _chat(ahmet_token, "lisansım kaç gün kaldı")
        assert r.status_code == 200, r.text
        assert r.json()["assistant_message"].get("chart") is None

    def test_weather_query_chart_is_none(self, ahmet_token, ahmet_spreadsheet_id):
        r = _chat(ahmet_token, "bugün hava nasıl")
        assert r.status_code == 200, r.text
        assert r.json()["assistant_message"].get("chart") is None


# ---- 2) Chart intent + spreadsheet → chart payload -------------------------
class TestChartGeneration:
    def _assert_chart_shape(self, chart):
        assert chart is not None, "expected chart payload, got None"
        for k in ("type", "title", "x_label", "y_label", "sheet", "filename", "data"):
            assert k in chart, f"missing key {k} in chart"
        assert chart["type"] in ("bar", "line", "pie", "area", "scatter", "column"), \
            f"unexpected type: {chart['type']}"
        assert isinstance(chart["data"], list) and len(chart["data"]) >= 1
        for pt in chart["data"]:
            assert "x" in pt and "y" in pt

    def test_bar_chart_ay_toplam(self, ahmet_token, ahmet_spreadsheet_id):
        r = _chat(ahmet_token, "Ay bazında toplam satış grafiğini göster")
        assert r.status_code == 200, r.text
        chart = r.json()["assistant_message"].get("chart")
        self._assert_chart_shape(chart)
        # Should have month names in x
        months = {str(p["x"]) for p in chart["data"]}
        # Fixture has Ocak/Şubat/Mart — at least one must be present
        assert months & {"Ocak", "Şubat", "Mart", "Nisan", "Mayıs"}, \
            f"expected Turkish month name, got x values: {months}"

    def test_pie_chart_kategori(self, ahmet_token, ahmet_spreadsheet_id):
        r = _chat(ahmet_token, "Kategori dağılımı pasta grafiği çiz")
        assert r.status_code == 200, r.text
        chart = r.json()["assistant_message"].get("chart")
        self._assert_chart_shape(chart)
        # pie is expected, but LLM may pick other type — accept if data is populated
        assert len(chart["data"]) >= 2

    def test_sutun_grafik_intent(self, ahmet_token, ahmet_spreadsheet_id):
        r = _chat(ahmet_token, "Ürün bazında adet için sütun grafik çiz")
        assert r.status_code == 200, r.text
        chart = r.json()["assistant_message"].get("chart")
        self._assert_chart_shape(chart)


# ---- 3) Chart-intent when user has NO spreadsheet → chart=None -----------
class TestNoSpreadsheetFallback:
    def test_admin_with_no_spreadsheet_chart_none(self, admin_token):
        """Admin (serkan) likely has no spreadsheet uploaded — chart intent should silently
        fall back to chart=None (not error)."""
        # Ensure no spreadsheet: check /api/files category=spreadsheet
        rf = requests.get(f"{API}/files", headers=_bearer(admin_token), timeout=20)
        assert rf.status_code == 200
        spreadsheets = [f for f in rf.json() if f.get("category") == "spreadsheet" and not f.get("is_deleted")]
        if spreadsheets:
            pytest.skip("Admin has spreadsheet files uploaded; cannot verify no-spreadsheet fallback")
        r = _chat(admin_token, "Ay bazında toplam satış grafiğini göster")
        assert r.status_code == 200, r.text
        chart = r.json()["assistant_message"].get("chart")
        assert chart is None, f"expected chart=None when no spreadsheet, got: {chart}"


# ---- 4) Persistence — chart round-trips through GET /messages -------------
class TestChartPersistence:
    def test_chart_persisted_in_history(self, ahmet_token, ahmet_spreadsheet_id):
        r = _chat(ahmet_token, "Ay bazında toplam satış bar grafiği göster")
        assert r.status_code == 200, r.text
        body = r.json()
        conv_id = body["conversation_id"]
        chart = body["assistant_message"].get("chart")
        assert chart is not None, "chart missing in initial response"
        assistant_id = body["assistant_message"]["id"]

        # Now fetch history
        r2 = requests.get(
            f"{API}/conversations/{conv_id}/messages",
            headers=_bearer(ahmet_token),
            timeout=30,
        )
        assert r2.status_code == 200, r2.text
        msgs = r2.json()
        assert isinstance(msgs, list) and len(msgs) >= 2
        assistant_msg = next((m for m in msgs if m["id"] == assistant_id), None)
        assert assistant_msg is not None, "assistant message missing from history"
        persisted = assistant_msg.get("chart")
        assert persisted is not None, "chart not persisted on assistant message"
        assert persisted["type"] == chart["type"]
        assert len(persisted["data"]) == len(chart["data"])
        assert persisted["filename"] == chart["filename"]


# ---- 5) x==y edge case (pie/category count) -------------------------------
class TestXYEdgeCase:
    def test_kategori_dagilim_no_raise(self, ahmet_token, ahmet_spreadsheet_id):
        """A pie chart on category count could produce x==y in the LLM plan; must degrade
        to count aggregation gracefully instead of raising 500 / 'cannot insert Kategori'."""
        r = _chat(ahmet_token, "Kategori bazında kategori dağılımı pasta grafiği")
        assert r.status_code == 200, r.text
        chart = r.json()["assistant_message"].get("chart")
        # Either produced a valid chart, OR silently None — both are acceptable; must NOT 500.
        if chart is not None:
            assert isinstance(chart["data"], list) and len(chart["data"]) >= 1


# ---- 6) License gate — unlicensed user gets 402 ---------------------------
class TestLicenseGate:
    def test_unlicensed_chart_request_402(self, unlicensed_user):
        r = _chat(unlicensed_user["token"], "Ay bazında toplam satış grafiği göster")
        assert r.status_code == 402, f"expected 402 NO_LICENSE, got {r.status_code}: {r.text[:300]}"
        # Common patterns: detail with "NO_LICENSE" or "license"
        try:
            detail = str(r.json().get("detail", "")).lower()
        except Exception:
            detail = r.text.lower()
        assert "license" in detail or "no_license" in detail or "lisans" in detail, \
            f"unexpected 402 detail: {detail[:200]}"


# ---- 7) RAG + memory extraction coexist with chart -------------------------
class TestRagMemoryCoexistWithChart:
    def test_chart_response_includes_sources_field(self, ahmet_token, ahmet_spreadsheet_id):
        r = _chat(ahmet_token, "Ay bazında toplam satış grafiği göster")
        assert r.status_code == 200, r.text
        body = r.json()
        # ChatResponse contract must still have sources field (may be [])
        assert "sources" in body
        assert isinstance(body["sources"], list)
        # Chart still present
        assert body["assistant_message"].get("chart") is not None

    def test_memory_extraction_still_works(self, ahmet_token, ahmet_spreadsheet_id):
        """A long user message with a personal fact + chart intent should still get through
        with chart populated. Memory extraction is background — we just verify chat returns
        200 and chart is present."""
        r = _chat(
            ahmet_token,
            "Doğum günüm 15 Temmuz. Ay bazında toplam satış grafiğini göster lütfen.",
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Chart should still generate
        assert body["assistant_message"].get("chart") is not None


# ---- 8) Direct intent regex unit test (no network) -------------------------
class TestIntentRegex:
    """Direct unit test of looks_like_chart_request. Documents that Turkish
    declensions like 'grafiği'/'grafiğini' (accusative/possessive) are NOT
    matched by the current regex — this is a bug the main agent should fix."""

    def test_intent_matches_common_forms(self):
        from chat_chart_service import looks_like_chart_request
        # Base forms that DO match today
        assert looks_like_chart_request("Kategori dağılımı pasta grafiği çiz")
        assert looks_like_chart_request("Ürün bazında adet için sütun grafik çiz")
        assert looks_like_chart_request("Bar chart olarak göster")
        assert looks_like_chart_request("Pie chart hazırla")

    def test_intent_missed_turkish_declensions_BUG(self):
        """These SHOULD match per user spec ('X bazında Y grafiğini göster')
        but currently do NOT. Documented as a bug."""
        from chat_chart_service import looks_like_chart_request
        cases = [
            "Ay bazında toplam satış grafiğini göster",
            "Ay bazında toplam satış bar grafiği göster",
            "Ay bazında toplam satış grafiği göster",
            "Kategori bazında grafiğini istiyorum",
        ]
        missed = [c for c in cases if not looks_like_chart_request(c)]
        assert missed == [], (
            f"BUG: intent regex misses these common Turkish forms: {missed}. "
            "Root cause: pattern 'grafi[ğk]\\b' requires a word-boundary after ğ/k, "
            "but 'grafiği'/'grafiğini' have word chars immediately after so no boundary matches. "
            "Fix: drop trailing \\b or extend alternatives to include declensions "
            "(e.g. 'grafi[ğk]\\w*')."
        )


# ---- 9) Regression smoke ---------------------------------------------------
class TestRegression:
    def test_health(self):
        r = requests.get(f"{API}/health", timeout=15)
        assert r.status_code == 200
