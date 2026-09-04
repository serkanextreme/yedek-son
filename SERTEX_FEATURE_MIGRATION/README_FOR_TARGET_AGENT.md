# Sertex — Port 2 Features into panel-refactoring-v2 (PRODUCTION app)

**Read this fully before doing anything.** You are the agent for the app `panel-refactoring-v2`, which holds the user's REAL production data and the live domain `sertex-ai.com`. A fork of this app (`functional-themes`) built TWO new features that must now be ported back here, WITHOUT touching the production database.

## ⛔ CRITICAL — DO NOT
- DO NOT reset, wipe, seed-over, or "Replace with Fresh Database". The production `tasks`/`users`/etc. must stay intact.
- DO NOT change any `.env` values, `MONGO_URL`, or `DB_NAME`.
- A normal redeploy is fine and does NOT touch data. Only apply CODE changes.

## What to apply
Two features, all changes captured in `new_features.patch` (a `git diff` from the fork).

### Feature 1 — Görev Kopyalama (Task Copy → Paste / Clipboard)
Right-click OR ⋮ menu on a task → **"Kopyala"** puts the task on an in-app clipboard; right-click a category (iş kolu) → **"Yapıştır"** creates a duplicate assigned to the current user. Backend endpoint duplicates the task server-side (copies subtasks + optionally attachments).
- Backend: `POST /api/tasks/{tid}/duplicate` (body: `include_subtasks`, `include_attachments`, `target_category_id`). Copies attachments in object storage.
- Web: `TaskContextMenu.jsx` gets a "Kopyala" item (action `copy`); `CopyTaskModal.jsx`, `TaskPasteMenu.jsx`, `lib/taskClipboard.js`; wired in `TasksPanel.jsx` (Detaylı) + `KolayInterface.jsx` (Kolay).
- Mobile: `CopyTaskModal.tsx`, `lib/taskClipboard.ts`; wired in `app/(tabs)/tasks.tsx` + `app/task/[id].tsx`.

### Feature 2 — Şablon Kütüphanesi (Task Templates)
Save frequently-used tasks as templates (name, title, description, category, reminder, subtasks, file attachments), scope **personal** or **shared (company)**, then instantiate a real task from a template. Uses SEPARATE collections — never touches existing task queries/stats/archive/scheduler.
- Backend: new `routers/templates_router.py` mounted in `server.py` via `build_templates_router(db, licensed_user)` with prefix `/api`. Collections `task_templates` + `task_template_attachments`.
  - `GET/POST /api/task-templates`, `GET/PATCH/DELETE /api/task-templates/{id}`
  - `POST /api/task-templates/{id}/instantiate` → creates a real task in `tasks` (+ copies attachments to `task_attachments`); status=pending, assigned to creator, subtasks done=False.
  - Attachments (chunked): `/api/task-templates/{id}/attachments/init|/chunk|/complete`, `GET .../attachments`, `.../attachments/{aid}/download`, `DELETE .../attachments/{aid}`.
  - Scope: `personal` (owner only) / `shared` (everyone in owner's company). Manage perms via owner/admin.
- Web: `tasks/TemplateBar.jsx`, `TemplatesModal.jsx`, `TemplateFormModal.jsx`; `lib/api.js` gains `templatesApi` + `templateAttachmentsApi`; TemplateBar mounted in `TasksPanel.jsx` + `KolayInterface.jsx`.
- Mobile: `app/templates.tsx` (screen), `src/components/TemplateBar.tsx`, `TemplateFormModal.tsx`, `constants/testIds/templates.js`; api in `src/api/client.ts` + `types.ts`; entry from `app/(tabs)/tasks.tsx` (router.push('/templates')).
- Design note (web + mobile, intentional): after SAVING a NEW template the form modal stays open in edit mode so the user can add file attachments (attachments need a saved template id). Closed via X/Cancel.

## How to apply (preferred: patch)
From repo root:
```bash
git apply --3way SERTEX_FEATURE_MIGRATION/new_features.patch
```
If some hunks fail (codebases diverged), apply the failed files manually using the patch as the reference — the fork was created from THIS app so most files match. The 15 NEW files can be copied verbatim; the 18 MODIFIED files are additive (new menu items, new imports, new state/handlers, new API methods) — merge the added blocks.

## Modified files (merge added blocks) — 18
backend/routers/tasks_models.py, backend/routers/tasks_router.py, backend/server.py,
frontend/src/components/KolayInterface.jsx, TaskCard.jsx, TaskContextMenu.jsx, TasksPanel.jsx,
frontend/src/components/tasks/TaskAttachments.jsx, frontend/src/lib/api.js,
mobile/app/(tabs)/tasks.tsx, mobile/app/task/[id].tsx,
mobile/constants/testIds/detail.js, index.js, tasks.js,
mobile/src/api/client.ts, types.ts, src/components/AttachmentsSection.tsx, CategorySection.tsx

## New files (copy verbatim) — 15
backend/routers/templates_router.py, backend/tests/test_task_duplicate.py, backend/tests/test_task_templates.py,
frontend/src/components/tasks/CopyTaskModal.jsx, TaskPasteMenu.jsx, TemplateBar.jsx, TemplateFormModal.jsx, TemplatesModal.jsx,
frontend/src/lib/taskClipboard.js,
mobile/app/templates.tsx, mobile/constants/testIds/templates.js,
mobile/src/components/CopyTaskModal.tsx, TemplateBar.tsx, TemplateFormModal.tsx, mobile/src/lib/taskClipboard.ts

## After applying
1. Backend hot-reloads. Run `pytest backend/tests/test_task_duplicate.py backend/tests/test_task_templates.py -v` (expects all pass; templates test = 7/7).
2. Verify web ⋮ menu shows "Kopyala" and the "Şablonlar" bar appears in both Detaylı & Kolay.
3. Restart mobile before checking Expo preview.
4. Redeploy normally (do NOT choose Fresh Database). Domain `sertex-ai.com` already points here, so nothing changes for the user's data or URL.
