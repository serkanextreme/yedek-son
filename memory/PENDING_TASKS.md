# Bekleyen İstekler — ✅ HEPSİ TAMAMLANDI (2026-06 · fork)

Kullanıcı: "hepsini yap hiçbirseyi bozma". Task 4 netleştirme → seçenek (a) sürüklenebilir yüzen pencere.
testing_agent iteration_80: Backend 5/5 pytest, Frontend %100 (TASK 1/1b/2/4), TASK 3 UI + persist. Sıfır bug.

## 1) Görev kartı Küçült/Büyüt (collapse/expand) — ✅ DONE
- Kart başlığında ▲/▼ (task-collapse-{id}). Küçültünce SADECE alt görevler + "alt görev ekle" gizlenir; açıklama/kategori kalır.
- Küçük özet ipucu (task-collapsed-hint-{id}). localStorage: `sertex_collapsed_task_ids`.
- Panel üstünde "Tümünü Küçült / Büyüt" (task-collapse-all).

## 2) Bildirim silme (NotificationBell) — ✅ DONE (önceki ajan)
- Hepsini Sil (notification-delete-all), tek tek (notification-delete-{id}), seçerek (notification-select-toggle + notification-delete-selected).
- Backend: DELETE /api/notifications, DELETE /api/notifications/{nid}, POST /api/notifications/delete-selected (team_router).

## 3) Tekrarlı hatırlatma — ✅ DONE (önceki ajan)
- Aralık + kaç defa (ctx-reminder-repeat). Model: reminder_interval_min / reminder_repeat_left / reminder_repeat_total.
- İstemci tarafı reschedule (tasksApi.rescheduleReminder); görev done olunca durur. NOT: sunucu tarafı FCM recurring loop YOK (mevcut mimari istemci-taraflı hatırlatma).

## 4) Görevi sidebar dışına büyük pencerede açma (detach) — ✅ DONE
- Maximize butonu (task-detach-{id}) → büyük sürüklenebilir + boyutlandırılabilir yüzen pencere (detached-task-window-{id}, react-rnd + createPortal).
- Listede yer tutucu (task-detached-placeholder-{id}) + "GERİ AL" (task-redock-{id}); pencere başlığında "SIDEBAR'A GERİ AL" (detached-task-dock-{id}).
- Detach durumu + pencere konum/boyutu **localStorage'da kalıcı** (Görev Karşılaştırma Masası — reload'da geri gelir). Mevcut drag-reorder bozulmadı.

## Opsiyonel / gelecek polish (testing_agent önerileri)
- notification testid isimlerini spec'e hizala (kozmetik).
- TasksPanel.jsx ~3100 satır — detach/collapse/reminder ayrı hook/dosyalara bölünebilir.
- delete-all için sayfa içi onay adımı.

## ✅ TAMAMLANDI — Backlog batch b/c/d + e/f doğrulama (2026-06)
Kullanıcı: "chat E-posta hariç hepsini yap, hiçbir şeyi bozma, çok dikkat et".
- **b) Admin Chat Prompt Editörü** — Ayarlar > "SERTEX PROMPT" sekmesi (admin). TR/EN textarea + Kaydet + Varsayılana Döndür. Backend: `GET/PUT /api/admin/chat-prompt` (admin-only), chat_router `_resolve_base_prompt` system_settings.global'den okur, boşsa varsayılan. Dosyalar: ChatPromptEditor.jsx, admin_router.py, chat_router.py.
- **c) Dürt / Hatırlat** — Personel Görevleri'nde done olmayan kartlarda amber çan (`task-nudge-{id}`). `POST /api/tasks/{id}/nudge` → sahibe `task_nudge` bildirimi (çan+SSE+FCM best-effort). Tekrarlanabilir (task_id=None, payload.task_id). Guard: self-nudge 400, göremediğin sahip 403/404. NotificationBell'de "⏰ X hatırlattı" + tıkla→göreve git. Dosyalar: team_service.py (notify_task_nudge), tasks_router.py (nudge endpoint), tasks_models.py (TaskNudgeRequest), NotificationBell.jsx, api.js.
- **d) İş Kolu Combobox** — Yeni görev formundaki eski `<select>` → koyu, aranabilir, kaydırmalı combobox (`task-category-select` + -panel/-search/-option-*). Dosya: tasks/CategorySelect.jsx.
- **e) Kategori-bazlı raporlama** — ZATEN VARDI (TeamPanel "İŞ KOLU PERFORMANSI" grid, `GET /api/team/category-summary`). Doğrulandı.
- **f) Masaüstü push + ses** — ZATEN VARDI (desktopNotifier.js + NotificationBell pref paneli: enable/sound). Doğrulandı.
- **Test**: `/app/test_reports/iteration_81.json` — Backend 8/8 pytest, Frontend b/c/d/f %100, e doğrulandı. Sıfır bug, hata sınırı yok. Prompt testten sonra boşa sıfırlandı. Yeni test: `backend/tests/test_prompt_and_nudge.py`.
- **NOT (önemli)**: Değişiklikler preview'da. Canlı `sertex-ai.com` için YENİDEN YAYIN gerekli.
- Kalan (opsiyonel, kullanıcı istemedi): a) Chat E-posta Intent.
- Kozmetik öneri (testing): ses toggle'ı OS izni reddedilse bile gösterilebilir (ses OS izni gerektirmez).

