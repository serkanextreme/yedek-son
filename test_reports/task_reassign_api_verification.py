import os
import time
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

def h(tok):
    return {"Authorization": f"Bearer {tok}"}

def login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=20)
    print(f"login {username}: {r.status_code}")
    r.raise_for_status()
    return r.json()["token"]

def user_id(admin_token, username):
    r = requests.get(f"{API}/admin/users", headers=h(admin_token), timeout=20)
    r.raise_for_status()
    for u in r.json():
        if u.get("username") == username:
            return u["id"]
    raise RuntimeError(f"user not found: {username}")

def create_task(tok, title):
    r = requests.post(f"{API}/tasks", headers=h(tok), json={"title": title}, timeout=20)
    print(f"create {title}: {r.status_code}")
    r.raise_for_status()
    return r.json()

def delete_task(tok, tid):
    try:
        r = requests.delete(f"{API}/tasks/{tid}", headers=h(tok), timeout=20)
        print(f"delete {tid}: {r.status_code} {r.text[:80]}")
    except Exception as e:
        print(f"delete failed {tid}: {e}")

def main():
    admin = login("serkan", "19071987")
    mgr = login("mgr_test", "mgr12345")
    emp = login("emp1_test", "emp12345")
    emp_id = user_id(admin, "emp1_test")
    mgr_id = user_id(admin, "mgr_test")
    serkan_id = user_id(admin, "serkan")
    prefix = f"QA_API_REASSIGN_{int(time.time())}"
    created = []
    try:
        # manager own -> visible employee
        t = create_task(mgr, prefix + "_to_emp")
        created.append(t["id"])
        r = requests.post(f"{API}/tasks/{t['id']}/reassign", headers=h(mgr), json={"new_owner_user_id": emp_id}, timeout=20)
        print("manager->emp:", r.status_code, r.text)
        assert r.status_code == 200 and r.json().get("assignee_name") == "emp1_test"
        emp_tasks = requests.get(f"{API}/tasks", headers=h(emp), timeout=20).json()
        assert any(x["id"] == t["id"] for x in emp_tasks), "emp task list missing reassigned task"

        # manager -> invisible admin user
        t2 = create_task(mgr, prefix + "_to_serkan_forbidden")
        created.append(t2["id"])
        r = requests.post(f"{API}/tasks/{t2['id']}/reassign", headers=h(mgr), json={"new_owner_user_id": serkan_id}, timeout=20)
        print("manager->serkan:", r.status_code, r.text)
        assert r.status_code == 403 and "Bu kullanıcıya görev devredemezsiniz" in r.text

        # manager -> self
        r = requests.post(f"{API}/tasks/{t2['id']}/reassign", headers=h(mgr), json={"new_owner_user_id": mgr_id}, timeout=20)
        print("manager->self:", r.status_code, r.text)
        assert r.status_code == 400 and "Yeni sahip zaten mevcut sahip" in r.text

        # employee attempts manager-owned task -> 404 no leak
        r = requests.post(f"{API}/tasks/{t2['id']}/reassign", headers=h(emp), json={"new_owner_user_id": emp_id}, timeout=20)
        print("employee unauthorized:", r.status_code, r.text)
        assert r.status_code == 404 and "Görev bulunamadı" in r.text

        # admin bypass: employee-owned to manager
        t3 = create_task(emp, prefix + "_admin_bypass")
        created.append(t3["id"])
        r = requests.post(f"{API}/tasks/{t3['id']}/reassign", headers=h(admin), json={"new_owner_user_id": mgr_id}, timeout=20)
        print("admin bypass:", r.status_code, r.text)
        assert r.status_code == 200 and r.json().get("assignee_name") == "mgr_test"
        print("API verification passed")
    finally:
        for tid in created:
            delete_task(admin, tid)

if __name__ == "__main__":
    main()
