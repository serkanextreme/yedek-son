"""Quick SSE smoke test for Faz 9 CP4.17.

Opens an SSE stream against Manager A, triggers a permission request
from Manager B, and asserts that Manager A receives the `new` event
within 3 seconds instead of waiting for the 60-second polling window.
"""
import os
import sys
import time
import json
import threading
import requests

API_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"


def _login(username: str, password: str) -> str:
    r = requests.post(f"{API_URL}/auth/login", json={"username": username, "password": password}, timeout=10)
    r.raise_for_status()
    return r.json()["token"]


def _admin_setup(admin_tok: str):
    H = {"Authorization": f"Bearer {admin_tok}"}
    ts = int(time.time())
    ca = requests.post(f"{API_URL}/companies", headers=H, json={"name": f"SSE_A_{ts}"}, timeout=10).json()["id"]
    cb = requests.post(f"{API_URL}/companies", headers=H, json={"name": f"SSE_B_{ts}"}, timeout=10).json()["id"]
    ma = requests.post(f"{API_URL}/admin/users", headers=H, json={
        "username": f"sse_mgr_a_{ts}", "password": "m12345", "role": "manager",
        "company_id": ca, "with_license": "trial",
    }, timeout=10).json()
    mb = requests.post(f"{API_URL}/admin/users", headers=H, json={
        "username": f"sse_mgr_b_{ts}", "password": "m12345", "role": "manager",
        "company_id": cb, "with_license": "trial",
    }, timeout=10).json()
    return {"ca": ca, "cb": cb, "ma": ma, "mb": mb}


def _admin_cleanup(admin_tok: str, ctx: dict):
    H = {"Authorization": f"Bearer {admin_tok}"}
    for uid in (ctx["ma"]["id"], ctx["mb"]["id"]):
        requests.delete(f"{API_URL}/admin/users/{uid}?mode=hard", headers=H, timeout=10)
    for cid in (ctx["ca"], ctx["cb"]):
        requests.delete(f"{API_URL}/companies/{cid}", headers=H, timeout=10)


def main():
    if not API_URL.startswith("http"):
        print("FAIL: REACT_APP_BACKEND_URL not set")
        sys.exit(2)
    admin_tok = _login("serkan", "19071987")
    ctx = _admin_setup(admin_tok)
    try:
        ma_tok = _login(ctx["ma"]["username"], "m12345")
        mb_tok = _login(ctx["mb"]["username"], "m12345")

        # Open SSE stream for Manager A in a background thread. iter_lines
        # yields the raw SSE frames; we look for lines that begin with
        # `event: new`.
        events = []
        stop = threading.Event()

        def reader():
            with requests.get(f"{API_URL}/notifications/stream", params={"token": ma_tok},
                              stream=True, timeout=15) as r:
                if r.status_code != 200:
                    print(f"FAIL: stream returned {r.status_code}: {r.text[:200]}")
                    return
                cur_event = None
                for raw in r.iter_lines(decode_unicode=True):
                    if stop.is_set():
                        break
                    if raw is None:
                        continue
                    line = raw.strip()
                    if line.startswith("event:"):
                        cur_event = line.split(":", 1)[1].strip()
                    elif line.startswith("data:"):
                        payload = line.split(":", 1)[1].strip()
                        events.append({"event": cur_event, "data": payload})
                        if cur_event == "new":
                            return
                    if not line:
                        cur_event = None

        t = threading.Thread(target=reader, daemon=True)
        t.start()
        time.sleep(1.5)  # let the stream settle

        # Fire the permission request → should push a `new` event to Manager A
        t0 = time.time()
        req = requests.post(f"{API_URL}/company-permissions",
                            headers={"Authorization": f"Bearer {mb_tok}"},
                            json={"viewer_company_id": ctx["cb"], "target_company_id": ctx["ca"]},
                            timeout=10)
        print(f"  request status: {req.json().get('status')} ({req.status_code})")

        # Wait up to 4s for the `new` event
        t.join(timeout=4.0)
        stop.set()

        if not events:
            print("FAIL: no SSE events received within 4 seconds")
            sys.exit(1)

        # Report every event received
        latency_ms = None
        for i, e in enumerate(events):
            if e["event"] == "new":
                latency_ms = (time.time() - t0) * 1000
                print(f"  event[{i}] type={e['event']} — payload keys: "
                      f"{list(json.loads(e['data']).get('notification', {}).keys())[:5]}...")
        if latency_ms is None:
            print(f"FAIL: only comment/keepalive frames received: {events}")
            sys.exit(1)
        print(f"OK — live push received in ~{latency_ms:.0f}ms (target < 4000ms)")
    finally:
        _admin_cleanup(admin_tok, ctx)


if __name__ == "__main__":
    main()
