"""Faz 9 CP4.18 — verify per-user SSE connection cap.

Opens 6 concurrent SSE streams for the same admin. The pubsub cap is 5,
so the 6th subscription must evict the oldest stream. The oldest stream
should receive an `event: closed` frame before its socket ends, while
streams 2..6 stay alive.
"""
import os
import sys
import time
import threading
import requests

API_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"

if not API_URL.startswith("http"):
    print("FAIL: REACT_APP_BACKEND_URL not set")
    sys.exit(2)

r = requests.post(f"{API_URL}/auth/login",
                  json={"username": "serkan", "password": "19071987"},
                  timeout=10)
r.raise_for_status()
tok = r.json()["token"]

# Slot state — one entry per stream
slots = []  # list of dicts: {idx, events, closed_reason, terminated}


def reader(idx: int):
    st = {"idx": idx, "events": [], "closed_reason": None, "terminated": False}
    slots.append(st)
    try:
        with requests.get(f"{API_URL}/notifications/stream",
                          params={"token": tok},
                          stream=True, timeout=20) as resp:
            if resp.status_code != 200:
                st["closed_reason"] = f"http_{resp.status_code}"
                return
            cur_event = None
            for line in resp.iter_lines(decode_unicode=True):
                if line is None:
                    continue
                s = line.strip()
                if s.startswith("event:"):
                    cur_event = s.split(":", 1)[1].strip()
                elif s.startswith("data:"):
                    st["events"].append({"event": cur_event, "data": s.split(":", 1)[1].strip()})
                    if cur_event == "closed":
                        st["closed_reason"] = "evicted"
                        return
    except Exception as e:
        st["closed_reason"] = f"exc:{type(e).__name__}"
    finally:
        st["terminated"] = True


# Open streams 1..5 with 250ms spacing
threads = []
for i in range(1, 7):
    t = threading.Thread(target=reader, args=(i,), daemon=True)
    t.start()
    threads.append(t)
    time.sleep(0.35)

# Wait 2s for eviction to propagate
time.sleep(2.0)

# Report state
open_now = [s for s in slots if not s["terminated"]]
evicted = [s for s in slots if s["closed_reason"] == "evicted"]
print(f"streams opened : 6")
print(f"still open now : {len(open_now)} (idxs={sorted(s['idx'] for s in open_now)})")
print(f"evicted (idxs) : {sorted(s['idx'] for s in evicted)}")

# Success criteria: exactly stream #1 evicted, streams #2..6 still open
if len(evicted) == 1 and evicted[0]["idx"] == 1:
    print("OK — oldest stream (idx=1) evicted, 5 newest still open")
    sys.exit(0)

print("FAIL — cap enforcement did not behave as expected")
for s in slots:
    print(f"  idx={s['idx']} terminated={s['terminated']} reason={s['closed_reason']} events={len(s['events'])}")
sys.exit(1)
