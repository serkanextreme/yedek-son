#!/usr/bin/env python3
"""Cleanup UI seed tasks created during reorder bug verification."""
import json
import os
import pathlib
import requests


def read_backend_url():
    with open("/app/frontend/.env", "r", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.strip().split("=", 1)[1].rstrip("/")
    return "http://localhost:8001"


API = f"{os.environ.get('REACT_APP_BACKEND_URL', read_backend_url()).rstrip('/')}/api"


def main():
    r = requests.post(f"{API}/auth/login", json={"username": "serkan", "password": "19071987"}, timeout=30)
    r.raise_for_status()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    ids = []
    for path in ["/app/test_reports/reorder_bug_ui_seed.json", "/app/test_reports/reorder_bug_ui_seed2.json"]:
        p = pathlib.Path(path)
        if not p.exists():
            continue
        data = json.loads(p.read_text(encoding="utf-8"))
        ids.extend(t["id"] for t in data.get("tasks", []))
    results = []
    for tid in ids:
        resp = s.delete(f"{API}/tasks/{tid}", timeout=20)
        results.append({"id": tid, "status_code": resp.status_code, "body": resp.text[:200]})
    print(json.dumps({"deleted_attempts": results}, indent=2))


if __name__ == "__main__":
    main()