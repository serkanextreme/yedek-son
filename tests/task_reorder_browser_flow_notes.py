"""Manual/Playwright browser verification script notes for the Sertex task reorder bug.

The executable Playwright steps are run through the provided mcp_browser_automation
tool in this environment. This file records the focused scenarios covered:
1. TÜMÜ category + AKTİF status filter: drag reorder, capture POST /api/tasks/reorder,
   reload and verify visible persisted order.
2. Category-only filter: select QA_REORDER_CAT_A, drag reorder, reload and verify.
3. Status + category combined: AKTİF + QA_REORDER_CAT_A, drag reorder; verify
   non-visible task IDs keep their master-list positions in the POST body.
4. No status/category filter baseline: drag reorder, reload and verify.
5. Mixed sort_order/null IDX mapping: reset selected QA rows to sort_order=null,
   use AKTİF+GEÇTİ and verify the browser sends the frontend sorted full master list.
"""
