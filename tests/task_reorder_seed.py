import json
import os
from datetime import datetime, timedelta, timezone

import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE = os.environ.get("SERTEX_BASE_URL", "https://functional-themes.preview.emergentagent.com")
PREFIX = "QA_REORDER_"
CAT_NAME = "QA_REORDER_CAT_A"
OUT = "/app/tests/task_reorder_seed_output.json"


def h(token):
    return {"Authorization": f"Bearer {token}"}


def main():
    env = dotenv_values("/app/backend/.env")
    db = MongoClient((env.get("MONGO_URL") or "mongodb://localhost:27017").strip('"'))[(env.get("DB_NAME") or "test_database").strip('"')]

    login = requests.post(
        f"{BASE}/api/auth/login",
        json={"username": "serkan", "password": "19071987"},
        timeout=20,
    )
    login.raise_for_status()
    token = login.json()["token"]
    me = requests.get(f"{BASE}/api/auth/me", headers=h(token), timeout=20).json()

    # Remove old QA rows only.
    db.tasks.delete_many({"title": {"$regex": f"^{PREFIX}"}})
    db.task_categories.delete_many({"name": {"$regex": f"^{CAT_NAME}"}})

    cat_id = "qa-reorder-cat-a"
    db.task_categories.insert_one({
        "id": cat_id,
        "company_id": "qa-company-reorder",
        "name": CAT_NAME,
        "color": "#00e5ff",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": me["id"],
        "visible_to_company_ids": [],
        "visible_to_user_ids": [me["id"]],
    })

    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()

    specs = [
        # High sort_order group appears at the top and is used for real UI drag tests.
        ("TOP_ACTIVE_1", cat_id, "pending", future, 100008),
        ("TOP_ACTIVE_2", cat_id, "pending", future, 100007),
        ("TOP_OVERDUE_1", cat_id, "pending", past, 100006),
        ("TOP_OTHER_ACTIVE", None, "pending", future, 100005),
        ("TOP_ACTIVE_3", cat_id, "pending", future, 100004),
        ("TOP_PAUSED_1", cat_id, "paused", future, 100003),
        # Mixed/null sort_order rows exercise backend created_at fallback vs frontend status/due-date fallback.
        ("MIX_OVERDUE_NULL", cat_id, "pending", past, None),
        ("MIX_ACTIVE_NULL_1", cat_id, "pending", future, None),
        ("MIX_ACTIVE_NULL_2", None, "pending", future, None),
    ]

    created = {}
    for name, cat, status, due, sort_order in specs:
        title = PREFIX + name
        body = {"title": title, "description": "QA task reorder verification", "due_date": due}
        if cat:
            body["category_id"] = cat
        r = requests.post(f"{BASE}/api/tasks", headers=h(token), json=body, timeout=20)
        r.raise_for_status()
        task = r.json()
        if status != "pending":
            pr = requests.patch(f"{BASE}/api/tasks/{task['id']}", headers=h(token), json={"status": status}, timeout=20)
            pr.raise_for_status()
        update = {"sort_order": sort_order, "updated_at": datetime.now(timezone.utc).isoformat()}
        db.tasks.update_one({"id": task["id"]}, {"$set": update})
        created[name] = {"id": task["id"], "title": title, "category_id": cat, "status": status, "sort_order": sort_order}

    out = {"base": BASE, "token": token, "user": me, "category": {"id": cat_id, "name": CAT_NAME}, "tasks": created}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()