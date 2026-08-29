"""Focused Playwright verification notes/script for bug_verification_71.

This file mirrors the browser-automation flow executed through the MCP
Playwright tool for the Sertex Görevler reorder regression:
- login as serkan / 19071987
- open Görevler
- verify TÜMÜ + AKTİF drag reorder persists after reload
- verify category-only QA_REORDER_CAT_A hides non-category QA rows, drag reorder
  persists, and non-visible QA rows keep master-list positions
- verify AKTİF + QA_REORDER_CAT_A combined drag reorder persists
- verify no-filter baseline drag reorder persists

The executable script is passed to mcp_browser_automation by the testing agent;
this artifact is kept for handoff/report traceability.
"""
