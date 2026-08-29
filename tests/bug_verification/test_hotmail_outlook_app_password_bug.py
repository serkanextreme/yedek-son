#!/usr/bin/env python3
"""Focused API verification for Microsoft personal email App Password error UX."""
import json
import os
import sys
import time
import uuid
from pathlib import Path

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_USER = os.environ.get("TEST_ADMIN_USER", "serkan")
ADMIN_PASS = os.environ.get("TEST_ADMIN_PASS", "19071987")
OLD_GENERIC = "IMAP giriş başarısız — e-posta veya app-password hatalı"
MS_NEEDLES = ["Microsoft"]
MS_ALT_NEEDLES = ["Eylül 2024", "OAuth", "kişisel"]

session = requests.Session()


def req(method, url, **kwargs):
    timeout = kwargs.pop("timeout", 45)
    return session.request(method, url, timeout=timeout, **kwargs)


def login(username, password):
    r = req("POST", f"{API}/auth/login", json={"username": username, "password": password}, timeout=20)
    if r.status_code != 200:
        raise AssertionError(f"login failed {r.status_code}: {r.text[:500]}")
    return r.json()["token"]


def create_user(admin_token):
    username = f"TEST_ms_email_{uuid.uuid4().hex[:8]}"
    password = "Passw0rd!"
    r = req(
        "POST",
        f"{API}/admin/users",
        json={"username": username, "password": password, "role": "user", "with_license": "trial"},
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=20,
    )
    if r.status_code not in (200, 201):
        raise AssertionError(f"create user failed {r.status_code}: {r.text[:500]}")
    return username, password, r.json().get("id")


def delete_user(admin_token, uid):
    if uid:
        try:
            req("DELETE", f"{API}/admin/users/{uid}", headers={"Authorization": f"Bearer {admin_token}"}, timeout=20)
        except Exception:
            pass


def post_account(token, payload):
    start = time.time()
    r = req("POST", f"{API}/email/accounts", json=payload, headers={"Authorization": f"Bearer {token}"}, timeout=60)
    elapsed = round(time.time() - start, 2)
    try:
        body = r.json()
    except Exception:
        body = {"raw": r.text}
    return {"status": r.status_code, "body": body, "elapsed_sec": elapsed}


def check_ms_result(label, result):
    detail = str(result["body"].get("detail", result["body"]))
    ok = (
        result["status"] == 400
        and all(n in detail for n in MS_NEEDLES)
        and any(n in detail for n in MS_ALT_NEEDLES)
        and OLD_GENERIC not in detail
    )
    return {"case": label, "ok": ok, "detail": detail, **result}


def main():
    report = {"base_url": BASE_URL, "cases": []}
    admin_token = login(ADMIN_USER, ADMIN_PASS)
    username, password, uid = create_user(admin_token)
    try:
        token = login(username, password)
        for domain in ["hotmail.com", "outlook.com", "live.com", "msn.com"]:
            email = f"probe-{uuid.uuid4().hex[:6]}@{domain}"
            result = post_account(token, {"email": email, "app_password": "tlrntbhghycydyio"})
            report["cases"].append(check_ms_result(domain, result))
        generic_email = f"probe-{uuid.uuid4().hex[:6]}@unknownprovider.example.com"
        generic_payload = {
            "email": generic_email,
            "app_password": "tlrntbhghycydyio",
            "provider": "generic",
            # Use a real IMAP endpoint to exercise login failure path for non-Microsoft generic provider.
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 587,
            "smtp_mode": "starttls",
        }
        generic_result = post_account(token, generic_payload)
        generic_detail = str(generic_result["body"].get("detail", generic_result["body"]))
        generic_ok = generic_result["status"] == 400 and OLD_GENERIC in generic_detail and "Microsoft" not in generic_detail
        report["cases"].append({"case": "generic_non_ms", "ok": generic_ok, "detail": generic_detail, **generic_result})
        # Verify failed adds were not persisted.
        r = req("GET", f"{API}/email/accounts", headers={"Authorization": f"Bearer {token}"}, timeout=20)
        report["accounts_after_failed_adds"] = {"status": r.status_code, "body": r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text}
        report["all_ok"] = all(c["ok"] for c in report["cases"]) and r.status_code == 200 and r.json() == []
    finally:
        delete_user(admin_token, uid)
    out = Path("/app/test_reports/hotmail_outlook_api_probe.json")
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("all_ok") else 1


if __name__ == "__main__":
    sys.exit(main())
