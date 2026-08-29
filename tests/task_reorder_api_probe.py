import os
import requests

BASE = os.environ.get("SERTEX_BASE_URL", "https://functional-themes.preview.emergentagent.com")


def main():
    r = requests.post(f"{BASE}/api/auth/login", json={"username": "serkan", "password": "19071987"}, timeout=20)
    print("login", r.status_code)
    r.raise_for_status()
    token = r.json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    for path in ["/api/auth/me", "/api/task-categories?scope=my_tasks", "/api/task-categories", "/api/tasks"]:
        rr = requests.get(f"{BASE}{path}", headers=h, timeout=20)
        print(path, rr.status_code)
        data = rr.json()
        if isinstance(data, list):
            print("count", len(data), "sample", data[:2])
        else:
            print(data)


if __name__ == "__main__":
    main()