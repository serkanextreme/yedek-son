"""Backend tests for Sertex File Processing Engine (Faz 1).

Covers: upload (txt/pdf/csv/png), list, get, summarize (+cache), ask, delete,
size limit, unsupported extension, and multi-tenant isolation.
"""
import io
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"


# ---------- Fixtures ---------------------------------------------------

@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def second_user(admin_headers):
    """Create (or reuse) a second user; return {token, username, id}."""
    uname = f"testuser_{uuid.uuid4().hex[:6]}"
    pwd = "TestPass123!"
    r = requests.post(
        f"{API}/admin/users",
        headers=admin_headers,
        json={"username": uname, "password": pwd, "role": "user"},
        timeout=15,
    )
    assert r.status_code == 200, f"create user failed: {r.status_code} {r.text}"
    uid = r.json()["id"]
    lr = requests.post(f"{API}/auth/login", json={"username": uname, "password": pwd}, timeout=15)
    assert lr.status_code == 200
    yield {"token": lr.json()["token"], "username": uname, "id": uid}
    # Teardown - delete user
    try:
        requests.delete(f"{API}/admin/users/{uid}", headers=admin_headers, timeout=10)
    except Exception:
        pass


# ---------- Helpers ----------------------------------------------------

def _make_pdf(text="Hello Sertex PDF test. Bu bir Türkçe içerik testidir."):
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(100, 750, text)
    c.drawString(100, 720, "Line 2: Numbers 1234 and total 500 TL.")
    c.save()
    return buf.getvalue()


def _make_png():
    from PIL import Image
    img = Image.new("RGB", (64, 64), color=(20, 200, 250))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _upload(headers, filename, data, content_type):
    files = {"file": (filename, data, content_type)}
    return requests.post(f"{API}/files", headers=headers, files=files, timeout=180)


# ---------- Tests: uploads --------------------------------------------

@pytest.fixture(scope="session")
def uploaded_txt(admin_headers):
    content = "Sertex faz 1 dosya testi.\nKullanıcı Serkan.\nToplam tutar: 500 TL."
    r = _upload(admin_headers, "TEST_notes.txt", content.encode("utf-8"), "text/plain")
    assert r.status_code == 200, f"txt upload failed: {r.status_code} {r.text}"
    d = r.json()
    assert d["extraction_status"] == "ok"
    assert d["category"] == "document"
    assert d["extracted_chars"] > 0
    return d


@pytest.fixture(scope="session")
def uploaded_pdf(admin_headers):
    data = _make_pdf()
    r = _upload(admin_headers, "TEST_doc.pdf", data, "application/pdf")
    assert r.status_code == 200, f"pdf upload failed: {r.status_code} {r.text}"
    d = r.json()
    assert d["extraction_status"] in ("ok", "partial")
    assert d["category"] == "document"
    return d


@pytest.fixture(scope="session")
def uploaded_csv(admin_headers):
    csv_bytes = b"name,amount\nAlice,100\nBob,200\nToplam,300\n"
    r = _upload(admin_headers, "TEST_data.csv", csv_bytes, "text/csv")
    assert r.status_code == 200, f"csv upload failed: {r.status_code} {r.text}"
    d = r.json()
    assert d["extraction_status"] == "ok"
    assert d["category"] == "spreadsheet"
    return d


@pytest.fixture(scope="session")
def uploaded_png(admin_headers):
    data = _make_png()
    r = _upload(admin_headers, "TEST_image.png", data, "image/png")
    assert r.status_code == 200, f"png upload failed: {r.status_code} {r.text}"
    d = r.json()
    # Image goes through GPT vision — may take a few sec
    assert d["category"] == "image"
    # Vision-generated text is required (status ok/partial) OR failed (LLM err) — flag if failed
    if d["extraction_status"] == "failed":
        pytest.fail(f"Image vision extraction failed: {d.get('extraction_error')}")
    assert d["extracted_chars"] > 0, "Vision returned empty text"
    return d


class TestUploads:
    def test_txt_uploaded(self, uploaded_txt):
        assert uploaded_txt["original_filename"] == "TEST_notes.txt"

    def test_pdf_uploaded(self, uploaded_pdf):
        assert uploaded_pdf["extension"] == "pdf"

    def test_csv_uploaded(self, uploaded_csv):
        assert uploaded_csv["extension"] == "csv"

    def test_png_uploaded_via_vision(self, uploaded_png):
        assert uploaded_png["extension"] == "png"
        assert uploaded_png["extracted_status"] if False else True  # placeholder
        assert uploaded_png["extraction_status"] in ("ok", "partial")


# ---------- Tests: listing and get ------------------------------------

