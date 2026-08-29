#!/usr/bin/env python3
"""Seed an archived task to reproduce bug122 archive-search-vs-category filter.

Creates two tasks with distinct titles, assigns each to a different category if
available, archives one, prints ids + names so the Playwright script can pick them up.
"""
import os, sys, json, time, requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "https://functional-themes.preview.emergentagent.com"
LOGIN = f"{BASE}/api/auth/login"

def main():
    r = requests.post(LOGIN, json={"username": "serkan", "password": "19071987"}, timeout=15)
    r.raise_for_status()
    token = r.json()["token"]
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Fetch categories
    cats = requests.get(f"{BASE}/api/task-categories", headers=h, timeout=15).json()
    # Normalize to a list
    if isinstance(cats, dict):
        cats = cats.get("categories") or cats.get("items") or []
    print("CATEGORIES:", [(c.get("id"), c.get("name")) for c in cats][:10])

    # Pick two different top-level categories if possible
    top = [c for c in cats if not c.get("parent_id")]
    if len(top) < 2:
        print("Not enough top-level categories, using first two of any.")
        top = cats[:2]
    cat_a = top[0] if top else None
    cat_b = top[1] if len(top) > 1 else None
    print("cat_a:", cat_a and cat_a.get("name"), "cat_b:", cat_b and cat_b.get("name"))

    ts = int(time.time())
    archived_title = f"TESTARCH_BUG122_{ts}"
    # Create the archived task in cat_a
    body = {"title": archived_title, "description": "seeded for bug122 verification"}
    if cat_a:
        body["category_id"] = cat_a["id"]
    r = requests.post(f"{BASE}/api/tasks", headers=h, json=body, timeout=15)
    r.raise_for_status()
    task = r.json()
    tid = task["id"]
    print("Created task:", tid, task.get("title"))

    # Archive it
    r = requests.patch(f"{BASE}/api/tasks/{tid}", headers=h, json={"archived": True}, timeout=15)
    r.raise_for_status()
    print("Archived:", r.json().get("archived"))

    out = {
        "task_id": tid,
        "task_title": archived_title,
        "task_category_id": cat_a and cat_a.get("id"),
        "task_category_name": cat_a and cat_a.get("name"),
        "other_category_id": cat_b and cat_b.get("id"),
        "other_category_name": cat_b and cat_b.get("name"),
    }
    with open("/app/test_reports/seed_archive_bug.json", "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(json.dumps(out, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