## ✅ TAMAMLANDI — Kart boyut hatası + detached kart resize (2026-06)
- **↺ Boyutu Sıfırla butonu (A)**: Kart elle boyutlandırılınca başlıkta her zaman görünen (hover'a bağlı DEĞİL) küçük ↺ butonu (`task-reset-size-{id}`) → tek tıkla varsayılana döner, sonra gizlenir. Boyutlandırılmamış kartlarda görünmez (kalabalık olmasın). resetSize `setSavedSize(null)` de yapar.
- **Fix (sidebar genişlik/yükseklik kaybı)**: Elle boyutlandırılan kart, küçült/büyüt yeniden-çiziminde daralıyordu. Kök neden: `savedSize` state elle resize'da güncellenmiyordu → React inline genişliği siliyordu. Çözüm: ResizeObserver'da `setSavedSize` ile state senkronu + `savedSizeRef` guard (loop yok) + küçükken boyut yakalama atlanır. Test: 320×240 → küçült → büyüt → 320×240 korundu.
- **Enhancement (büyük/detached pencere)**: İçteki görev kartı artık `resize: both` (yukarı-aşağı + sağ-sol). Ayrı `sertex_task_dsize_{id}` anahtarı → sidebar boyutuyla (`sertex_task_size_{id}`) çakışmaz.
- Dosya: TasksPanel.jsx (TaskCard sizeKey/savedSize/RO/resetSize + motion.div style). Ekran görüntüleriyle doğrulandı; hata sınırı yok, regresyon yok.

## ✅ TAMAMLANDI — Dürt "Cooldown + Sayaç" (2026-06)
- Backend: `task_nudges` koleksiyonu + index. Nudge endpoint'e 60 sn cooldown (aynı yönetici+görev) → 429 "Az önce hatırlattınız — N sn sonra". Yanıt `count_today` + `cooldown_seconds` döner.
- Frontend: Dürt butonunda amber sayaç rozeti (`task-nudge-count-{id}`), başarı toast'ı "bugün N. kez", 429'da uyarı toast'ı. Dosyalar: tasks_router.py (cooldown+count), team_service.ensure_indexes, TasksPanel.jsx (nudgeCounts + rozet).
- Test: test_prompt_and_nudge.py güncellendi (cooldown 429) — 8/8 geçti. UI: badge=1 + cooldown toast doğrulandı. Test verisi temizlendi.

## 📌 Backlog — Yönetici "Geciken Görevler" özet paneli + toplu Dürt (P2, "sonraya ekle")
- Tek ekranda tüm geciken personel görevlerini personele göre grupla; seçilenlere/tümüne tek tıkla toplu "Dürt" (cooldown'a saygılı).
- Dosyalar: TeamPanel.jsx, tasks_router.py (opsiyonel toplu-nudge), team_service.notify_task_nudge.

## 📌 Backlog — Dürt "Cooldown + Sayaç" (P2, kullanıcı 2026-06'da onayladı, "sonraya ekle")
- Dürt butonunda "kaç kez dürtüldü" sayacı + son dürtme zamanı; aynı göreve kısa cooldown; yöneticiye "bugün N kez hatırlattın" görünürlüğü.
- Dosyalar: tasks_router.py (nudge cooldown), team_service.notify_task_nudge (meta), TasksPanel.jsx (buton rozeti).
- Detach pencerelerinin konum + boyutu localStorage'a kaydedilir (`sertex_detached_task_geom_v1`).
- Hangi görevlerin dışarı alındığı da kalıcı (`sertex_detached_task_ids_v1`) → reload'da masa geri gelir.
- Çoklu görev aynı anda yan yana açık (detachedIds Set). Dock/GERİ AL → LS temizlenir.
- Dosya: TasksPanel.jsx > DetachedTaskWindow + loadDetachedGeom/saveDetachedGeom + detachedIds persistence.

## ✅ TAMAMLANDI — Sistem Audit P2 (2026-06)
- **CORS**: `CORS_ORIGINS` artık açık origin listesi (sertex-ai.com + www + preview); app-katmanı doğrulandı (izinli→ACAO var, yasak→yok). NOT: preview ingress hâlâ edge'de `*` ekliyor (altyapı, uygulama dışı).
- **JWT süresi**: 30 gün → **7 gün**, `JWT_EXPIRE_HOURS` env ile ayarlanır (auth.py). Payload değişmedi, mevcut token'lar geçerli kalır.
- **Silent catch**: frontend api.js interceptor'a merkezî hata loglama; backend'e global `@app.exception_handler(Exception)` (yakalanmayan hatalar loglanır + monitoring sayacına düşer). Backend `as e` blokları zaten logluyordu; kasıtlı fallback'ler dokunulmadı.
- Regresyon: backend seri pytest 50 passed/1 skipped; frontend derleme temiz.
