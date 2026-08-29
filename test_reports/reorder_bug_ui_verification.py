#!/usr/bin/env python3
"""Seed UI data for task reorder bug verification.

Creates three Ahmet-assigned tasks with a unique prefix and initial order, then
prints JSON for Playwright automation to drag one task and verify persistence.
"""
import json
import os
import time
import uuid

import requests


def read_backend_url():
    with open("/app/frontend/.env", "r", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.strip().split("=", 1)[1].rstrip("/")
    return "http://localhost:8001"


API = f"{os.environ.get('REACT_APP_BACKEND_URL', read_backend_url()).rstrip('/')}/api"


def login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    r.raise_for_status()
    data = r.json()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"})
    return s, data["user"]


def create(sess, title, assignee_id):
    r = sess.post(f"{API}/tasks", json={"title": title, "assignee_user_id": assignee_id, "assignee_name": "ahmet"}, timeout=30)
    r.raise_for_status()
    return r.json()


def main():
    admin, _ = login("serkan", "19071987")
    _, ahmet = login("ahmet", "ahmet123")
    prefix = f"UI_REORDER_{int(time.time())}_{uuid.uuid4().hex[:5]}"
    tasks = [create(admin, f"{prefix}_{label}", ahmet["id"]) for label in ["A", "B", "C"]]
    # Put them at the very top in known A,B,C order for deterministic UI drag.
    # /tasks/reorder assigns sort_order based on the full payload length, so
    # include existing rows after our seeded rows to outrank any prior data.
    current = admin.get(f"{API}/tasks", timeout=30)
    current.raise_for_status()
    current_ids = [row["id"] for row in current.json() if row.get("id") not in {t["id"] for t in tasks}]
    r = admin.post(f"{API}/tasks/reorder", json={"ids": [t["id"] for t in tasks] + current_ids}, timeout=30)
    r.raise_for_status()
    print(json.dumps({"api": API, "prefix": prefix, "tasks": tasks}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()