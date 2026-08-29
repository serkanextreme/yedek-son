# Cross-Platform Port Blueprint

## Detection
- **Source Platform:** Web (`/app/frontend` contains React app, `src`, `package.json`).
- **Target Platform:** Mobile (`/app/mobile` contains Expo app, `app`, `package.json`, `metro.config.js`).
- **Evidence:** `ls -la /app` shows both `frontend` and `mobile` directories. `ls -la /app/frontend/src` shows a standard React structure with `App.js`, `components`, etc. `ls -la /app/mobile/app` shows Expo Router files like `_layout.tsx`, `index.tsx`, `+html.tsx`.

## Existing App Map (Web)
- **Routing & Navigation:**
  - `/` -> `<Gate>` -> redirects to `<LoginScreen>` if not authenticated, else `<SertexMain>`.
  - Main app is a single-page view (`SertexMain.jsx`) built around a `HolographicSphere` with various HUD overlays.
  - Sidebar (`Sidebar.jsx`) uses internal state/tabs (`history`, `tasks`, `team`, `orphans`, `memory`, `files`, `email`, `notes`, `backup`).
- **Key Components:**
  - `SertexMain`: The main layout container orchestrating HUDs, Sidebar, Chat, etc.
  - `Sidebar`: A multi-tab drawer with content for different functional areas.
  - `TasksPanel` / `TaskCard`: Handles complex hierarchical task lists, re-parenting, pinning, dragging, attachments.
  - `ChatMessages` & `InputBar`: For the AI chat interface.
  - `SettingsPanel`, `RedeemScreen`, `OverdueAlertModal`: Various modal screens.
  - Floating and detached panels architecture using `framer-motion` and custom events.
- **Primary User Flows:**
  - Authentication (Login/Gate).
  - Voice/Text interaction with the central AI (chat).
  - Task Management (creating, re-ranking, grouping, pinning, dragging tasks and hierarchical categories).
  - Team & Company management (multi-tenant isolation, manager visibility).
  - File management & chunked object storage.
  - Notes & Memory creation.
  - Notifications & Real-time updates (SSE / FCM).

## Shared Backend API Surface
The backend provides a comprehensive set of REST endpoints. The new mobile app MUST consume these existing endpoints:

- **Auth & Settings (`auth_router.py`):**
  - `POST /api/auth/login` - Login.
  - `GET /api/auth/me` - Get current user profile.
  - `POST /api/auth/change-password`, `POST /api/auth/change-username`
  - `PUT /api/settings/workspace-mode`, `PUT /api/settings/reminder-threshold`
- **Tasks & Categories (`tasks_router.py`):**
  - `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/{tid}`, `DELETE /api/tasks/{tid}`
  - `GET /api/task-categories`, `POST /api/task-categories`, `PATCH /api/task-categories/{cat_id}`, `DELETE /api/task-categories/{cat_id}`
  - `GET /api/task-categories/stats`, `GET /api/task-categories/order`, `PUT /api/task-categories/order`
  - `POST /api/tasks/{tid}/attachments/init`, `POST .../chunk`, `POST .../complete`, `GET .../attachments`, `GET .../download`, `DELETE .../{att_id}`
  - `POST /api/tasks/{tid}/subtasks/{sub_id}/promote`, `POST /api/tasks/{tid}/demote-to-subtask`
  - `POST /api/tasks/{tid}/transfer-company`, `GET /api/task-transfer-companies`, `GET /api/orphan-tasks`
- **Team & Notifications (`team_router.py`, `fcm_router.py`):**
  - `GET /api/team/members`, `GET /api/team/summary`
  - `GET /api/notifications`, `POST /api/notifications/read-all`
  - `POST /api/register-token`, `POST /api/unregister-token` (FCM)
- **Chat & Personal (`chat_router.py`, `personal_router.py`):**
  - `POST /api/chat` - Main interaction with AI.
  - `GET /api/conversations`, `GET /api/notes`, `POST /api/notes`
- **Other:** Files (`files_router.py`), Email (`email_router.py`), Admin (`admin_router.py`).

## Data Models & Integrations
- **Database:** MongoDB (via Motor). Models include Tasks, TaskCategories, Users, Companies, Notifications. Data is highly partitioned by tenant/company (`company_id`).
- **Integrations:**
  - Firebase Cloud Messaging (FCM) for push notifications. Requires native handling in Expo.
  - Local Chunked Object Storage for attachments (multipart file uploading).
  - OpenAI (GPT-5.2/Vision/Whisper) via backend for AI.
  - Server-Sent Events (SSE) for real-time syncing.

## Port Requirements (Mobile)
To port the web experience to Expo React Native, build the following:

- **1. Authentication (Login):**
  - *Build:* Expo Router page (`app/index.tsx` or `app/login.tsx`) with username/password inputs.
  - *API:* `POST /api/auth/login`. Store JWT in `SecureStore`.
  - *Notes:* Needs React Native `TextInput`, standard RN keyboard handling.
- **2. Main Hub / Chat Interface:**
  - *Build:* A central screen (`app/(tabs)/index.tsx` or main tab) replicating the AI interaction. Text input, chat history, and potentially a simplified version of the holographic sphere animation (e.g., Lottie or simplified CSS/SVG).
  - *API:* `POST /api/chat`, `GET /api/conversations`.
- **3. Task Management (The core feature):**
  - *Build:* A dedicated Tasks screen (`app/(tabs)/tasks.tsx`). Needs list views for tasks.
  - *Features:* Vertical collapsible tree for task categories, pull-to-refresh, modal for task creation/editing.
  - *API:* `GET /api/tasks`, `GET /api/task-categories`, `PATCH /api/tasks/{tid}`.
  - *Notes:* Replace HTML5 drag-and-drop with `react-native-reanimated` and `react-native-gesture-handler` for sorting. Use `FlatList` for performance.
- **4. Task Attachments (Chunked Uploads):**
  - *Build:* File picker integration within the Task Detail/Edit screen.
  - *API:* The 3-step chunked upload endpoints (`init`, `chunk`, `complete`).
  - *Notes:* Use `expo-document-picker` and `expo-file-system` for reading file chunks before uploading.
- **5. Navigation & Sidebar mapping:**
  - *Build:* Convert the web `Sidebar` tabs into standard mobile navigation patterns (Bottom Tabs via Expo Router for main sections like Chat, Tasks, Team, Notes; and a Drawer or Settings screen for the rest).
- **6. Notifications & Real-time:**
  - *Notes:* Connect to FCM using `expo-notifications`. Set up SSE or polling for the real-time task sync if SSE is unstable in RN.
- **Styling:** Replace Tailwind (unless using Nativewind) with `StyleSheet`. The app has a "dark space theme, neon cyan accents, glassmorphism". Emulate this with semi-transparent views and dark backgrounds. Use `EXPO_PUBLIC_BACKEND_URL`.

## Open Questions / Risks
- **Scope of V1:** Does the mobile app need the full 47-feature roadmap on day one, or just Chat + Tasks? The web UI has complex floating panels, detached windows, and multi-layered hierarchies which are hard to map 1:1 on small screens.
- **Holographic Sphere:** How complex should the central animation be on mobile? (Performance concern).
- **Complex UI paradigms:** Web uses right-click context menus extensively (e.g., for "Demote to subtask"). On mobile, these must be mapped to long-press actions or explicit "⋮" (More) buttons.
- **Real-time (SSE):** React Native support for raw EventSource/SSE can be flaky. Are we bringing in a polyfill or switching to WebSockets/polling on mobile?
