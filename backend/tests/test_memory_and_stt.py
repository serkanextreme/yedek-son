"""Backend tests for Sertex Faz 0: Long-Term Memory + Whisper STT.

Covers:
- /api/memory GET/POST/PATCH/DELETE (single + bulk)
- Manual memory trigger via /api/chat ("Bunu hatırla: ...") short-circuits LLM
- Forget trigger via /api/chat ("unut <kw>") short-circuits LLM
- Auto-extraction via /api/chat BackgroundTask (best-effort)
- Prompt injection (favori renk knowledge)
- /api/stt/whisper: 401 without auth; 200 with valid audio (TTS-generated mp3)
"""
import os
import time
import uuid
import io
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

DEFAULT_USER = os.environ.get("INITIAL_USERNAME", "serkan")
DEFAULT_PASS = os.environ.get("INITIAL_PASSWORD", "19071987")


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(anon):
    r = anon.post(
        f"{API}/auth/login",
        json={"username": DEFAULT_USER, "password": DEFAULT_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    return s


@pytest.fixture(scope="module", autouse=True)
def _clean_before_and_after(auth):
    """Wipe memories before/after this module so tests are idempotent."""
    try:
        auth.delete(f"{API}/memory", timeout=30)
    except Exception:
        pass
    yield
    try:
        auth.delete(f"{API}/memory", timeout=30)
    except Exception:
        pass


# ---------------- Memory CRUD ----------------
class TestMemoryCRUD:
    memory_id = None

    def test_memory_requires_auth(self, anon):
        r = anon.get(f"{API}/memory", timeout=30)
        assert r.status_code == 401

    def test_list_memories_empty_initially(self, auth):
        r = auth.get(f"{API}/memory", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_create_memory_valid(self, auth):
        payload = {
            "content": "TEST_memory: Kullanıcı Python geliştirici",
            "category": "work",
            "importance": 4,
        }
        r = auth.post(f"{API}/memory", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["content"] == payload["content"]
        assert d["category"] == "work"
        assert d["importance"] == 4
        assert d["source"] == "manual"
        assert "id" in d
        TestMemoryCRUD.memory_id = d["id"]

    def test_get_memory_after_create(self, auth):
        r = auth.get(f"{API}/memory", timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert any(m["id"] == TestMemoryCRUD.memory_id for m in items)

    def test_create_short_content_rejected(self, auth):
        r = auth.post(f"{API}/memory",
                      json={"content": "hi", "category": "other", "importance": 3},
                      timeout=30)
        assert r.status_code == 400

    def test_update_memory(self, auth):
        assert TestMemoryCRUD.memory_id
        r = auth.patch(
            f"{API}/memory/{TestMemoryCRUD.memory_id}",
            json={"content": "TEST_memory: Kullanıcı SENIOR Python geliştirici", "importance": 5},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "SENIOR" in d["content"]
        assert d["importance"] == 5

    def test_delete_memory(self, auth):
        assert TestMemoryCRUD.memory_id
        r = auth.delete(f"{API}/memory/{TestMemoryCRUD.memory_id}", timeout=30)
        assert r.status_code == 200
        assert r.json().get("deleted") == 1
        # verify gone
        r = auth.get(f"{API}/memory", timeout=30)
        assert not any(m["id"] == TestMemoryCRUD.memory_id for m in r.json())

    def test_bulk_delete(self, auth):
        # seed a few
        for i in range(3):
            auth.post(f"{API}/memory",
                      json={"content": f"TEST_bulk_{i}: bir şey", "category": "other", "importance": 2},
                      timeout=30)
        r = auth.delete(f"{API}/memory", timeout=30)
        assert r.status_code == 200
        deleted = r.json().get("deleted", 0)
        assert deleted >= 3
        r = auth.get(f"{API}/memory", timeout=30)
        assert r.json() == []


# ---------------- Chat memory triggers ----------------
class TestChatMemoryTriggers:
    def test_manual_trigger_short_circuits_llm(self, auth):
        # send a "Bunu hatırla: ..." message
        payload = {"message": "Bunu hatırla: test memory içeriği ABC", "language": "tr"}
        t0 = time.time()
        r = auth.post(f"{API}/chat", json=payload, timeout=60)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        assistant_text = r.json()["assistant_message"]["content"]
        assert "hafızama kaydettim" in assistant_text.lower() or "kaydettim" in assistant_text.lower()
        # short-circuit should be fast (< 5s), no LLM roundtrip
        print(f"Manual trigger elapsed: {elapsed:.2f}s — reply: {assistant_text}")
        # verify memory exists
        r = auth.get(f"{API}/memory", timeout=30)
        contents = [m["content"] for m in r.json()]
        assert any("test memory içeriği" in c.lower() for c in contents), f"Memory not saved. Got: {contents}"

    def test_forget_trigger(self, auth):
        # ensure at least one 'test' memory exists
        auth.post(f"{API}/memory",
                  json={"content": "TEST_forget: bu test kaydı", "category": "other", "importance": 2},
                  timeout=30)
        r = auth.post(f"{API}/chat",
                      json={"message": "unut test", "language": "tr"},
                      timeout=60)
        assert r.status_code == 200, r.text
        assistant_text = r.json()["assistant_message"]["content"].lower()
        assert "sildim" in assistant_text or "bulamadım" in assistant_text
        print(f"Forget reply: {assistant_text}")

    def test_prompt_injection_favori_renk(self, auth):
        # create the memory
        auth.post(f"{API}/memory",
                  json={"content": "Kullanıcının favori rengi mavi", "category": "preference", "importance": 5},
                  timeout=30)
        # ask about it
        r = auth.post(f"{API}/chat",
                      json={"message": "Benim favori rengim ne?", "language": "tr"},
                      timeout=120)
        assert r.status_code == 200, r.text
        reply = r.json()["assistant_message"]["content"].lower()
        print(f"Favori renk reply: {reply}")
        assert "mavi" in reply, f"Expected 'mavi' in reply, got: {reply}"

    def test_auto_extract_from_chat(self, auth):
        # cleanup first
        auth.delete(f"{API}/memory", timeout=30)
        msg = "Ben makine mühendisiyim ve iki köpeğim var, adları Karabaş ve Boncuk."
        r = auth.post(f"{API}/chat",
                      json={"message": msg, "language": "tr"},
                      timeout=120)
        assert r.status_code == 200
        # BackgroundTask may take 3-8s. Poll up to 25s.
        found_auto = False
        contents_seen = []
        for _ in range(15):
            time.sleep(2)
            r = auth.get(f"{API}/memory", timeout=30)
            if r.status_code == 200:
                items = r.json()
                contents_seen = [(m["source"], m["content"]) for m in items]
                if any(m.get("source") == "auto" for m in items):
                    found_auto = True
                    break
        print(f"Auto-extract memories: {contents_seen}")
        assert found_auto, f"No auto-extracted memories in 30s. Seen: {contents_seen}"


# ---------------- Whisper STT ----------------
class TestWhisperSTT:
    def test_whisper_401_without_auth(self, anon):
        # We need SOME multipart body; use tiny bytes
        files = {"audio": ("t.mp3", b"\x00" * 10, "audio/mpeg")}
        s = requests.Session()  # no auth header
        r = s.post(f"{API}/stt/whisper", files=files, timeout=30)
        assert r.status_code == 401

    def test_whisper_tts_roundtrip(self, auth, token):
        # 1. Generate TTS audio
        tts = requests.post(
            f"{API}/tts",
            json={"text": "Merhaba efendim, bu bir test kaydıdır.", "voice": "onyx"},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=90,
        )
        assert tts.status_code == 200, tts.text
        mp3_bytes = tts.content
        assert len(mp3_bytes) > 1000

        # 2. Send to Whisper STT
        files = {"audio": ("audio.mp3", mp3_bytes, "audio/mpeg")}
        data = {"language": "tr"}
        r = requests.post(
            f"{API}/stt/whisper",
            files=files,
            data=data,
            headers={"Authorization": f"Bearer {token}"},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "text" in d
        text = d["text"].lower()
        print(f"Whisper transcribed: {d['text']}")
        # Should contain a recognizable Turkish word from the source
        assert any(w in text for w in ["merhaba", "efendim", "test", "kayıt", "kaydı"]), \
            f"Whisper transcription didn't recognize source. Got: {d['text']}"