class TestListAndGet:
    def test_list_scoped_and_strips_text(self, admin_headers, uploaded_txt):
        r = requests.get(f"{API}/files", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list)
        ids = {d["id"] for d in docs}
        assert uploaded_txt["id"] in ids
        # extracted_text must be stripped in list view
        for d in docs:
            assert d.get("extracted_text", "") == ""

    def test_get_single_returns_full_text(self, admin_headers, uploaded_txt):
        r = requests.get(f"{API}/files/{uploaded_txt['id']}", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == uploaded_txt["id"]
        assert "500 TL" in d["extracted_text"]


# ---------- Tests: summarize & ask ------------------------------------

class TestSummarize:
    def test_summarize_txt_and_cache(self, admin_headers, uploaded_txt):
        r1 = requests.post(f"{API}/files/{uploaded_txt['id']}/summarize", headers=admin_headers, timeout=90)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["cached"] is False
        assert len(d1["summary"]) > 20
        # Second call should be cached
        r2 = requests.post(f"{API}/files/{uploaded_txt['id']}/summarize", headers=admin_headers, timeout=30)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["cached"] is True
        assert d2["summary"] == d1["summary"]


class TestAsk:
    def test_ask_grounded(self, admin_headers, uploaded_txt):
        r = requests.post(
            f"{API}/files/{uploaded_txt['id']}/ask",
            headers=admin_headers,
            json={"question": "Toplam tutar nedir?"},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "answer" in d
        assert "500" in d["answer"]  # grounded on content

    def test_ask_short_question_400(self, admin_headers, uploaded_txt):
        r = requests.post(
            f"{API}/files/{uploaded_txt['id']}/ask",
            headers=admin_headers,
            json={"question": "a"},
            timeout=15,
        )
        assert r.status_code == 400


# ---------- Tests: validation errors ----------------------------------

class TestValidation:
    def test_unsupported_extension_returns_400(self, admin_headers):
        r = _upload(admin_headers, "TEST_bad.exe", b"MZ\x90\x00binary payload", "application/octet-stream")
        assert r.status_code == 400
        assert "desteklen" in r.text.lower() or "desteklenmiyor" in r.text.lower()

    def test_over_size_limit_returns_400(self, admin_headers):
        # 51MB dummy txt (repeat 'A')
        big = b"A" * (51 * 1024 * 1024)
        r = _upload(admin_headers, "TEST_big.txt", big, "text/plain")
        assert r.status_code == 400
        assert "büyük" in r.text.lower() or "50" in r.text

    def test_empty_file_returns_400(self, admin_headers):
        r = _upload(admin_headers, "TEST_empty.txt", b"", "text/plain")
        assert r.status_code == 400

    def test_unauthenticated_denied(self):
        r = requests.get(f"{API}/files", timeout=15)
        assert r.status_code in (401, 403)


# ---------- Tests: multi-tenant isolation -----------------------------

class TestIsolation:
    def test_user2_cannot_see_user1_files(self, second_user, uploaded_txt):
        h2 = {"Authorization": f"Bearer {second_user['token']}"}
        # user2 GET should not see user1's file
        r_list = requests.get(f"{API}/files", headers=h2, timeout=15)
        assert r_list.status_code == 200
        ids = {d["id"] for d in r_list.json()}
        assert uploaded_txt["id"] not in ids
        # direct GET should be 404
        r_get = requests.get(f"{API}/files/{uploaded_txt['id']}", headers=h2, timeout=15)
        assert r_get.status_code == 404
        # summarize / ask / delete should also 404
        rs = requests.post(f"{API}/files/{uploaded_txt['id']}/summarize", headers=h2, timeout=15)
        assert rs.status_code == 404
        ra = requests.post(
            f"{API}/files/{uploaded_txt['id']}/ask",
            headers=h2,
            json={"question": "test question?"},
            timeout=15,
        )
        assert ra.status_code == 404
        rd = requests.delete(f"{API}/files/{uploaded_txt['id']}", headers=h2, timeout=15)
        assert rd.status_code == 404

    def test_user2_can_upload_own_file(self, second_user):
        h2 = {"Authorization": f"Bearer {second_user['token']}"}
        r = _upload(h2, "TEST_user2.txt", b"user2 personal file", "text/plain")
        assert r.status_code == 200
        assert r.json()["user_id"] == second_user["id"]


# ---------- Tests: delete (run last) ----------------------------------

class TestDelete:
    def test_delete_and_404_thereafter(self, admin_headers, uploaded_csv):
        r = requests.delete(f"{API}/files/{uploaded_csv['id']}", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/files/{uploaded_csv['id']}", headers=admin_headers, timeout=15)
        assert r2.status_code == 404


# ---------- Regression: existing endpoints still work -----------------

class TestRegression:
    def test_chat_still_works(self, admin_headers):
        r = requests.post(f"{API}/chat", headers=admin_headers, json={"message": "selam", "language": "tr"}, timeout=45)
        assert r.status_code == 200
        d = r.json()
        assert "assistant_message" in d
        assert len(d["assistant_message"]["content"]) > 0

    def test_memory_list_works(self, admin_headers):
        r = requests.get(f"{API}/memory", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_tasks_list_works(self, admin_headers):
        r = requests.get(f"{API}/tasks", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_notes_list_works(self, admin_headers):
        r = requests.get(f"{API}/notes", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_auth_me_works(self, admin_headers):
        r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["username"] == ADMIN_USER
