#!/usr/bin/env python3
"""Focused verification for Sertex task reorder persistence bug.

Creates isolated tasks, exercises POST /api/tasks/reorder as admin and employee,
and verifies persisted sort_order values after refetch.
"""
import json
import os
import sys
import time
import uuid

import requests


def read_frontend_backend_url():
    env_path = "/app/frontend/.env"
    with open(env_path, "r", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.strip().split("=", 1)[1].rstrip("/")
    return "http://localhost:8001"


BASE = os.environ.get("REACT_APP_BACKEND_URL", read_frontend_backend_url()).rstrip("/")
API = f"{BASE}/api"


def login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    if r.status_code != 200:
        raise AssertionError(f"login failed for {username}: {r.status_code} {r.text}")
    data = r.json()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"})
    return s, data["user"]


def create_task(sess, title, **extras):
    payload = {"title": title}
    payload.update({k: v for k, v in extras.items() if v is not None})
    r = sess.post(f"{API}/tasks", json=payload, timeout=30)
    if r.status_code != 200:
        raise AssertionError(f"create task failed {title}: {r.status_code} {r.text}")
    return r.json()


def delete_task(sess, task_id):
    try:
        sess.delete(f"{API}/tasks/{task_id}", timeout=15)
    except Exception:
        pass


def reorder(sess, ids):
    r = sess.post(f"{API}/tasks/reorder", json={"ids": ids}, timeout=30)
    if r.status_code != 200:
        raise AssertionError(f"reorder failed: {r.status_code} {r.text}")
    return r.json()


def fetch_tasks(sess, include_all=False):
    url = f"{API}/tasks"
    if include_all:
        url += "?include_all=true"
    r = sess.get(url, timeout=30)
    if r.status_code != 200:
        raise AssertionError(f"fetch tasks failed: {r.status_code} {r.text}")
    return r.json()


def by_id(rows, ids):
    found = {t["id"]: t for t in rows if t.get("id") in set(ids)}
    missing = [i for i in ids if i not in found]
    if missing:
        raise AssertionError(f"missing tasks in fetch: {missing}")
    return found


def assert_orders(rows_by_id, expected):
    for tid, exp in expected.items():
        got = rows_by_id[tid].get("sort_order")
        if got != exp:
            raise AssertionError(f"sort_order mismatch for {tid}: expected {exp}, got {got}")


def ordered_titles(rows, ids):
    idset = set(ids)
    return [t["title"] for t in rows if t.get("id") in idset]


def main():
    results = []
    cleanup_ids = []
    admin, admin_user = login("serkan", "19071987")
    emp, emp_user = login("ahmet", "ahmet123")
    prefix = f"BUG_REORDER_{int(time.time())}_{uuid.uuid4().hex[:6]}"

    try:
        # 1) Exact curl-level bug: admin reorders tasks assigned to Ahmet.
        t1 = create_task(admin, f"{prefix}_AHMET_1", assignee_user_id=emp_user["id"], assignee_name="ahmet")
        t2 = create_task(admin, f"{prefix}_AHMET_2", assignee_user_id=emp_user["id"], assignee_name="ahmet")
        t3 = create_task(admin, f"{prefix}_AHMET_3", assignee_user_id=emp_user["id"], assignee_name="ahmet")
        cleanup_ids.extend([t1["id"], t2["id"], t3["id"]])
        reorder(admin, [t3["id"], t1["id"], t2["id"]])
        admin_rows = by_id(fetch_tasks(admin, include_all=True), [t1["id"], t2["id"], t3["id"]])
        emp_rows = by_id(fetch_tasks(emp), [t1["id"], t2["id"], t3["id"]])
        expected = {t3["id"]: 3.0, t1["id"]: 2.0, t2["id"]: 1.0}
        assert_orders(admin_rows, expected)
        assert_orders(emp_rows, expected)
        results.append({"name": "admin_reorders_ahmet_tasks_persisted_for_admin_and_ahmet", "status": "passed"})

        # 2) Security guard: Ahmet cannot change Serkan-only task sort_order.
        adm_private = create_task(admin, f"{prefix}_ADMIN_PRIVATE")
        emp_self = create_task(emp, f"{prefix}_AHMET_SELF")
        cleanup_ids.extend([adm_private["id"], emp_self["id"]])
        before_admin_private = by_id(fetch_tasks(admin, include_all=True), [adm_private["id"]])[adm_private["id"]].get("sort_order")
        response = reorder(emp, [adm_private["id"], emp_self["id"]])
        after_admin_private = by_id(fetch_tasks(admin, include_all=True), [adm_private["id"]])[adm_private["id"]].get("sort_order")
        if response.get("ok") is not True:
            raise AssertionError(f"employee reorder response was not ok: {response}")
        if after_admin_private != before_admin_private:
            raise AssertionError(f"security violation: admin private sort_order changed from {before_admin_private} to {after_admin_private}")
        results.append({"name": "employee_cannot_reorder_admin_private_task", "status": "passed"})

        # 3) Regression: single-user reorder persists and refetch order respects sort_order desc.
        s1 = create_task(admin, f"{prefix}_SERKAN_1")
        s2 = create_task(admin, f"{prefix}_SERKAN_2")
        s3 = create_task(admin, f"{prefix}_SERKAN_3")
        cleanup_ids.extend([s1["id"], s2["id"], s3["id"]])
        reorder(admin, [s3["id"], s1["id"], s2["id"]])
        single_rows_all = fetch_tasks(admin, include_all=True)
        single_by_id = by_id(single_rows_all, [s1["id"], s2["id"], s3["id"]])
        assert_orders(single_by_id, {s3["id"]: 3.0, s1["id"]: 2.0, s2["id"]: 1.0})
        filtered_order = ordered_titles(single_rows_all, [s1["id"], s2["id"], s3["id"]])
        if filtered_order[:3] != [s3["title"], s1["title"], s2["title"]]:
            raise AssertionError(f"single-user refetch order wrong: {filtered_order}")
        results.append({"name": "single_user_reorder_persists_and_refetch_order_matches", "status": "passed"})

        # 4) Filtered reorder preservation: full-order request preserves hidden rows' slots.
        cat_id = f"cat-{uuid.uuid4().hex}"
        f_a = create_task(admin, f"{prefix}_FILTER_A", category_id=cat_id)
        f_b = create_task(admin, f"{prefix}_FILTER_HIDDEN_B")
        f_c = create_task(admin, f"{prefix}_FILTER_C", category_id=cat_id)
        f_d = create_task(admin, f"{prefix}_FILTER_HIDDEN_D")
        cleanup_ids.extend([f_a["id"], f_b["id"], f_c["id"], f_d["id"]])
        # Establish master order A,B,C,D; then filtered category reorder swaps A/C only -> C,B,A,D.
        reorder(admin, [f_a["id"], f_b["id"], f_c["id"], f_d["id"]])
        reorder(admin, [f_c["id"], f_b["id"], f_a["id"], f_d["id"]])
        filtered_rows = by_id(fetch_tasks(admin, include_all=True), [f_a["id"], f_b["id"], f_c["id"], f_d["id"]])
        assert_orders(filtered_rows, {f_c["id"]: 4.0, f_b["id"]: 3.0, f_a["id"]: 2.0, f_d["id"]: 1.0})
        results.append({"name": "filtered_reorder_full_payload_preserves_non_visible_slots", "status": "passed"})

        print(json.dumps({"ok": True, "api": API, "admin_user_id": admin_user["id"], "employee_user_id": emp_user["id"], "results": results}, indent=2, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "api": API, "results": results, "error": str(exc)}, indent=2, ensure_ascii=False))
        return 1
    finally:
        for tid in cleanup_ids:
            delete_task(admin, tid)


if __name__ == "__main__":
    sys.exit(main())