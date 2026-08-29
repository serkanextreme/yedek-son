import asyncio
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError


ROOT = Path("/app")
FRONTEND_ENV = ROOT / "frontend" / ".env"


def get_frontend_url():
    for line in FRONTEND_ENV.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


URL = get_frontend_url()

ADMIN_TABS = [
    ("settings-tab-custom", "Renkler", "[data-testid='color-row-idle']"),
    ("settings-tab-presets", "Temalar", "[data-testid='preset-klasik']"),
    ("settings-tab-alarm", "Alarm", "[data-testid='alarm-tab-content']"),
    ("settings-tab-account", "Hesap", "[data-testid='acc-change-password']"),
    ("settings-tab-workspace", "Mod", "[data-testid='workspace-mode-tab']"),
    ("settings-tab-users", "Kullanıcılar", "[data-testid='user-management']"),
    ("settings-tab-licenses", "Lisanslar", "[data-testid='license-management']"),
    ("settings-tab-companies", "Şirketler", "[data-testid='companies-management']"),
    ("settings-tab-visibility", "Yetkiler", "[data-testid='manager-visibility-management']"),
]

EMPLOYEE_ALLOWED_TABS_FROM_REVIEW = [
    "settings-tab-custom",
    "settings-tab-presets",
    "settings-tab-alarm",
    "settings-tab-account",
    "settings-tab-workspace",
]

ADMIN_ONLY_TABS = [
    "settings-tab-users",
    "settings-tab-licenses",
    "settings-tab-companies",
    "settings-tab-visibility",
]


async def dismiss_overdue_if_present(page):
    try:
        close = page.locator("[data-testid='overdue-alert-close']")
        if await close.is_visible(timeout=2500):
            await close.click(force=True)
            await page.wait_for_timeout(300)
            print("Dismissed overdue alert modal")
    except PlaywrightTimeoutError:
        pass
    except Exception as exc:
        print(f"Overdue modal dismissal skipped: {exc}")


async def login(page, username, password):
    print(f"Logging in as {username}")
    await page.goto(URL, wait_until="domcontentloaded")
    await page.evaluate("""() => {
        localStorage.removeItem('sertex_token_v1');
        sessionStorage.clear();
    }""")
    await page.goto(URL, wait_until="domcontentloaded")
    await page.wait_for_selector("[data-testid='login-card']", timeout=15000)
    await page.fill("[data-testid='login-username']", username)
    await page.fill("[data-testid='login-password']", password)
    await page.click("[data-testid='login-submit']")
    await page.wait_for_selector("[data-testid='open-settings']", timeout=25000)
    await dismiss_overdue_if_present(page)


async def open_settings(page):
    await page.click("[data-testid='open-settings']", force=True)
    await page.wait_for_selector("[data-testid='settings-panel']", timeout=15000)
    await page.wait_for_selector("[data-testid='settings-tabs']", timeout=15000)
    await page.wait_for_timeout(500)


async def measure_tabs(page, tab_ids):
    return await page.evaluate(
        """(tabIds) => {
            const panel = document.querySelector('[data-testid="settings-panel"]');
            const tabs = document.querySelector('[data-testid="settings-tabs"]');
            const rectObj = (r) => ({left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height});
            const pRect = panel ? rectObj(panel.getBoundingClientRect()) : null;
            const tRect = tabs ? rectObj(tabs.getBoundingClientRect()) : null;
            const out = [];
            for (const id of tabIds) {
                const el = document.querySelector(`[data-testid="${id}"]`);
                if (!el) {
                    out.push({id, exists: false});
                    continue;
                }
                const r = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                out.push({
                    id,
                    exists: true,
                    visible: r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
                    text: (el.textContent || '').trim().replace(/\s+/g, ' '),
                    className: el.className || '',
                    rect: rectObj(r),
                    outsidePanelLeft: pRect ? r.left < pRect.left - 1 : null,
                    outsidePanelRight: pRect ? r.right > pRect.right + 1 : null,
                    outsideTabsLeft: tRect ? r.left < tRect.left - 1 : null,
                    outsideTabsRight: tRect ? r.right > tRect.right + 1 : null,
                });
            }
            const visibleRows = [...new Set(out.filter(x => x.visible).map(x => Math.round(x.rect.top)))].sort((a,b)=>a-b);
            return {
                panel: pRect,
                tabs: tRect,
                tabsContainerClass: tabs ? tabs.className : null,
                tabInfo: out,
                rowCount: visibleRows.length,
                rowTops: visibleRows,
                bodyScrollWidth: document.documentElement.scrollWidth,
                viewportWidth: window.innerWidth,
            };
        }""",
        tab_ids,
    )


