"""Ad-hoc E2E for Faz 10 — offboarding on company change.
Run: python tests/e2e_offboard_check.py
Uses admin (bypasses license gate) to set up companies, a manager, an employee,
two tasks (one done, one pending) tied to company A, then changes the employee's
company to B and verifies archive + orphan-reassign + notification.
"""
import os, sys, uuid, requests

def _env(k):
    v = os.environ.get(k)
    if v:
        return v
    for p in ("/app/frontend/.env", "/app/backend/.env"):
        try:
            for line in open(p):
                if line.startswith(k + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except FileNotFoundError:
            pass
    return None

API = "http://localhost:8001/api"
H = lambda t: {"Authorization": f"Bearer {t}"}

def login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]

def main():
    admin = login("serkan", "19071987")
    sfx = uuid.uuid4().hex[:6]
    # 1) companies
    cA = requests.post(f"{API}/companies", headers=H(admin), json={"name": f"E2E_A_{sfx}"}, timeout=30).json()
    cB = requests.post(f"{API}/companies", headers=H(admin), json={"name": f"E2E_B_{sfx}"}, timeout=30).json()
    cA_id, cB_id = cA["id"], cB["id"]
    print("companies:", cA_id, cB_id)
    # 2) manager of A + employee of A
    mgr = requests.post(f"{API}/admin/users", headers=H(admin), json={
        "username": f"e2e_mgr_{sfx}", "password": "pass1234", "role": "manager", "company_id": cA_id,
        "with_license": "lifetime",
    }, timeout=30).json()
    emp = requests.post(f"{API}/admin/users", headers=H(admin), json={
        "username": f"e2e_emp_{sfx}", "password": "pass1234", "role": "employee", "company_id": cA_id,
        "with_license": "lifetime",
    }, timeout=30).json()
    mgr_id, emp_id = mgr["id"], emp["id"]
    print("mgr:", mgr_id, "emp:", emp_id)
    # 3) two tasks for emp tied to company A (admin assigns; admin bypasses license)
    t_pending = requests.post(f"{API}/tasks", headers=H(admin), json={
        "title": f"E2E_PENDING_{sfx}", "assignee_user_id": emp_id, "company_id": cA_id,
    }, timeout=30).json()
    t_done = requests.post(f"{API}/tasks", headers=H(admin), json={
        "title": f"E2E_DONE_{sfx}", "assignee_user_id": emp_id, "company_id": cA_id,
    }, timeout=30).json()
    # mark one done
    requests.patch(f"{API}/tasks/{t_done['id']}", headers=H(admin), json={"status": "done"}, timeout=30)
    print("tasks:", t_pending["id"], "(pending)", t_done["id"], "(done)")

    # manager unread count BEFORE
    mgr_tok = login(f"e2e_mgr_{sfx}", "pass1234")
    unread_before = requests.get(f"{API}/notifications/unread-count", headers=H(mgr_tok), timeout=30).json()

    # 4) CHANGE employee's company A -> B
    r = requests.patch(f"{API}/admin/users/{emp_id}", headers=H(admin),
                       json={"company_id": cB_id}, timeout=30)
    r.raise_for_status()
    ob = r.json().get("_offboard")
    print("OFFBOARD SUMMARY:", ob)

    # 5) verify
    from pymongo import MongoClient
    mc = MongoClient(_env("MONGO_URL"))
    db = mc[_env("DB_NAME")]
    d_pending = db.tasks.find_one({"id": t_pending["id"]})
    d_done = db.tasks.find_one({"id": t_done["id"]})

    checks = []
    checks.append(("done task archived", d_done.get("archived") is True))
    checks.append(("done task NOT orphaned", not d_done.get("orphaned")))
    checks.append(("pending task orphaned", d_pending.get("orphaned") is True))
    checks.append(("pending orphaned_from == A", d_pending.get("orphaned_from_company_id") == cA_id))
    checks.append(("pending reassigned to manager", d_pending.get("user_id") == mgr_id))
    checks.append(("pending prev_assignee == emp", d_pending.get("prev_assignee_user_id") == emp_id))
    checks.append(("summary orphaned==1", (ob or {}).get("orphaned") == 1))
    checks.append(("summary archived==1", (ob or {}).get("archived") == 1))
    checks.append(("summary manager_id==mgr", (ob or {}).get("manager_id") == mgr_id))

    # employee company_ids updated
    emp_doc = db.users.find_one({"id": emp_id})
    checks.append(("emp company_id==B", emp_doc.get("company_id") == cB_id))
    checks.append(("emp company_ids has B", cB_id in (emp_doc.get("company_ids") or [])))
    checks.append(("emp company_ids no A", cA_id not in (emp_doc.get("company_ids") or [])))

    # manager notification
    notifs = requests.get(f"{API}/notifications", headers=H(mgr_tok), timeout=30).json()
    orphan_notif = [n for n in notifs if n.get("type") == "tasks_orphaned"]
    unread_after = requests.get(f"{API}/notifications/unread-count", headers=H(mgr_tok), timeout=30).json()
    checks.append(("manager got tasks_orphaned notif", len(orphan_notif) >= 1))
    checks.append(("manager unread increased", (unread_after.get("unread", 0) > unread_before.get("unread", 0))))

    # orphan pool shows the pending task to manager A
    pool = requests.get(f"{API}/orphan-tasks", headers=H(mgr_tok), timeout=30).json()
    pool_ids = {t["id"] for t in pool}
    checks.append(("pending in manager orphan pool", t_pending["id"] in pool_ids))

    # pending task ALSO appears in manager's normal task list (option A)
    mgr_tasks = requests.get(f"{API}/tasks", headers=H(mgr_tok), timeout=30).json()
    mgr_task_ids = {t["id"] for t in mgr_tasks}
    checks.append(("pending in manager normal list", t_pending["id"] in mgr_task_ids))

    print("\n=== RESULTS ===")
    ok = True
    for name, res in checks:
        print(("PASS" if res else "FAIL"), "-", name)
        ok = ok and res

    # cleanup
    db.tasks.delete_many({"id": {"$in": [t_pending["id"], t_done["id"]]}})
    db.users.delete_many({"id": {"$in": [mgr_id, emp_id]}})
    db.notifications.delete_many({"user_id": mgr_id})
    db.companies.delete_many({"id": {"$in": [cA_id, cB_id]}})
    mc.close()
    print("\nALL PASS" if ok else "\nSOME FAILED")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
