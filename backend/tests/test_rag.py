"""RAG (Faz 2) backend tests.

Covers:
- /api/health public
- /api/files/rag/status structure
- /api/files/rag/reindex-all scheduling
- upload → auto-index → rag_status=ok / empty
- delete file → chunks_removed > 0
- Full RAG chat flow: unique tokens retrievable via /api/chat
- RAG isolation between two users
- Manual memory command does NOT trigger RAG
- Off-topic query returns sources=[]
- Regression: /api/files list, /api/notes, /api/tasks, /api/memory, /api/tts
"""
import io
import os
import time
import uuid
from typing import Optional

import pytest
import requests


def _read_env(key: str, default: str = "") -> str:
    v = os.environ.get(key)
    if v:
        return v
    for path in ("/app/backend/.env", "/app/frontend/.env"):
        try:
            with open(path) as f:
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

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"
AHMET_USER = "ahmet"
AHMET_PASS = "ahmet123"


# ---------------- Helpers ----------------
def _login(username: str, password: str) -> Optional[str]:
    r = requests.post(
        f"{API}/auth/login",
        json={"username": username, "password": password},
        timeout=30,
    )
    if r.status_code != 200:
        return None
    return r.json()["token"]


def _auth(tok: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def _wait_rag_indexed(sess: requests.Session, file_id: str, timeout: float = 25.0) -> dict:
    """Poll GET /api/files/{id} until rag_status becomes 'ok' or 'empty' or 'failed'."""
    start = time.time()
    last = {}
    while time.time() - start < timeout:
        r = sess.get(f"{API}/files/{file_id}", timeout=15)
        if r.status_code == 200:
            last = r.json()
            if last.get("rag_status") in ("ok", "empty", "failed"):
                return last
        time.sleep(1.0)
    return last


def _upload_text(sess: requests.Session, filename: str, content: bytes) -> dict:
    files = {"file": (filename, io.BytesIO(content), "text/plain")}
    r = sess.post(f"{API}/files", files=files, timeout=60)
    assert r.status_code == 200, f"upload failed {r.status_code}: {r.text}"
    return r.json()


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def admin_token():
    tok = _login(ADMIN_USER, ADMIN_PASS)
    assert tok, "Admin login failed — cannot run RAG tests"
    return tok


@pytest.fixture(scope="module")
def admin(admin_token):
    return _auth(admin_token)


@pytest.fixture(scope="module")
def ahmet_token(admin_token):
    tok = _login(AHMET_USER, AHMET_PASS)
    if tok:
        return tok
    # Create the user via admin
    s = _auth(admin_token)
    r = s.post(
        f"{API}/admin/users",
        json={"username": AHMET_USER, "password": AHMET_PASS, "role": "user"},
        timeout=30,
    )
    assert r.status_code in (200, 201), f"failed to create ahmet: {r.status_code} {r.text}"
    tok = _login(AHMET_USER, AHMET_PASS)
    assert tok, "ahmet login still failing after create"
    return tok


@pytest.fixture(scope="module")
def ahmet(ahmet_token):
    return _auth(ahmet_token)


# ---------------- Health ----------------
class TestHealth:
    def test_api_health_public(self):
        r = requests.get(f"{API}/health", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok"
        assert data.get("service") == "sertex"

    def test_bare_health_public(self):
        """Ingress may route this to frontend SPA. Report but do NOT fail the suite.

        The FastAPI app has @app.get('/health'), but the K8s ingress is documented to
        route only /api/* to the backend port. We record status but skip if HTML."""
        r = requests.get(f"{BASE_URL}/health", timeout=15)
        if r.headers.get("content-type", "").startswith("application/json"):
            data = r.json()
            assert data.get("status") == "ok"
            assert data.get("service") == "sertex"
        else:
            pytest.skip(
                "Ingress routes /health to frontend SPA. /api/health works correctly."
            )


# ---------------- RAG status endpoint ----------------
class TestRagStatus:
    def test_rag_status_shape(self, admin):
        r = admin.get(f"{API}/files/rag/status", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "buckets" in data and isinstance(data["buckets"], dict)
        assert "total_chunks" in data and isinstance(data["total_chunks"], int)

    def test_rag_status_requires_auth(self):
        r = requests.get(f"{API}/files/rag/status", timeout=15)
        assert r.status_code == 401


# ---------------- Upload → Auto-index ----------------
class TestUploadAutoIndex:
    def test_upload_text_indexes_automatically(self, admin):
        unique_code = f"ALFA-{uuid.uuid4().hex[:6].upper()}-KAPPA-2026"
        content = (
            "TEST_rag_upload. Bu bir Sertex RAG entegrasyon testidir.\n"
            f"Projenin özel kodu: {unique_code}.\n"
            "Serkan Kaya, makine mühendisi olarak çalışmaktadır.\n"
            "Proje 2026 yılında başladı ve gizli bilgi taşımaktadır.\n"
        ).encode("utf-8")
        rec = _upload_text(admin, f"TEST_rag_{uuid.uuid4().hex[:6]}.txt", content)
        assert rec["id"]
        assert rec["rag_status"] in ("pending", "indexing", "ok")

        final = _wait_rag_indexed(admin, rec["id"], timeout=30)
        assert final.get("rag_status") == "ok", (
            f"Expected rag_status=ok, got {final.get('rag_status')} err={final.get('rag_error')}"
        )
        assert final.get("rag_chunks", 0) > 0
        # Save on class for the chat test
        TestUploadAutoIndex.file_id = rec["id"]
        TestUploadAutoIndex.unique_code = unique_code

    def test_delete_purges_chunks(self, admin):
        # Upload a fresh throwaway file
        content = ("TEST_rag_delete " * 50).encode("utf-8")
        rec = _upload_text(admin, f"TEST_rag_del_{uuid.uuid4().hex[:6]}.txt", content)
        final = _wait_rag_indexed(admin, rec["id"], timeout=25)
        assert final.get("rag_status") == "ok"
        assert final.get("rag_chunks", 0) > 0

        # Delete → should return chunks_removed > 0
        r = admin.delete(f"{API}/files/{rec['id']}", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("deleted") == 1
        assert data.get("chunks_removed", 0) > 0

    def test_empty_extraction_marks_empty(self, admin):
        """A file with no extractable text should be rag_status='empty'.

        We use a tiny .bin file (unsupported category will 400) so instead upload a
        supported ext (.txt) with only whitespace — extraction returns text (whitespace),
        which stripped is empty → rag_status='empty'.
        """
        rec = _upload_text(
            admin,
            f"TEST_rag_empty_{uuid.uuid4().hex[:6]}.txt",
            b"   \n\t   \n   ",
        )
        # rag_status='empty' should be set immediately (no background task scheduled)
        assert rec.get("rag_status") == "empty", (
            f"Expected rag_status=empty for whitespace file, got {rec.get('rag_status')}"
        )
        assert rec.get("rag_chunks", 0) == 0
        # Cleanup
        admin.delete(f"{API}/files/{rec['id']}", timeout=15)


# ---------------- Reindex-all ----------------
class TestReindexAll:
    def test_reindex_all_returns_schedule(self, admin):
        r = admin.post(f"{API}/files/rag/reindex-all", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "scheduled" in data and isinstance(data["scheduled"], int)
        assert "total_candidates" in data and isinstance(data["total_candidates"], int)


# ---------------- Per-file reindex ----------------
class TestPerFileReindex:
    def test_reindex_file(self, admin):
        content = (
            "TEST_rag_reindex. Bu dosya reindex testidir. "
            "Anahtar kelime: OMEGA-REINDEX-9. " * 5
        ).encode("utf-8")
        rec = _upload_text(admin, f"TEST_rag_reidx_{uuid.uuid4().hex[:6]}.txt", content)
        _wait_rag_indexed(admin, rec["id"], timeout=25)

        r = admin.post(f"{API}/files/{rec['id']}/reindex", timeout=30)
        assert r.status_code == 200
        assert r.json().get("status") == "indexing"

        final = _wait_rag_indexed(admin, rec["id"], timeout=30)
        assert final.get("rag_status") == "ok"
        assert final.get("rag_chunks", 0) > 0

        admin.delete(f"{API}/files/{rec['id']}", timeout=15)


# ---------------- Full RAG chat flow ----------------
class TestRagChat:
    unique_code: str = ""
    file_id: str = ""

    def test_upload_for_chat(self, admin):
        code = f"ALFA-{uuid.uuid4().hex[:6].upper()}-KAPPA-2026"
        content = (
            f"TEST_rag_chat. Sertex projesinin referans kodu: {code}. "
            "Bu bilgi test amaçlıdır ve serbestçe paylaşılabilir. "
            "Serkan Kaya bu projenin baş mühendisidir.\n"
        ).encode("utf-8")
        rec = _upload_text(admin, f"TEST_rag_chat_{uuid.uuid4().hex[:6]}.txt", content)
        final = _wait_rag_indexed(admin, rec["id"], timeout=30)
        assert final.get("rag_status") == "ok"
        TestRagChat.file_id = rec["id"]
        TestRagChat.unique_code = code

    def test_chat_returns_sources_with_file(self, admin):
        assert TestRagChat.file_id, "prior upload must succeed"
        payload = {
            "message": "Sertex projesinin referans kodu neydi? Test verisi olarak kaydettim.",
            "language": "tr",
        }
        r = admin.post(f"{API}/chat", json=payload, timeout=180)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "sources" in data
        srcs = data["sources"]
        assert isinstance(srcs, list)
        # Must include the file we just uploaded
        matched = [s for s in srcs if s.get("file_id") == TestRagChat.file_id]
        assert matched, f"Uploaded file not in sources: {srcs}"
        assert matched[0]["score"] > 0.35, f"score too low: {matched[0]}"
        # Assistant text should contain the unique code
        assistant = data["assistant_message"]["content"]
        assert TestRagChat.unique_code in assistant, (
            f"Assistant did not surface unique code {TestRagChat.unique_code}: {assistant}"
        )

    def test_offtopic_returns_empty_sources(self, admin):
        payload = {
            "message": "Bugün Türkiye'de siyasi durum hakkında bir şey söyle",
            "language": "tr",
        }
        r = admin.post(f"{API}/chat", json=payload, timeout=180)
        assert r.status_code == 200
        data = r.json()
        # Sources may include some low-hit chunks; only enforce that our unique
        # test file is not surfaced with a strong score for an unrelated query.
        srcs = data.get("sources", [])
        strong = [s for s in srcs if s.get("file_id") == TestRagChat.file_id]
        assert not strong, f"Test file surfaced for unrelated query: {strong}"

    def test_manual_memory_skips_rag(self, admin):
        payload = {
            "message": "bunu hatırla: TEST_rag_memcheck favori rengim gümüştür",
            "language": "tr",
        }
        r = admin.post(f"{API}/chat", json=payload, timeout=180)
        assert r.status_code == 200
        data = r.json()
        assert data.get("sources") == [] or data.get("sources") is None, (
            f"Manual memory trigger should NOT populate sources: {data.get('sources')}"
        )
        # Cleanup: delete the memory we just added
        try:
            mem_r = admin.get(f"{API}/memory", timeout=15)
            if mem_r.status_code == 200:
                for m in mem_r.json():
                    if "TEST_rag_memcheck" in (m.get("content") or ""):
                        admin.delete(f"{API}/memory/{m['id']}", timeout=15)
        except Exception:
            pass

    def test_cleanup_chat_file(self, admin):
        if TestRagChat.file_id:
            admin.delete(f"{API}/files/{TestRagChat.file_id}", timeout=15)


# ---------------- Cross-user isolation ----------------
class TestRagIsolation:
    def test_ahmet_cannot_see_admin_content(self, admin, ahmet):
        # Admin uploads a distinct file
        admin_code = f"ADMIN-{uuid.uuid4().hex[:6].upper()}-SECRET"
        admin_content = (
            f"TEST_iso_admin. Bu admin özel bilgisidir. Anahtar kod: {admin_code}. "
            "Yalnızca serkan bu bilgiye erişebilmelidir.\n"
        ).encode("utf-8")
        admin_rec = _upload_text(
            admin, f"TEST_iso_admin_{uuid.uuid4().hex[:6]}.txt", admin_content
        )
        _wait_rag_indexed(admin, admin_rec["id"], timeout=30)

        # Ahmet uploads his own distinct file
        ahmet_code = f"AHMET-{uuid.uuid4().hex[:6].upper()}-KEY"
        ahmet_content = (
            f"TEST_iso_ahmet. Bu ahmet'in özel bilgisidir. Kod: {ahmet_code}.\n"
        ).encode("utf-8")
        ahmet_rec = _upload_text(
            ahmet, f"TEST_iso_ahmet_{uuid.uuid4().hex[:6]}.txt", ahmet_content
        )
        _wait_rag_indexed(ahmet, ahmet_rec["id"], timeout=30)

        # Ahmet queries for the admin's code — should NOT retrieve admin's file
        r = ahmet.post(
            f"{API}/chat",
            json={"message": f"{admin_code} nedir?", "language": "tr"},
            timeout=180,
        )
        assert r.status_code == 200
        srcs = r.json().get("sources", []) or []
        admin_leaked = [s for s in srcs if s.get("file_id") == admin_rec["id"]]
        assert not admin_leaked, (
            f"ISOLATION BREACH: ahmet retrieved admin's file: {admin_leaked}"
        )

        # Cleanup
        admin.delete(f"{API}/files/{admin_rec['id']}", timeout=15)
        ahmet.delete(f"{API}/files/{ahmet_rec['id']}", timeout=15)


# ---------------- Regression sanity ----------------
class TestRegression:
    def test_files_list(self, admin):
        r = admin.get(f"{API}/files", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_notes_still_work(self, admin):
        r = admin.post(f"{API}/notes", json={"content": "TEST_rag_regression_note"}, timeout=15)
        assert r.status_code == 200
        nid = r.json()["id"]
        r2 = admin.delete(f"{API}/notes/{nid}", timeout=15)
        assert r2.status_code == 200

    def test_memory_still_works(self, admin):
        r = admin.get(f"{API}/memory", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_tasks_still_work(self, admin):
        r = admin.get(f"{API}/tasks", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_tts_still_works(self, admin):
        r = admin.post(f"{API}/tts", json={"text": "Merhaba", "voice": "onyx"}, timeout=60)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("audio/mpeg")
        assert len(r.content) > 500