def assert_no_overflow(measurement, expected_ids, label):
    failures = []
    if "flex-wrap" not in (measurement.get("tabsContainerClass") or ""):
        failures.append(f"{label}: settings-tabs container does not include flex-wrap")
    by_id = {x["id"]: x for x in measurement["tabInfo"]}
    for tid in expected_ids:
        info = by_id.get(tid)
        if not info or not info.get("exists"):
            failures.append(f"{label}: missing tab {tid}")
            continue
        if not info.get("visible"):
            failures.append(f"{label}: tab {tid} exists but is not visible")
        if info.get("outsidePanelLeft") or info.get("outsidePanelRight"):
            failures.append(f"{label}: tab {tid} overflows settings panel bounds: {info.get('rect')} panel={measurement.get('panel')}")
        if info.get("outsideTabsLeft") or info.get("outsideTabsRight"):
            failures.append(f"{label}: tab {tid} overflows tabs container bounds: {info.get('rect')} tabs={measurement.get('tabs')}")
    return failures


async def verify_admin(page):
    failures = []
    await page.set_viewport_size({"width": 1920, "height": 1080})
    await login(page, "serkan", "19071987")
    await open_settings(page)

    admin_ids = [x[0] for x in ADMIN_TABS]
    desktop_measurement = await measure_tabs(page, admin_ids)
    print("ADMIN_DESKTOP_MEASUREMENT", json.dumps(desktop_measurement, ensure_ascii=False))
    failures += assert_no_overflow(desktop_measurement, admin_ids, "admin desktop")

    for tid, label, content_selector in ADMIN_TABS:
        await page.click(f"[data-testid='{tid}']", force=True)
        await page.wait_for_timeout(250)
        await page.wait_for_selector(content_selector, timeout=10000)
        cls = await page.locator(f"[data-testid='{tid}']").get_attribute("class")
        text = (await page.locator(f"[data-testid='{tid}']").inner_text()).strip().replace("\n", " ")
        if "neon-glow" not in (cls or "") or "border-transparent" in (cls or ""):
            failures.append(f"admin tab {tid}/{label}: active visual indicator missing or transparent; class={cls}")
        print(f"Admin tab OK: {tid} text='{text}' active_class='{cls}' content='{content_selector}'")

    await page.click("[data-testid='settings-close']", force=True)
    await page.wait_for_timeout(300)

    await page.set_viewport_size({"width": 390, "height": 844})
    await open_settings(page)
    mobile_measurement = await measure_tabs(page, admin_ids)
    print("ADMIN_MOBILE_MEASUREMENT", json.dumps(mobile_measurement, ensure_ascii=False))
    failures += assert_no_overflow(mobile_measurement, admin_ids, "admin narrow viewport")
    if mobile_measurement.get("rowCount", 0) < 2:
        failures.append(f"admin narrow viewport: expected wrapped tabs on >=2 rows, got {mobile_measurement.get('rowCount')}")

    return failures, desktop_measurement, mobile_measurement


async def verify_employee(page):
    failures = []
    await page.set_viewport_size({"width": 1920, "height": 1080})
    await login(page, "ahmet", "ahmet123")
    await open_settings(page)
    all_employee_related = EMPLOYEE_ALLOWED_TABS_FROM_REVIEW + ADMIN_ONLY_TABS + ["settings-tab-mylicense"]
    employee_measurement = await measure_tabs(page, all_employee_related)
    print("EMPLOYEE_MEASUREMENT", json.dumps(employee_measurement, ensure_ascii=False))

    by_id = {x["id"]: x for x in employee_measurement["tabInfo"]}
    for tid in EMPLOYEE_ALLOWED_TABS_FROM_REVIEW:
        if not by_id.get(tid, {}).get("visible"):
            failures.append(f"employee: expected non-admin tab {tid} visible")
    for tid in ADMIN_ONLY_TABS:
        if by_id.get(tid, {}).get("exists") and by_id.get(tid, {}).get("visible"):
            failures.append(f"employee: admin-only tab {tid} is visible")
    # Keep the review-request contract explicit: it expected exactly the five listed non-admin tabs.
    if by_id.get("settings-tab-mylicense", {}).get("exists") and by_id.get("settings-tab-mylicense", {}).get("visible"):
        failures.append("employee: extra settings-tab-mylicense tab is visible; review request expected only 5 tabs")

    failures += assert_no_overflow(employee_measurement, EMPLOYEE_ALLOWED_TABS_FROM_REVIEW, "employee desktop")
    return failures, employee_measurement


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page()
        page.on("console", lambda msg: print(f"BROWSER_CONSOLE {msg.type}: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"BROWSER_PAGEERROR {exc}"))
        failures = []
        results = {}
        try:
            admin_failures, admin_desktop, admin_mobile = await verify_admin(page)
            failures += admin_failures
            results["admin_desktop"] = admin_desktop
            results["admin_mobile"] = admin_mobile
            employee_failures, employee_measurement = await verify_employee(page)
            failures += employee_failures
            results["employee"] = employee_measurement

            print("FINAL_RESULTS", json.dumps({"failures": failures, "results": results}, ensure_ascii=False))
            if failures:
                raise AssertionError("; ".join(failures))
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())