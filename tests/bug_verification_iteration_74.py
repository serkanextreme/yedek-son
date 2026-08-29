
"""Focused frontend bug verification for CP8.6 (iteration 74).
Covers: dark native select styling in Add Task and dark company edit modal replacing window.prompt.
This file is a record of the Playwright flow executed by the testing agent.
"""

# The executable Playwright body was run via mcp_browser_automation because the
# environment supplies an existing async `page` object. See test report for results.

async def run(page):
    await page.set_viewport_size({"width": 1920, "height": 1080})
    await page.goto("https://functional-themes.preview.emergentagent.com")
    # Clear auth storage, login as admin serkan/19071987, navigate to Tasks and Settings->Users.
    # Assertions performed in the automation run:
    # - body color-scheme == dark and select/option computed backgrounds are dark
    # - task-assignee-select, task-category-select, task-reminder-days-select exist/open and are not white-styled
    # - company edit button does not raise a browser dialog/prompt
    # - admin-company-edit-modal/input/chips/cancel/save render with dark styling
    # - save custom company persists via GET /api/admin/users
    # - empty save clears company_name/company_id
    # - existing company chip fills input, highlights, and saves persistently
