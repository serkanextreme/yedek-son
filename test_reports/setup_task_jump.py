"""Setup: create overdue task for emp1_test, trigger scan-now."""
import os, requests, sys, json

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com").rstrip("/")

def login(u, p):
    r = requests.post(f"{BASE}/api/auth/login", json={"username": u, "password": p}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]

def h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}

def main():
    admin_tok = login("serkan", "19071987")
    # Find emp1_test and mgr_test
    users = requests.get(f"{BASE}/api/admin/users", headers=h(admin_tok)).json()
    emp1 = next((u for u in users if u["username"] == "emp1_test"), None)
    mgr = next((u for u in users if u["username"] == "mgr_test"), None)
    print("emp1", emp1 and emp1["id"], "mgr", mgr and mgr["id"])
    assert emp1 and mgr

    # Ensure manager-visibility
    r = requests.post(f"{BASE}/api/manager-visibility", headers=h(admin_tok),
                      json={"manager_user_id": mgr["id"], "employee_user_id": emp1["id"]})
    print("mv:", r.status_code, r.text[:200])

    # Cleanup previous demo tasks
    all_tasks = requests.get(f"{BASE}/api/tasks", headers=h(admin_tok)).json()
    for t in all_tasks:
        if t.get("title", "").startswith("Task Jump Demo Test"):
            rr = requests.delete(f"{BASE}/api/tasks/{t['id']}", headers=h(admin_tok))
            print("cleaned", t["id"], rr.status_code)

    # Create task assigned to emp1
    payload = {
        "title": "Task Jump Demo Test",
        "description": "auto-created for task-jump testing",
        "due_date": "2026-01-01T00:00:00Z",
        "assignee_user_id": emp1["id"],
    }
    r = requests.post(f"{BASE}/api/tasks", headers=h(admin_tok), json=payload)
    print("create:", r.status_code, r.text[:200])
    r.raise_for_status()
    task = r.json()
    print("task_id:", task["id"])

    # Trigger scan
    r = requests.post(f"{BASE}/api/notifications/scan-now", headers=h(admin_tok), json={})
    print("scan:", r.status_code, r.text[:200])

    # Verify mgr_test unread
    mgr_tok = login("mgr_test", "mgr12345")
    r = requests.get(f"{BASE}/api/notifications/unread-count", headers=h(mgr_tok))
    print("mgr unread:", r.status_code, r.text)
    r2 = requests.get(f"{BASE}/api/notifications?unread_only=false&limit=50", headers=h(mgr_tok))
    print("mgr list count:", r2.status_code, len(r2.json()) if r2.ok else r2.text)

    with open("/tmp/task_jump_ids.json", "w") as f:
        json.dump({"task_id": task["id"], "emp1_id": emp1["id"], "mgr_id": mgr["id"]}, f)

if __name__ == "__main__":
    main()
