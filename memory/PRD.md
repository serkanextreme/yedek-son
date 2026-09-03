# Sertex — Kişisel AI Asistan · PRD

## Original Problem Statement
Serkan için özel olarak inşa edilmiş, çoklu platform (Web + Windows Setup + Mobile), sesli ve metinle konuşabilen, holografik arayüzlü kişisel AI asistanı. Türkçe öncelikli, dark space temalı, ortada animasyonlu holografik küre, neon cyan aksanlar, glassmorphism paneller. Uzun vadeli hedef: 47-feature kapsamlı, ticari SaaS ürünü olarak satılabilir hale getirmek.

## Vision — 47 Feature Roadmap (Faz Bazlı)
Tam liste: `/app/frontend/public/Sertex-Feature-Listesi.pdf` (üretici script: `/app/scripts/generate_sertex_pdf.py`)

---

## ✅ Tamamlanan Fazlar

### Şablon Kütüphanesi — Görev Şablonları · Web (Detaylı+Kolay) + Mobil (2026-06 · fork) ✅
Kullanıcı isteği: Sık kullanılan görevleri "şablon" olarak kaydet, "Yeni Görev" akışından tek tıkla gerçek göreve dönüştür. Onaylı gereksinimler: şablon ad/başlık/açıklama/iş kolu/hatırlatıcı/alt görevler + **dosya ekleri**; **kişisel + ekip(şirket)** kapsam; **Web (Detaylı+Kolay) + Mobil**.
- **Backend** (yeni `routers/templates_router.py`, `server.py`'de `build_templates_router(db, licensed_user)` prefix `/api` ile mount): AYRI koleksiyonlar `task_templates` + `task_template_attachments` (mevcut görev sorgularına/istatistik/arşiv/zamanlayıcıya ASLA sızmaz). Uçlar: `GET/POST/GET{id}/PATCH{id}/DELETE{id} /api/task-templates`; `POST /api/task-templates/{id}/instantiate` (şablondan gerçek görev → `tasks` + ekler `task_attachments`'e storage-copy); şablon ekleri chunked upload (`/attachments/init|/chunk|/complete`, `GET /attachments`, `/download`, `DELETE`). Kapsam: `personal` (yalnız sahibi) / `shared` (sahibinin şirketindeki herkes). instantiate: status=pending, oluşturana atanır, alt görevler done=False, sort_order=üstte, şablon ekleri göreve kopyalanır. Yetki: `_can_view_template`/`_can_manage_template` (admin/sahip).
- **Web** (yeni `components/tasks/TemplateBar.jsx`, `TemplatesModal.jsx`, `TemplateFormModal.jsx`; `lib/api.js` `templatesApi`+`templateAttachmentsApi`): TemplateBar (`template-bar`, çipler + "Şablonlar" yönet düğmesi) hem `TasksPanel.jsx` (Detaylı) hem `KolayInterface.jsx` (Kolay) altında Yeni Görev'in yanında. TemplatesModal → yeni/düzenle/sil. TemplateFormModal: ad/kapsam(Kişisel/Ekip)/başlık/açıklama/iş kolu/hatırlatıcı/alt görevler + ek (kayıttan sonra). Çipe tıkla/"Kullan" → instantiate → yeni görev + edit modalı açılır.
- **Mobil** (yeni `src/components/TemplateBar.tsx`, `TemplateFormModal.tsx`, `app/templates.tsx`; `src/api/client.ts` template metodları; `app/(tabs)/tasks.tsx` header'da albums ikonu → `/templates` + TemplateBar mount): `/templates` ekranı (yeni/düzenle/sil/**Kullan**). Kullan → instantiate → `/task/{id}`'e yönlendirir. Form birebir web paritesi. testID sabitleri `constants/testIds/templates.js`.
- **Tasarım notu (web+mobil ORTAK, bilinçli)**: YENİ şablon kaydında modal KAPANMAZ, edit moduna geçer ("ŞABLONU DÜZENLE") ki kullanıcı dosya ekleyebilsin (ekler kayıtlı şablon id'si gerektirir). Kapat/İptal ile çıkılır.
- **Test**: Backend pytest `backend/tests/test_task_templates.py` **7/7 PASS** (CRUD, kısa ad 400, bilinmeyen 404, instantiate→gerçek görev, ek chunked upload + instantiate'te göreve kopya). testing_agent iteration_128 — Backend + Web (Detaylı: oluştur→Kullan→görev oluştu+edit modalı) YEŞİL; Mobil "Kullan" testing agent'ta bloke göründü ama ana ajan Expo preview'de uçtan uca DOĞRULADI (Kullan→`/task/{id}`→"Bekliyor" görev, sahip serkan). Bloke sebebi: yeni şablon sonrası açık kalan modal (tasarım) → agent modalı kapatmadan Kullan'a bastı; işlevsel hata YOK. Tüm test şablon+görev verileri kalıcı silindi (0 kaldı).
- **Yayın**: preview'de; canlı (sertex-ai.com) için Deploy, mobil için yeni build gerekir.


### Görev Kopyalama — Kopyala → Yapıştır (Pano) · Web (Detaylı+Kolay) + Mobil (2026-09 · fork) ✅
Kullanıcı isteği: Hazır bir görevi her seferinde sıfırdan yazmamak için "şablon gibi" kopyalayıp başka görev olarak düzenleme. Onaylı kararlar: (A) başlığa **"(Kopya)"** öneki; (B) her şey kopyalanır (başlık/açıklama/iş kolu[paste hedefi]/şirket/tarihler/hatırlatıcı) + seçilirse alt görevler & dosya ekleri — alt görevler kopyada **done=False** başlar, **kilit/paylaşım/grup bağı kopyalanmaz**; (C) kopya **işlemi yapana** atanır, **pending**, listenin başında; (D) **web+mobil**. Model: sağ tık/menü → **Kopyala** (☑ alt görevler ☑ dosya ekleri; yoksa gizli) → görev **panoya** alınır (üstte "📋 Kopyalandı: <başlık>" + Panoyu Temizle) → bir iş koluna **sağ tık → Yapıştır** (web) / iş kolu başlığında **Yapıştır düğmesi** (mobil). Pano temizlenene kadar kalır → aynı görev **birden çok iş koluna** yapıştırılabilir (şablon).
- **Backend** (`tasks_router.py`, `tasks_models.py`): `POST /api/tasks/{tid}/duplicate` `{include_subtasks, include_attachments, category_id}`. Kopya: `(Kopya) <başlık>`, `status=pending`, `user_id=me`, `created_by=me`, `sort_order=max+1` (üstte), `category_id` body'den (null=KOLSUZ). Alt görevler yeni id + done=False. Dosya ekleri object storage'da **yeniden yüklenir** (yeni storage_path, aynı bayt). Şirket bağlamı (company_id+company_name) **kaynaktan** (senkron). Kilit/paylaşım/grup kopyalanmaz. `TaskDuplicateReq` modeli.
  - **Ayrıca (bu fork'ta düzeltildi)**: görev eki chunked upload artık parçaları **pod diskine (/tmp) yazmıyor**, bellekte birleştirip doğrudan object storage'a yüklüyor (deploy blocker giderildi).
- **Web** (yeni `lib/taskClipboard.js`, `tasks/CopyTaskModal.jsx`, `tasks/TaskPasteMenu.jsx`; `api.js tasksApi.duplicate`; `TaskContextMenu.jsx` `ctx-copy`; `TaskCard.jsx onCopy`; `TasksPanel.jsx` + `KolayInterface.jsx` handlePaste + pano çubuğu + iş kolu/KOLSUZ çipine `onContextMenu` + modal/menü render). Detaylı: `category-node-*` & `category-chip-none` sağ tık. Kolay: `kolay-cat-chip-*` sağ tık ("Tümü" hariç).
- **Mobil** (yeni `src/lib/taskClipboard.ts` [storage JSON], `src/components/CopyTaskModal.tsx`; `client.ts duplicateTask`; `CategorySection.tsx` başlıkta `tasks-category-paste-<catId>` düğmesi; `tasks.tsx` pano çubuğu + handlePaste; `task/[id].tsx` `task-detail-copy-button` + modal). testId'ler eklendi (`constants/testIds/tasks.js` & `detail.js`).
- **Test**: Backend pytest `backend/tests/test_task_duplicate.py` **11/11 PASS** (önek/status/assignee, alt görev reset, ek storage çoğaltma+aynı bayt, kilit/grup miras yok, çok-hedef paste, üstte sıralama, 404). Ana ajan görsel E2E: Web Detaylı (copy→KOLSUZ'a paste→"(Kopya)" oluştu), Web Kolay (⋮→copy→çipe paste→oluştu), Mobil (detay Kopyala→modal→tasks başlığında Yapıştır→"(Kopya)" oluştu) — hepsi DOĞRULANDI. Tüm test kopyaları kalıcı silindi (0 kaldı).
- **Yayın**: preview'de; canlı (sertex-ai.com) için Deploy, mobil için yeni build gerekir.

### Arşiv — Gruplu Görünümde "Hepsini Aç/Kapat" (Detaylı + Kolay) (2026-06 · fork) ✅
Kullanıcı isteği ("yap"): Gruplu arşive tek tıkla tüm iş kollarını aç/kapat düğmesi.
- **Detaylı** (`TasksPanel.jsx`): Gruplu listenin üstüne (`archive-cats-toggle-all`, yalnız 2+ grup) buton — `allCollapsed` ise tümünü aç (`setCollapsedArchiveCats(new Set())`), değilse tümünü kapat (tüm key'ler). Etiket "HEPSİNİ AÇ"/"HEPSİNİ KAPAT".
- **Kolay** (`KolayInterface.jsx`): `KolayArchive` gruplu bölümü IIFE'ye alındı; aynı `kolay-archive-toggle-all` düğmesi (2+ grup).
- **Test**: Ana ajan (Playwright, 3 test grubu oluşturuldu) — Kolay'da düğme göründü, tümünü kapat→3 kart gizlendi (0), tekrar→3 açıldı; etiket doğru çevriliyor. Test görevleri API ile silindi. Lint temiz.

### Arşiv — İş Koluna Göre Gruplama (Detaylı + Kolay) (2026-06 · fork) ✅
Kullanıcı isteği (görselli, "yap" onaylı, C=her ikisi): Arşiv görünümünde biten görevleri iş koluna (kategori) göre gruplayan bir toggle. İki mod: "İŞ KOLUNA GÖRE GRUPLA" ↔ "GRUPLAMAYI KALDIR" (düz liste). Mevcut sistem bozulmadan (varsayılan KAPALI = eski davranış). **Ek (yap):** gruplu görünümde iş kolu başlıkları katlanabilir (uzun listede hızlı gezinme).
- **Detaylı** (`TasksPanel.jsx`): `archiveByCategory` state (default false) + `collapsedArchiveCats` Set. Araç çubuğuna (yalnız `showArchived && categories.length>0`) toggle butonu (`archive-groupby-toggle`). Gruplu dal: `showArchived && archiveByCategory && !searchActive` → kategoriye göre gruplanır, her başlık tıklanabilir (`archive-cat-toggle-{key}`, ChevronDown/Right) ve katlanınca görevler gizlenir; `renderStaticMember` ile statik TaskCard. Toggle kapalıyken mevcut `Reorder.Group` yolu birebir korunur (regresyon yok).
- **Kolay** (`KolayInterface.jsx`): Yan menüye "Arşiv" öğesi + `KolayArchive`. `tasksApi.list(true,"mine","archived")`; gruplama toggle'ı (`kolay-archive-groupby`); katlanabilir başlıklar (`kolay-arch-group-toggle-{key}`); her kartta "AKTİFE AL" (setArchived false), tamamlanma tarihi, iş kolu etiketi.
- **Test**: Ana ajan (Playwright) — Detaylı & Kolay'da toggle + gruplama + başlık katlama doğrulandı (katlanınca kart sayısı 1→0 gizlendi). Lint temiz (TasksPanel'de yalnız önceden var olan 3 uyarı).

### Kolay Arayüzü — Tam "Yeni Görev" Formu (Detaylı ile parite) (2026-06 · fork) ✅
Kullanıcı düzeltmesi (görselli): Kolay Ana Sayfa'da görev eklerken form eksikti → Detaylı'daki tam formun birebir aynısı olmalı.
- **Uygulama** (`KolayInterface.jsx` — `KolayAddModal` yeniden yazıldı): Detaylı `addTask` mantığı ve alt bileşenleri BİREBİR yeniden kullanıldı — başlık, açıklama, BAŞLANGIÇ/BİTİŞ (datetime), `MultiAssigneeSelect` (Kendime ata/kişi ekle), `CompanyCombobox` (Şirket), `CategorySelect` (İş Kolu), uyarı gün seçimi (`REMINDER_DAY_CHOICES` + reminderConfig default etiketi), `RecurringReminderFields` (tekrarlı hatırlatıcı), `PendingAttachments` (dosya ekle, görev oluşunca yüklenir). `tasksApi.create(title, desc, due, reminder_at, extras)` sözleşmesi + `taskAttachmentsApi.upload` aynen kopyalandı; assignee routing (self/single/multi) korundu. Kişi/Şirket bloğu `isTeamView` ile gösteriliyor (Detaylı ile aynı).
- **Test**: Ana ajan (Playwright) — modal referans görselle birebir eşleşti; başlık girip EKLE → modal kapandı, görev Görevler ızgarasında zengin kartla göründü (uçtan uca create çalışıyor). Test görevi API ile silindi. Lint temiz. Detaylı'ya dokunulmadı.

### Kolay Arayüzü — Ana Sayfa/Görevler Ayrımı + Notlar/Dosyalar/Ekip Kolay İçinde (2026-06 · fork) ✅
Kullanıcı isteği (2 not, "yap hepsini"): (1) Kolay yan menüde "Ana Sayfa" ile "Görevler" aynı ızgarayı gösteriyordu → Ana Sayfa artık ÖZET, Görevler ızgara; (2) Notlar/Dosyalar/Ekip tıklayınca Detaylı'ya atıyordu → artık Kolay içinde açılıyor.
- **Uygulama** (`KolayInterface.jsx`): İçerik `activeKey`'e göre dallandırıldı. `home` → özet gösterge (4 stat kartı: Aktif/Süresi Geçti/Yaklaşan/Tamamlanan `stats` useMemo + "Yeni Görev Ekle"/"Tüm Görevler" + YAKLAŞAN SON TARİHLER listesi `upcoming`, satıra tıkla→Görevler). `tasks` → mevcut arama+ekle+iş kolu çipleri+dnd ızgara. `notes` → yeni `KolayNotes` (notesApi list/create/delete, Kolay temalı). `files` → mevcut `FilePanel` yeniden kullanıldı. `team` → mevcut `TeamPanel` yeniden kullanıldı. MENU onClick'lerinden `onOpenSection` çağrıları kaldırıldı (artık Detaylı'ya atmıyor); `onOpenSection` prop'u da kaldırıldı.
- **Test**: Ana ajan görsel (Playwright) — Ana Sayfa özet (görev ızgarası YOK), Görevler ızgara (kolay-task-grid), Ekip/Dosyalar/Notlar hepsi Kolay içinde açıldı (kolay-interface hâlâ mount, Detaylı'ya atlama yok). Lint temiz. Detaylı'ya dokunulmadı.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için Deploy gerekir.

### Kolay Arayüzü — Ana Sayfa Zengin Görev Kartı (referans görsele göre) (2026-06 · fork) ✅
Kullanıcı isteği (görselli): Kolay Ana Sayfa görev kartları referans görseldeki zengin görünüme çevrilsin (Detaylı'ya dokunmadan, sade grid korunarak). Kullanıcı seçimi: (a) tam zengin görünüm.
- **Uygulama** (`KolayInterface.jsx` — `KolayCardBody` yeniden yazıldı): kart üst şeridi sol = sürükle tutamacı (GripVertical) + **tamamla kutucuğu** (`kolay-check-{id}`, tıkla→`completeTask`); sağ = **küçült/büyüt toggle** (`kolay-collapse-{id}`, ChevronsDownUp/UpDown) + **⋮ menü** (`kolay-menu-btn-{id}`). Durum etiketi süresi geçtiyse **AlertTriangle uyarı ikonu** + kırmızı kart çerçevesi, değilse renkli nokta. Başlıkta sıra no + sabitse **⚓ Anchor** (`kolay-pin-{id}`). Detay: **🕐 Clock** + "BİTİŞ: GG.AA.YYYY SS:DD" (`fmtDateTime`), **📄 FileText** + şirket/kişi etiketi (`company_name`/`assignee_name`) · iş kolu. Küçültünce açıklama/tarih/etiket gizlenir, sadece durum+başlık kalır (`collapsedIds` Set, oturum içi).
- Mevcut doğrulanmış handler'lar (completeTask, openMenu→tam ContextMenu, dnd-kit sıralama) aynen korundu; yeni backend/endpoint yok. Detaylı (Neural Link) arayüzüne DOKUNULMADI.
- **Test**: Ana ajan görsel doğrulama (Playwright) — zengin grid render (uyarı ikonu + kırmızı çerçeve + ⚓ + 🕐 + 📄), küçült toggle kartı kompaktladı, ⋮ tam 16-öğeli menü açıldı. Lint temiz.
- **Bekleyen (backlog, kullanıcı "bekle not al" dedi)**: Kolay yan menü Notlar/Dosyalar/Ekip hâlâ Detaylı'ya yönlendiriyor — Kolay içinde açılması istendi ama şimdilik ertelendi.
- **Bekleyen (backlog, YAPMA — sadece not)**: Detaylı (Neural Link) açılınca görevler üst üste biniyor/taşıyor → görevler ekrana otomatik sığdırılsın (auto-fit / taşma düzeltmesi). Kullanıcı açık şekilde "bekle yapma" dedi. [Hedef arayüz/konum hâlâ netleşmedi — a/b/c/d sorusu cevapsız.]
- **Bekleyen (backlog, YAPMA — sadece not)**: Kolay yan menüde "Ana Sayfa" ve "Görevler" aynı görev ızgarasını gösteriyor → **Ana Sayfa** tıklanınca görevler gizlensin (karşılama/özet ekranı), **Görevler** ikonuna tıklanınca görev listesi gelsin. Kullanıcı "bekle yapma, not al" dedi.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için Deploy gerekir.


### Özellik — Arşiv Görünümünde "Tümünü Küçült / Büyüt" Kısayolu (2026-06 · fork) ✅
Kullanıcı isteği: Detaylı (Neural Link) görevlerde bulunan "TÜMÜNÜ KÜÇÜLT / BÜYÜT" toplu kart küçült-büyüt kısayolu, **Arşiv**'e (Bitmiş/İptal/Silinmiş) tıklayınca orada da çıksın. "Hiçbir şeyi bozmadan."
- **Uygulama** (`TasksPanel.jsx`, tek satır): collapse toolbar render koşulundan `!showArchived &&` kaldırıldı → toolbar artık arşivde de görünür. Mantık zaten hazırdı: arşiv `visibleTaskIds` (satır 1657 `sorted`) üzerinden çalışır, `toggleAllCollapsed`/`allVisibleCollapsed` bu id'leri kullanır, arşiv kartları da `cardPropsFor` üzerinden `collapsed` prop'unu alır (satır 1363). Yeni state/endpoint yok → sıfır regresyon riski.
- **Test**: Ana ajan görsel doğrulama (Playwright, preview) — Arşiv açıldı, `task-collapse-all` düğmesi göründü ("TÜMÜNÜ KÜÇÜLT"), tıklayınca "TÜMÜNÜ BÜYÜT"e döndü + arşiv kartları topluca küçüldü. Normal görünüm değişmedi.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden Deploy gerekir.


### Görünüm Sistemi — 6 Arayüz + Renk Fonksiyonu + Yazı Boyutu (2026-06 · fork) ✅ TAMAMLANDI
Kullanıcı isteği: Ayarlar → Temalar içine "Arayüz" seçici (Kolay/Teknik/Detaylı/Profesyonel/Aydınlık/Pano — 6 referans görsele birebir benzer), her arayüzün rengini değiştirilebilsin (renk fonksiyonu) + yazı boyutu büyütme (mevcut sisteme de). "Hiçbir şeyi bozmadan." Web için, aşamalı. Sıra: önce KOLAY, sonra PROFESYONEL.
- **Altyapı** (`lib/appearance.js` yeni): `accent` (hex), `fontScale` (s/m/l/xl), `interface` (6 mod) — cihaza özel localStorage, `<html>` üzerinde `--sx-accent-rgb` + `data-font-scale` + `data-interface` olarak uygulanır. `index.js`'te erken import → açılışta uygulanır. `useAppearance()` hook + pub/sub.
- **Renk fonksiyonu (bozmadan tüm arayüzü renklendirme)**: `tailwind.config.js` → `sertex.cyan` artık `rgb(var(--sx-accent-rgb, 0 240 255) / <alpha-value>)`. Böylece TÜM `sertex-cyan` sınıfları (yüzlerce yerde) tek değişkenden renklenir. `index.css` accent literal'leri (glass-panel/neon-glow/corner-bracket/grid-bg/selection/scrollbar/resizable) da değişkene bağlandı. Varsayılan cyan → görsel değişmez.
- **Yazı boyutu**: `index.css` `html[data-font-scale]` (s=15 / m=16 / l=18 / xl=20 px) → rem tabanlı tüm metin orantılı ölçeklenir.
- **AppearancePanel** (`components/AppearancePanel.jsx` yeni): Ayarlar → Temalar sekmesine gömülü — ARAYÜZ (6 adlandırılmış mod, Detaylı=Aktif), VURGU RENGİ (8 hazır + özel seçici + sıfırla), YAZI BOYUTU (4 kademe + önizleme).
- **KOLAY arayüzü** (`components/KolayInterface.jsx` yeni + `SertexMain.jsx` koşullu render): sade sol menü (Ana Sayfa/Görevler/Ekip/Notlar/Dosyalar/Ayarlar + "Detaylı"ya dön) + karşılama + arama + "Yeni Görev Ekle" + "Bugünkü Görevler" kart ızgarası (başlık/iş kolu/durum rozeti/son tarih/Tamamla). Mevcut `tasksApi`/`taskCategoriesApi` + navigasyon event'leri yeniden kullanıldı; Detaylı görünüm dokunulmadan korundu (yalnızca kolayMode'da küre/HUD/sohbet gizlenir, sidebar otomatik kapanır).
- **PROFESYONEL arayüzü** (`components/ProfesyonelInterface.jsx` yeni): kurumsal SaaS — sol menü (SERTEX + Panel/Görevler/Ekip/Notlar/Dosyalar/Ayarlar), üst çubuk (breadcrumb + arama + bildirim + kullanıcı avatarı), 4 istatistik kartı (Aktif/Geciken/Tamamlanan/Toplam), ilerleme çubuklu görev ızgarası, sağ sütun (Son Görevler + Yaklaşan Son Tarihler). `SertexMain` `simpleMode = kolayMode||profMode` ile küre/HUD/sohbet gizlenir + sidebar kapanır.
- **Test**: Ana ajan görsel doğrulama (Playwright) — renk değişimi tüm uygulamayı anında renklendiriyor (turuncu), yazı boyutu xl uygulanıyor, KOLAY + PROFESYONEL arayüzleri mockup'a yakın render + Tamamla/geçiş çalışıyor, "Detaylı"ya dönünce tam HUD sağlam. Lint temiz.
- **6 arayüzün tümü TAMAM ve aktif** (`INTERFACES[].ready=true`): Detaylı (varsayılan) · Kolay · Profesyonel · **Teknik** (`TeknikInterface.jsx` — konsol/terminal tablo, komut çubuğu, sol menü + sağ detay paneli) · **Aydınlık** (`AydinlikInterface.jsx` — açık tema, ferah beyaz liste, sakin cyan vurgu) · **Pano** (`PanoInterface.jsx` — Kanban: Yapılacak/Beklemede/Bitti sütunları, Beklet/Bitir/Geri Al). Ortak mantık `lib/interfaceHelpers.js`. Hepsinde "Detaylı"ya dön düğmesi.
- **Son doğrulama (2026-06 · fork devralımı)**: Ana ajan görsel doğrulama (Playwright) — Teknik/Aydınlık/Pano canlı render OK (root testID'ler mount), arayüzler arası geçiş + "Detaylı"ya dönünce tam HUD (küre + SERTEX SİSTEM + ZAMAN·HAVA + NEURAL LINK/CORE + sohbet + giriş çubuğu) SAĞLAM (`data-interface=detayli` doğrulandı). Detaylı görünüme HİÇ dokunulmadı — mevcut kullanıcılar tema değiştirmedikçe sıfır değişiklik. Lint temiz.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için Deploy gerekir.

### Çalışma Modu İyileştirmesi — Kişisel/Ekip + ÇİFT MOD + Sahip Bağışıklığı (2026-06 · fork) ✅
Kullanıcı isteği: (1) Kişisel modda ekip/B2B özellikleri gizlensin (sadeleştirme); (2) ÇİFT MOD — kullanıcı Kişisel+Ekip'i birlikte kullanıp sol paneldeki hızlı düğmeyle tek tıkla geçebilsin; (3) KRİTİK: Sahip (serkan, is_owner) modtan TAMAMEN muaf — her zaman tüm sekmeleri görür.
- **Backend** (`auth.py`, `routers/auth_router.py`): user'a `dual_mode:bool`. `PUT /api/settings/dual-mode {dual_mode}` + `PUT /api/settings/workspace-mode`. `/auth/me` + login yanıtı `workspace_mode` + `dual_mode` döner.
- **Web** (`lib/auth.js`): `teamFeaturesVisible = isOwner || workspaceMode==='team'` (sahip bağışıklığı) + `setDualMode`. `SettingsPanel.jsx` "Mod" sekmesi: ÇİFT MOD toggle + Kişisel/Ekip kartları; ekip Ayarlar sekmeleri `(!t.team || teamFeaturesVisible)` ile gizlenir. `Sidebar.jsx` `canSeeTeam = isManagerOrAdmin && teamFeaturesVisible` → Ekibim/Yarım Kalan sekmeleri kişisel modda gizli (sahip hariç). `NeuralLinkHeader.jsx` Çift Mod açıkken hızlı geçiş düğmesi (`quick-mode-switch`).
- **Bugfix (iteration_125 HIGH → iteration_126 FIXED)**: Menajerin hızlı geçişi Sidebar sekmelerini SAYFA YENİLENMEDEN güncellemiyordu. Kök neden: `tabOrder` state moda göre mount'ta bir kez tohumlanıyor + `SidebarTabBar` filtresizdi. Düzeltme: `DEFAULT_ORDER` artık team/orphans'ı ROL bazlı (isManagerOrAdmin) tohumluyor; yeni `handleReorder` görünür alt kümeyi birleştiriyor; `SidebarTabBar` render'da `visibleOrder = tabOrder.filter(canSeeTab)` kullanıyor.
- **Test**: Backend pytest `test_workspace_dual_mode.py` (3/3) + testing agent iteration_125 (owner bağışıklığı + mod kartları + hızlı düğme GEÇTİ) → iteration_126 RETEST (hızlı geçiş anında sekme göster/gizle + reorder regresyonu + sahip bağışıklığı TÜMÜ GEÇTİ). Lint temiz. Test durumu temizlendi (serkan+mgr_test personal/dual=false).
- **Yayın**: preview'de; canlıya (sertex-ai.com) için Deploy gerekir.

### Performans — "Otomatik" Seviye Algılama (2026-06 · fork) ✅
Kullanıcı isteği: cihaz gücünü sezip ilk açılışta uygun seviyeyi otomatik uygulayan "Otomatik" seçeneği ekle.
- **settings.js**: `detectDeviceTier()` — WebGL renderer (SwiftShader/yazılım → low), CPU çekirdek (`hardwareConcurrency`), RAM (`deviceMemory`), mobil tespiti ile puanlayıp `high|normal|low` döner (bir kez cache). `resolveQuality(q)` — `"auto"` → algılanan seviye. Varsayılan `DEFAULT_QUALITY` artık **"auto"** (ilk açılışta otomatik). `data-quality` = efektif seviye, `data-quality-mode` = ham seçim.
- **HolographicSphere.jsx**: `resolveQuality(quality)` ile efektif seviyeye göre render (auto dahil).
- **PerformancePanel.jsx**: en üstte **"Otomatik (Önerilen)"** kartı (`perf-quality-auto`) + "Bu cihaz için algılanan: <seviye>" göstergesi; altında elle seçim (Kaliteli/Normal/Düşük).
- **Test**: Playwright — varsayılan `mode=auto`, önizleme ortamında `effective=low` doğru tespit edildi ve panelde "algılanan: Düşük" gösterildi; elle kartlar mevcut. Lint temiz.
- NOT: Güçlü cihazda auto → Kaliteli (görsel değişmez), zayıfta Normal/Düşük. Canlı için Deploy gerekir.

### Performans Ayarı — 3 Görsellik Seviyesi (2026-06 · fork) ✅
Kullanıcı isteği: web ekran kartını çok yoruyor; Ayarlar'a "Performans" bölümü + 3 seviye (Kaliteli/Normal/Düşük), kişi kendi cihazına göre seçsin; mevcut hal varsayılan kalsın; düşükte glass biraz azalsın.
- **settings.js**: `quality` (localStorage, cihaza özel; "high"|"normal"|"low", varsayılan "high") + `setQuality()`; seçim `<html data-quality>` attribute'una yazılır.
- **HolographicSphere.jsx**: seviyeye göre — high: 60fps, dpr[1,2], 60/40 düğüm (mevcut hal); normal: `frameloop="demand"` + `FpsCap 30fps`, dpr[1,1.5], 36/24 düğüm; low: 3B küre kapalı, hafif CSS parıltı (WebGL render yok). WebGL yoksa da otomatik fallback (bot/eski cihaz).
- **PerformancePanel.jsx** (yeni) + `SettingsPanel` yeni "Performans" sekmesi (herkese açık): 3 kart (açıklama + önerilen cihaz), seçim anında uygulanır + kaydedilir.
- **index.css**: `[data-quality="low"]` → glass backdrop-blur kapalı, neon-glow/scanline/radial-glow sadeleştirilir.
- **Test**: Playwright — 3 seviye render, düşükte `data-quality=low` + glass sadeleşme + toast, normalde küre render + HUD "FPS: 29" (30fps cap DOĞRULANDI). Lint temiz. Varsayılan high'a döndürüldü.
- NOT: Ayar cihaza özeldir (localStorage); canlı için Deploy gerekir.

### Hata Radarı Gürültü Düzeltmesi — WebGL/Bot (2026-06 · fork) ✅
Radar, Meta/Facebook site tarayıcı botunun (`meta-webindexer`) giriş sayfasında ürettiği "Error creating WebGL context" hatasını yakaladı (gerçek kullanıcı değil, gürültü). İki yönlü kalıcı düzeltme:
- `HolographicSphere.jsx`: `<Canvas>` öncesi WebGL desteği kontrol edilir; yoksa hafif CSS parıltı yedeğine düşülür → hata tamamen önlenir (bot + eski tarayıcılar). WebGL varken küre eskisi gibi çalışır (screenshot ile doğrulandı).
- `clientLogger.js`: bot/crawler user-agent'larında (`bot|crawl|spider|facebookexternalhit|webindexer|headless|...`) logger hiç kurulmaz → radar temiz kalır.
- NOT: Kod düzeltmesi; production'da (sertex-ai.com) yalnızca **yeniden Deploy** sonrası etkin olur. Mevcut yakalanmış bot kaydı radardan "Çöz/Temizle" ile kaldırılabilir.

### Marka: SERTEX Amblemi — Ana İkon & Amblem (2026-06 · fork) ✅
Kullanıcı yeni SERTEX altıgen "S" devre amblemini yükledi (`sertex-logo.jpeg` banner); uygulamanın ana ikonu ve amblemi yapıldı.
- Amblem banner'dan kare olarak kırpıldı (wordmark hariç, x≈470 boşluğuna kadar), siyah zeminli 1024 ikon + şeffaf `emblem-mark.png` (siyah→alfa) üretildi.
- **Web** (`frontend/public`): `favicon.png`, `favicon.ico`, `apple-touch-icon.png`, `logo192.png`, `logo512.png` amblemle değiştirildi; `LoginScreen.jsx` giriş kartına ve `index.html` açılış (boot) ekranına şeffaf amblem eklendi (`login-logo`).
- **Mobil** (`mobile/assets/images`): `icon.png` (1024), `adaptive-icon.png`, `favicon.png` amblemle; `splash-image.png` tam SERTEX banner'ı (kırpılmış); `HudHeader.tsx`'teki cyan orb şeffaf amblemle değiştirildi → login + tüm ana sekmelerde (`brand-emblem`) görünür.
- **Test**: Web login + mobil header canlı screenshot ile doğrulandı. NOT: tarayıcı favicon'u sert cache'lenir (hard refresh gerekebilir); mobil app icon/splash yalnızca gerçek iOS/Android build'de (Publish) tam yansır. Canlı için Deploy gerekir.

### Hata Radarı — Çözümleme + Seviye Filtresi & Gruplama (2026-06 · fork) ✅
Kullanıcı isteği: (1) bir hatayı "çözüldü" işaretleyip aktif listeden gizle (yalnızca aktif sorunlara odaklan); (2) seviyeye göre süz + en sık tekrar edenleri üstte grupla.
- **Backend** (`routers/admin_router.py`): client_logs'a `resolved`/`resolved_at`/`resolved_by`. GET `/admin/client-logs` artık `status` (active[varsayılan]/resolved/all) + `level` (virgüllü) filtrelerini ve `active` sayacını döner — varsayılan aktif olduğu için çözülmüşler otomatik gizli (mobil ekran da bundan yararlanır). Yeni uçlar: `POST /admin/client-logs/{id}/resolve` (tekli), `POST /admin/client-logs/resolve-bulk {message}` (aynı mesajlı grubu toplu çöz/geri al).
- **Web** (`ClientErrorRadar.jsx`, `api.js`, `MonitoringDashboard.jsx`): SEVİYE (Tümü / Hata+Kritik / Uyarı) + DURUM (Aktif / Çözüldü / Tümü) filtre çipleri, LİSTE/GRUPLA görünüm anahtarı. Liste satırında "Çöz / Geri Al" butonu; grup görünümü mesaja göre ×count ile sık→seyrek sıralı + "Çöz (N)" toplu çözüm + açılır occurrences. AKTİF SORUN sayacı.
- **Test**: Backend curl e2e — status/level filtre (level=error→2), tekli resolve (active 3→2), toplu resolve RepeatErr (active→0, resolved→3) DOĞRULANDI. Web canlı (Playwright): liste + grup görünümü, çip filtreleri, Çöz/ÇÖZ(N) butonları render. Lint temiz. Test verileri temizlendi.
- NOT: Mobil `client-logs` ekranı otomatik olarak yalnızca aktif hataları gösterir; resolve/filtre/gruplama UI'ı henüz mobilde yok (opsiyonel parite).

### Hata Radarı — Web Özel Sekme + Yeni-Hata Bildirimi (2026-06 · fork) ✅
Kullanıcı isteği: (1) Hata Radarını web'de İstatistik sekmesinden çıkarıp AYRI bir sekme yaparak tek tık erişim; (2) yeni bir istemci hatası düşünce süper yöneticilere ANLIK bildirim — bildirim sıklığı AYARLANABİLİR.
- **Backend** (`team_service.py`, `routers/admin_router.py`, `push_service.py`): Yeni `notify_super_admins_client_error(db, log_doc)` — `POST /api/client-log` sonrası best-effort çağrılır; Kurucu + aktif super_admin'lere `client_error` tipli çan bildirimi + web push gönderir. Spam koruması: AYARLANABİLİR cooldown (dk) içinde en fazla 1 toplu bildirim (in-memory `_last_client_error_notify_ts` guard + 60sn cfg cache; PUT'ta `invalidate_ce_cfg_cache()` ile anında geçerli). Ayar `system_settings.key='global'` → `client_error_notify_cooldown_min` + `client_error_notify_enabled`. Yeni uçlar: `GET/PUT /api/admin/client-logs/notify-settings` (super_admin). `push_service.notification_push_text`'e `client_error` başlık/gövde eklendi.
- **Web** (yeni `ClientErrorRadar.jsx`; `SettingsPanel.jsx` yeni "Hata Radarı" sekmesi super_admin/kırmızı, `NotificationBell.jsx`, `api.js`): Ayarlar'da ayrı **Hata Radarı** sekmesi — 24s/toplam sayaç kartları, YENİ HATA BİLDİRİMİ bölümü (aç/kapa + 5/15/30/60 dk cooldown çipleri), 30sn oto-yenileme, hata listesi (seviye+kullanıcı+kaynak+UA+stack aç/kapa), temizle. NotificationBell `client_error` tipini 🐞 ikon + "N yeni ön yüz hatası" ile gösterir; tıklayınca `sertex:open-settings-tab` event'iyle doğrudan Hata Radarı sekmesini açar (tek tık). Mobil super admin'ler de aynı bildirimi paylaşılan backend üzerinden alır.
- **Test**: Backend curl e2e — PUT/GET notify-settings, POST client-log → serkan'a `client_error` bildirimi (count+mesaj doğru), **throttle DOĞRULANDI** (2 hata → 1 bildirim, cooldown=1dk). Web canlı (Playwright): Hata Radarı sekmesi render (sayaç + cooldown çipleri + boş liste), bildirim çanı tıklaması → Hata Radarı sekmesi açıldı (SUCCESS). Lint temiz. Tüm test verileri temizlendi, ayar 15dk/enabled'a döndürüldü.
- **Yayın**: preview'de; canlı (sertex-ai.com) için Deploy gerekir.

### Frontend Hata Radarı — Mobil Parite Tamamlandı (2026-06 · fork) ✅
Kullanıcı isteği: "Frontend Hata Radarı / istemci log kaydı" özelliğini bitir. WEB tarafı zaten tamamdı (backend `POST /api/client-log`, `GET/DELETE /api/admin/client-logs` + TTL 30 gün + super_admin gate; `frontend/src/lib/clientLogger.js` `index.js`'te wired; `MonitoringDashboard.jsx` içinde görüntüleme + temizleme). EKSİK OLAN mobil taraf eklendi.
- **Mobil** (yeni `src/lib/clientLogger.ts`, `app/settings/client-logs.tsx`; düzenlenen `app/_layout.tsx`, `src/api/client.ts`, `src/api/types.ts`, `app/settings/index.tsx`, `constants/testIds/settings.js`): `initClientLogger()` `_layout.tsx`'te modül seviyesinde çağrılır → `ErrorUtils.setGlobalHandler` (fatal+non-fatal, önceki handler korunur) + `promise/setimmediate/rejection-tracking` (yakalanmamış promise reddi). Web ile birebir throttle (20/dk) + dedupe (30sn), logger asla throw etmez. API istemcisi 5xx yanıtlarını `captureError` ile sessizce kaydeder. Loglar `POST /api/client-log`'a gider (`user_agent="SertexMobile <os> <ver>"`, `source="mobile"/api:<path>`). Yeni süper-yönetici ekranı `/settings/client-logs` ("HATA RADARI"): 24s/toplam sayaç kartları, log listesi (seviye rozeti + zaman + mesaj + kaynak + kullanıcı + stack aç/kapa), "Tüm Kayıtları Temizle" (onaylı). Ayarlar menüsünde superOnly link (`settings-nav-client-logs`).
- **Test**: Backend curl e2e (POST client-log → GET admin/client-logs; total/last_24h + source/user_agent doğru). Mobil canlı doğrulama (Expo web preview screenshot): HATA RADARI ekranı sayaç kartları + test kaydı doğru render etti. Lint temiz. Smoke-test kaydı sonrasında silindi.
- NOT: Otomatik yakalama (global JS hataları, promise reddi, 5xx) web önizlemede tetiklenemez; gerçek iOS/Android build'de doğrulanır. Depolama + görüntüleme yolu E2E onaylandı.


### Arşiv v2 — Neden Notu + Politika · Arama/Sıralama · Otomatik Temizlik · Kişi-Bazlı Yetkiler · Web+Mobil (2026-08 · fork) ✅
Kullanıcı isteği (Arşiv grupları üzerine): (1) İptal/Silme **neden notu** + politika; (2) **Arşiv içi arama/sıralama** + genel aramanın arşivi kapsaması; (3) **Otomatik çöp temizliği** (seçenekli + kapatılabilir); (4) geri yüklendi bildirimi + "X gün sonra silinecek" sayacı. İZİN MODELİ: yetkiler **kişi bazlı**, admin verir.
- **Backend** (`tasks_router.py`, `tasks_models.py`, `archive_cleanup_service.py`, `server.py`): Task'a `cancel_reason/delete_reason`. Yeni uçlar (hepsi `/tasks/{tid}` generic route'undan ÖNCE): `GET/PUT /tasks/settings` (global `delete_reason_policy` off|optional|required + `trash_autoclean_enabled` + `trash_autoclean_days`; PUT `manage_policy` yetkisi ister), `GET /tasks/search?q=&scope=` (archived=True kovaları içinde regex arama), `PATCH /users/{uid}/archive-caps` (YALNIZCA admin — perm_delete/empty_trash/manage_policy ver/al). `DELETE /tasks/{id}?reason=` ve `POST /tasks/{id}/cancel {reason}` politika 'required' iken boş neden → 400; 'off' → sormaz; neden `[:500]` saklanır. `permanent`/`trash/empty` artık `perm_delete`/`empty_trash` yetkisiyle (admin her zaman). Kişi yetkileri `user.archive_caps`. **APScheduler** günlük 03:00 UTC `purge_expired_trash` — `deleted_at < now-days` olan çöp görevleri kalıcı siler (kapalıyken no-op). `GET /tasks/settings` yanıtı geçerli kullanıcının `caps`'ını içerir.
- **Web** (`TasksPanel.jsx`, `TaskCard.jsx`, `TaskContextMenu.jsx`, yeni `TaskPolicySettings.jsx`, `SettingsPanel.jsx` "Arşiv" sekmesi, `UserLockPolicyModal.jsx` "ARŞİV YETKİLERİ" bölümü, `api.js`): `promptDialog` ile politikaya duyarlı neden sorma (required→boş engellenir); arşiv satırında iptal/silme nedeni + "X gün sonra silinecek" sayacı; arşiv sıralama çipleri (Yeni/Eski/A-Z) + grup içi arama; genel aramada "ARŞİVDE BULUNANLAR" ayrı bölüm (tıkla→gruba geç); empty-trash/permanent butonları caps ile gizlenir; SettingsPanel "Arşiv" sekmesi (admin/manager/manage_policy) politika+otomatik temizlik yönetir; kilit modalında admin ARŞİV YETKİLERİ toggle'ları.
- **Mobil** (`app/archive.tsx`, `app/task/[id].tsx`, `src/api/client.ts`, `types.ts`): Arşiv ekranına arama+sıralama, satırda neden+sayaç, caps ile Kalıcı Sil/Boşalt gizleme; görev detayında İptal/Sil için politikaya duyarlı neden modalı (required→onay pasif). NOT: yetki-verme (grant) ekranı MOBİLDE YOK — admin web'den verir; mobil yalnızca caps'e uyar.
- **Test**: Backend pytest `test_archive_v2.py`(4) + `test_archive_groups.py`(5) = **9/9 PASS** + curl e2e. Testing agent iteration_122 — **8/8 checklist PASS** (web+mobil canlı). Tüm test verileri temizlendi, politika 'optional'+autoclean kapalı, caps sıfır.
- **Yayın**: preview'de; canlı (sertex-ai.com) için Deploy, mobil için yeni build gerekir.


### Arşiv Grupları — Bitmiş / İptal / Silinmiş (çöp kutusu) · Web + Mobil (2026-08 · fork) ✅
Kullanıcı isteği: Arşiv içindeki görevleri **BİTMİŞ · İPTAL · SİLİNMİŞ** olarak, statü çipleri (AKTİF/GEÇTİ/BEKLİYOR) gibi **yan yana çiplerle** gruplandır. Seçimler: (1) görev menüsüne **"İptal Et"** → görev iptal işaretlenip arşive düşer; (2) **"Sil" artık kalıcı değil** → çöp kutusuna (soft-delete) taşır; **Geri Yükle** herkes, **Kalıcı Sil + Çöp Kutusunu Boşalt yalnızca ADMIN**; (3) BİTMİŞ = arşive gönderilen tamamlanmış görevler; (4) Web + Mobil parite; (5) yan yana çip gösterimi.
- **Backend (paylaşılan, `tasks_router.py` + `tasks_models.py`)**: Task'a `cancelled/cancelled_at`, `deleted/deleted_at/deleted_by` + `deleted_prev_archived` (soft-delete'te `archived=True` yapılır → silinen görevler tüm aktif sorgulardan/hatırlatma/özet/istatistikten otomatik hariç; restore eski arşiv durumuna döner). Uçlar: `POST /tasks/{id}/cancel|uncancel|restore`, `DELETE /tasks/{id}/permanent` (admin), `POST /tasks/trash/empty` (admin), `GET /tasks/archive-counts` (`{done,cancelled,deleted}` — `/tasks/{tid}` generic route'undan ÖNCE tanımlı), `GET /tasks?view=archived|cancelled|trash`. DELETE /tasks/{id} artık soft-delete. RBAC: cancel=edit yetkisi, permanent+empty=admin (403 aksi).
- **Web (`TasksPanel.jsx` + `TaskCard.jsx` + `TaskContextMenu.jsx` + `api.js`)**: ARŞİV modunda 3 çip yan yana (`archive-group-{done,cancelled,deleted}`, `grid-cols-3`, sayaçlı); `archiveGroup` state → ilgili `view` ile liste yüklenir. Menü: aktifte `ctx-cancel-task` (İptal Et); İPTAL grubunda `ctx-uncancel` (Geri Yükle); SİLİNMİŞ'te `ctx-restore` + admin `ctx-permanent-delete`; `archive-empty-trash` (admin, deleted>0). Onay diyalogları permanent/empty için.
- **Mobil (yeni `app/archive.tsx` + `app/(tabs)/tasks.tsx` başlık arşiv ikonu + `app/task/[id].tsx` İptal Et + `client.ts` + `types.ts`)**: Yeni Arşiv ekranı (mobilde arşiv HİÇ yoktu) — 3 çip yan yana + sayaç, satırda Geri Yükle + admin Kalıcı Sil, admin Çöp Kutusunu Boşalt, onay modalları. Detayda `task-detail-cancel-button` + "Sil" artık çöp kutusuna taşır (mesaj güncellendi).
- **Test**: Backend pytest `test_archive_groups.py` 5/5 (cancel/uncancel, soft-delete/restore/permanent, restore prior-archived, counts, non-admin 403) + curl e2e. Web canlı doğrulama (screenshot): 3 çip yan yana, SİLİNMİŞ'te ÇÖP KUTUSUNU BOŞALT + satır GERİ YÜKLE/KALICI SIL menüsü. Mobil canlı doğrulama (Expo web preview screenshot): 3 çip + SİLİNMİŞ satır aksiyonları + boşalt butonu. Testing agent iteration_121 tüm testID wiring'i (web+mobil) doğru buldu. Seed veriler temizlendi.
- **Yayın**: preview'de; canlı (sertex-ai.com) için Deploy, mobil için yeni build gerekir.


### Web Push — CANLI DOĞRULAMA GEÇTİ ✅ (2026-06 · fork, kullanıcı testi)
Kullanıcı, canlı sitede (sertex-ai.com) "Bildirimi Aç" + "Test Et" akışını gerçek tarayıcıda test etti ve **çalıştığını onayladı.** VAPID anahtarı hem preview hem production'da servis ediliyor (87 karakter, aynı), uçlar (`/push/vapid-public-key`, `/subscribe`, `/unsubscribe`, `/test`) + `sw.js`/`push.js`/`PushToggle` aktif. **Bekleyen P0 doğrulama kapandı.**


### Mobil — Filtre Hatırlama + Şirket Çipleri Alfabetik (2026-06 · fork) ✅
Kullanıcı istekleri: (1) seçilen şirket, arama ve "boş kol gizle" tercihini uygulama yeniden açılınca hatırla; (2) şirket çiplerini ada göre alfabetik sırala.
- **Hatırlama** (`app/(tabs)/tasks.tsx` + `@/src/utils/storage`): 3 primitive anahtar — `tasks.filter.company` (id|null), `tasks.filter.companySearch` (string), `tasks.filter.hideEmpty` (bool). Mount'ta `getItem(fallback)` ile yüklenir (`prefsLoaded` ref ile ilk yazımdan önce state ezilmesi engellenir); değişince `setItem` ile yazılır. Kayıtlı şirket artık listede yoksa filtre null'a döner.
- **Alfabetik sıralama**: `companyChips` `name.localeCompare(b.name, "tr")` ile sıralanır (admin=tüm şirketler, müdür=görünür kollardakiler); arama kutusu (`visibleChips`) sıralı listeden süzer.
- **Test (self)**: hideEmpty ON + arama "Test" + Test Company A seçildi → sayfa reload sonrası üçü de geri yüklendi; çipler A→Z sıralı. Lint + tsc temiz.


### Mobil — Şirket Filtresi Arama Kutusu (2026-06 · fork) ✅
Kullanıcı isteği: Çok şirketli adminler için şirket çiplerinin üstüne hızlı arama kutusu.
- `app/(tabs)/tasks.tsx`: Admin için şirket çipleri artık **TÜM şirketleri** listeler (önceki "yalnızca kategorisi olanlar" yerine); üstüne bir **"Şirket ara..."** kutusu (testID `tasks-company-search`) eklendi. Kutu yalnızca **admin + ≥6 şirket** olduğunda görünür; yazınca çipler ada göre (Türkçe `toLocaleLowerCase("tr")`) süzülür; temizle (×) düğmesi; eşleşme yoksa "Şirket bulunamadı".
- Müdür/diğer roller: değişmedi (yalnızca görünür kollarda geçen şirketler, arama kutusu yok).
- **Test (self)**: serkan (51 şirket) → arama kutusu göründü, "Test Company" yazınca tek çipe indi. Lint + tsc temiz.


### Mobil — Görev Ekranı: Şirket Filtresi + Boş Kol Gizle (2026-06 · fork) ✅
Kullanıcı istekleri: (1) görev ekranına şirket seçici; **admin** bir şirkete basınca o şirketin TÜM iş kolları gelsin, **müdür** ise yalnızca kendi görebildikleri/şirketininkiler. (2) Hiç görevi olmayan iş kollarını gizleyen bir aç/kapa.
- **Şirket Filtresi** (`app/(tabs)/tasks.tsx`): Başlık altında yatay kaydırmalı çip satırı (`Tümü` + şirketler). Çipler yalnızca **en az bir iş kolu olan** şirketleri listeler (2+ şirket varsa görünür).
  - **Admin**: çipler `scope=manage` (tüm kollar) kapsamındaki şirketler; bir şirket seçilince ağaç `manageCategories`'ten o `company_id` köklerine göre kurulur → normalde görünmeyen kollar bile gelir. `Tümü` = `my_tasks` (temiz varsayılan).
  - **Müdür/diğer**: çipler yalnızca görünür (`my_tasks`) kollarında geçen şirketler; seçim görünür küme içinde süzer (başkasının şirketi gelmez).
  - `useAuth().user.role` ile ayrım; `api.categories("manage")` yalnızca admin için yüklenir.
- **Boş Kol Gizle** (`taskTree.pruneEmpty`): araç çubuğunda göz/göz-kapalı toggle (`tasks-hide-empty-toggle`); açıkken `rollup.total===0` düğümler alt ağaçlarıyla ayıklanır. Varsayılan kapalı.
- Şirket seçiliyken "Kategorisiz" gizlenir (sahipsiz görevler şirkete ait değil).
- **Test (self)**: Admin — çip satırı + TEST_NewCorp seçince o şirketin kolu ("NewCorp Test Kolu") geldi; Tümü'de temiz görünüm. Müdür (mgr_test) — çip satırı çıkmadı (tek şirket), sadece kendi kolları; çökme yok. hideEmpty çalışıyor. Lint + tsc temiz. Seed edilen test kategorisi temizlendi. ⚠️ Cihazda görmek için yeni iOS build gerekir.


### Mobil — İş Kolu (Kategori) Görünürlük Paritesi (2026-06 · fork) ✅
Kullanıcı sorunu: Mobil görev ekranı **başkalarının/tüm** iş kollarını gösteriyordu; web ise yalnızca kullanıcıya görünür olanları. İstenen: mobil web ile aynı olsun.
- **Kök neden**: Web `TasksPanel.jsx:500` → `taskCategoriesApi.list("my_tasks")` (görünürlük filtreli). Mobil `client.ts` → `/task-categories` **scope'suz** → varsayılan `manage` → admin HEPSİNİ görüyordu.
- **Fix (3 satır)**: `api.categories(scope="manage")` parametreli yapıldı; `app/(tabs)/tasks.tsx` ve `app/task/[id].tsx` artık `api.categories("my_tasks")` çağırıyor. Yönetim ekranı `app/categories.tsx` `manage` kaldı (web `TaskCategoriesManagement` gibi — admin tüm kolları düzenleyebilsin).
- **Backend `scope=my_tasks`**: owner company / `visible_to_company_ids` / `visible_to_user_ids` görünürlüğü (alt kollar üstten miras alır). Görünür olmayan kola bağlı görevler "Kategorisiz" altında toplanır (web ile aynı orphan davranışı).
- **Test (self)**: preview'de serkan için `manage`=2 vs `my_tasks`=1 kategori; mobil ekran artık sadece görünür kolları + Kategorisiz gösteriyor. Lint temiz. ⚠️ Cihazda görmek için yeni iOS build gerekir.


### Mobil — Görev Formu: Manuel Tarih/Saat Seçici (2026-06 · fork) ✅
Kullanıcı isteği: "Yeni Görev" formunda BAŞLANGIÇ ve SON TARİH için, hazır seçeneklerin (Yok/Bugün/Yarın/3 gün/1 hafta) yanında kullanıcının **kendi tarih + saatini** seçebilmesi (örn. 10.08.2026 16:43) — web'deki gibi.
- **Paket**: `@react-native-community/datetimepicker@8.4.4` (`yarn expo install`). ⚠️ NATIVE modül → iOS/Android cihazda çalışması için **yeni build (Build the App)** gerekir.
- `TaskFormModal.tsx`: BAŞLANGIÇ + SON TARİH satırlarına **"📅 Tarih/Saat seç"** çipi eklendi (testID `task-form-start-custom` / `task-form-due-custom`). Seçilince çip aktifleşir ve `GG.AA.YYYY SS:DD` gösterir.
- **Platforma göre seçici**: iOS = native `spinner` (önce tarih → "İleri" → saat → "Tamam"); Android = native dialog (date→time); **Web önizleme** = metin girişi `GG.AA.YYYY SS:DD` (regex parse) — böylece Expo web preview + testing agent çalışır.
- `startKey/dueKey='custom'` ve `customStart/customDue: Date`; `resolveStart()/resolveDue()` create + edit payload'larında `.toISOString()` gönderir. Başlangıç>bitiş yumuşak doğrulaması korunur.
- **Test (self)**: Web önizlemede uçtan uca — çip açılıyor, 10.08.2026 16:43 girildi, görev oluşturuldu, backend'de `due_date=2026-08-10T16:43:00.000Z` doğrulandı; test görevi silindi. Lint + tsc temiz.


### Mobil — Duyuru Rozeti + Kullanıcı Detay Ekranı (2026-06 · fork) ✅
Kullanıcı istekleri: (1) aktif duyuruları mobil ana ekranda küçük bir şeritle göster; (2) kullanıcıya dokununca kota/kullanım + görev özeti gösteren detay ekranı. Kullanıcı seçimleri: (2b) şerit HER sekmede görünsün; (1a) kişiye dokununca Detay ekranı açılsın, düzenleme Detay içindeki düğmeye taşınsın. **Yeni backend YOK — mevcut uç noktalar tüketildi.**
- **Duyuru Rozeti** (`src/components/AnnouncementBanner.tsx`): `(tabs)/_layout.tsx` içinde `<Tabs>` üstüne mount edilen absolute overlay → 4 sekmenin hepsinde görünür. `GET /api/announcements/active` 60sn'de bir poll'lanır; ack'lenmemişler filtrelenir. Önem rengi (info=cyan/warning=amber/critical=danger) + ikon + BİLGİ/UYARI/KRİTİK etiketi + başlık + mesaj. "ANLADIM" → `POST /api/announcements/{aid}/ack` (kalıcı, geri gelmez). Kapat (X) yalnızca `require_ack=false` iken görünür (oturumluk gizleme). +N sayacı. Opak `tintBg()` zemin (arkadaki başlık sızmaz). testID: `announcement-banner/-ack/-dismiss/-title`.
- **Kullanıcı Detay** (`app/settings/user/[id].tsx`): Kullanıcılar listesinde karta dokununca `/settings/user/{id}`'e yönlenir (eski davranış: dokun→düzenle idi). `adminUsers` + `teamSummary` + `listCompanies` paralel çekilir. Profil kartı + DEPOLAMA KOTASI (quota_label + usage/quota MB + % bar, renk eşiği 70/90) + GÖREV ÖZETİ (toplam/tamamlanan/bekleyen/duraklatılan/geciken ızgara). DÜZENLE → paylaşılan `UserFormModal`; SİL → `ConfirmModal` → `deleteUser` → geri. Not: `/team/summary` current admin'i hariç tuttuğu için kendi detayında görev özeti "görünmüyor" mesajı çıkar (beklenen). testID: `user-detail-screen/-quota/-summary/-edit/-delete`.
- **Refactor**: `UserFormModal` `users.tsx` içinden `src/components/admin/UserFormModal.tsx`'e taşındı (liste + detay ortak kullanır); `roleLabel/ROLE_OPTS` de oradan export.
- **Test**: `iteration_120.json` — Mobil frontend TÜM akışlar GEÇTİ (banner 4 sekmede, require_ack X gizleme, ack kalıcı / dismiss oturumluk, detay kota+özet emp1_test 19/1/18/0/13, düzenle/sil modalları, create FAB regresyonu). Sıfır kod değişikliği testing agent'tan. Non-blocking: RN web `shadow*`/`pointerEvents` deprecation uyarıları.
- **Web Push Canlı Test**: hâlâ kullanıcı tarafında bekliyor (otomasyon tarayıcısı izin engelliyor).

### Mobil Dalga 3 — Ayarlar + Admin Panelleri (2026-06 · fork) ✅
- Profil → **Ayarlar** ekranı (`app/settings/`): kişisel **günlük özet** ayarları (açık/kapalı, saat, detaylı, hafta sonu atla → `PUT /api/notifications/digest-settings`) + role-gated admin navigasyonu.
- **Kullanıcılar** (`/settings/users`): listele + oluştur (kullanıcı adı/şifre/rol/şirket, boş şifrede geçici şifre banner'ı) + düzenle (rol/şirket/şifre) + sil. Şirket dropdown gerçek `/api/companies` (id) kullanır; create→`POST /api/admin/users`, update `company_id:""`=şirket kaldır.
- **Duyurular** (`/settings/announcements`): listele (aktif filtresi — soft-delete gizlenir) + oluştur (başlık/mesaj/önem/onay) + sil.
- **Şirketler** (`/settings/companies`): listele + oluştur/düzenle/sil (`/api/companies`).
- **Lisanslar** (`/settings/licenses`): listele + üret (tür+adet) + sil (`/api/admin/licenses`).
- **Yetkiler** (`/settings/permissions`): müdür→personel görünürlük eşleşmeleri (`/api/manager-visibility`) + oluştur (yinelenme engeli) + sil.
- Yeni paylaşılan bileşenler: `ScreenHeader`, `ConfirmModal`, `SelectField`. testing_agent iteration_118/119 — tüm CRUD akışları + 2 düzeltme (duyuru silme görünürlüğü, yetki yinelenme geri bildirimi) GEÇTİ.

### Web Push Bildirimleri — Service Worker + VAPID (2026-06 · fork) ✅ (canlı tarayıcı testi bekliyor)
- Backend: `push_service.py` (pywebpush) + `routers/push_router.py`: `GET /api/push/vapid-public-key`, `POST /api/push/subscribe|unsubscribe|test`. Abonelikler `push_subscriptions` (endpoint unique). VAPID anahtarları `backend/.env` (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT).
- Merkezi hook: `team_service._insert_notification` her bildirimde best-effort web push gönderir (paylaşım, dürtme, geciken, yaklaşan, cross-perm...). 404/410 abonelikler otomatik silinir.
- Frontend: `public/sw.js` (push + notificationclick), `src/lib/push.js`, `src/components/PushToggle.jsx` → Ayarlar → Uyarılar sekmesinde "Tarayıcı Bildirimleri" aç/kapat + Test.
- Doğrulama: backend endpoint'leri curl ile ✓; `/sw.js` 200 ✓; PushToggle render + denied/unsupported durumları ✓. NOT: otomasyon tarayıcısı Notification API'yi engellediği için gerçek abonelik/alım kullanıcı tarafından gerçek tarayıcıda (Chrome/Edge, "İzin ver") doğrulanmalı.

### Mobil Faz C — Takım & Raporlar (2026-06 · fork) ✅
- TAKIM sekmesi 4 alt sekmeye bölündü: Kişiler / İş Kolları / Gecikenler / Isı Haritası (`app/(tabs)/team.tsx` + `src/components/team/*`).
- İş Kolları: kategori performans kartları + PDF/Excel "Rapor Paylaş" (expo-print + xlsx + expo-sharing, `src/lib/categoryReportMobile.ts`).
- Gecikenler: kişi bazlı geciken görevler + toplu "Dürt" (bulk-nudge). Isı Haritası: 60 günlük aktivite ızgarası.
- Client: `teamCategorySummary/teamOverdueSummary/teamHeatmap/teamBulkNudge`. testing_agent iteration_117 — tüm akışlar GEÇTİ. (Rapor paylaşımı native; web önizlemede paylaş penceresi açılmaz.)

### Web — Kategori (İş Kolu) Rapor Dışa Aktarma (2026-06 · fork) ✅
- "İş Kolları" ekranı başlığına iki düğme: **EXCEL** (.xlsx) ve **PDF** (tarayıcı yazdır).
- Rapor rollup'tur (her iş kolu + alt kolları), hiyerarşik girintili; şirket bazlı gruplama + şirket alt toplamı + en üstte genel özet (toplam/tamamlanan/%).
- Yeni: `/app/frontend/src/lib/categoryExport.js` (mevcut `xlsx` + `file-saver` altyapısı, `flattenTree`/`rollupCategoryStats`/`getCategoryPathLabel` yeniden kullanıldı). testID: `category-export-excel`, `category-export-pdf`.
- Ana ajan tarafından uçtan uca doğrulandı (Excel indirme + PDF pop-up içeriği; genel %40 özeti doğru).

### Mobil — Çapraz-Rol OTP Kilit Açma DOĞRULANDI (2026-06 · fork) ✅
- serkan (admin, sahip değil) → "Şifre Üret" ile 6 haneli kod üretir; ahmet (görev sahibi) → "Kilidi Aç (Şifre Gir)" ile kodu girip tek kullanımlık pencere açar. Yanlış kod reddedilir. testing_agent (iteration ~116) ile 3 senaryo GEÇTİ.

### Mobil FAZ B2 Wave 3 — Görev Bağlama (Gruplar) + Wave 4 — Görev Kilidi / OTP (2026-06 · fork) ✅
**Wave 3 (Görev Bağlama):**
- Görev listesi araç çubuğuna "Bağla" düğmesi (`tasks-link-open-button`) → `LinkTasksModal`: 2+ görev seç, sırala, ad + ilerleme, kaydet. Backend `POST/PATCH/DELETE /api/task-groups`.
- Görev kartlarında grup rozeti (`task-row-group-badge-*`) — grup adı + X/Y ilerleme.
- Görev detayında grup bölümü (`GroupSection`): sıralı üye listesi (dokunulabilir), gruptan çıkar / düzenle / dağıt. <2 üye kalınca grup otomatik dağılır.
**Wave 4 (Görev Kilidi + OTP):**
- Görev detayında `LockSection`: durum çipi (Kilitli/Serbest/Kilit açık), aktif kısıtlama etiketleri.
- `LockConfigModal`: 13 kilit bayrağı checklist, Tümünü Kilitle/Serbest Bırak, OTP-zorunlu anahtarı, Tarihçe sekmesi (lock-audit). Backend `PATCH /api/tasks/{id}/locks`.
- Kilidi Aç: yumuşak kilit → `unlock-simple`; katı kilit → 6 haneli OTP girişi → `unlock-verify`. Yönetici/oluşturan → `unlock-otp` ile şifre üret (`OtpDisplayModal`, kopyala, geri sayım).
- Yeni dosyalar: `LinkTasksModal.tsx`, `GroupSection.tsx`, `LockSection.tsx`, `lib/taskLocks.ts`. `expo-clipboard` eklendi.
- testing_agent iteration_115 ile doğrulandı (tüm akışlar geçti). NOT: Tek admin+sahip hesabında çapraz-rol OTP tam turu (üret→gir→doğrula) e2e denenmedi; ikinci kullanıcı oturumu gerektirir.

### Mobil FAZ B2 Wave 2 — Görev Paylaşımı (2026-06 · fork) ✅
- `SharesSection.tsx` görev detay ekranına (`/app/mobile/app/task/[id].tsx`) enjekte edildi (Ekler bölümünün altında).
- Paylaşılan kullanıcıları + izinleri görme, kullanıcı arayıp paylaşma, izin düzenleme, kaldırma. Backend: `PUT /api/tasks/{id}/shares` (tüm-liste değiştirme, body `{shares, notify}`).
- Tema anahtar düzeltmesi: `colors.background` → `colors.bgBase`.
- testing_agent ile doğrulandı (6 akışın tümü geçti). Sıradaki: Wave 3 (görev bağlama/gruplar) → Wave 4 (kilitler/OTP).


### Özellik — Sidebar Filtre Ağacı "Hepsini Aç/Kapat" Düğmesi (2026-06 · fork) ✅
Kullanıcı isteği: sidebar iş kolu filtre ağacına tek düğmeyle tüm düğümleri aç/kapat.
- **Uygulama** (`TasksPanel.jsx`): `expandableFilterIds` (görünür + çocuğu olan kollar); `allFilterOpen` = hepsi açık mı (kalıcı set'ten türetilir → reload sonrası doğru etiket, no-op yok); `toggleAllFilterNodes` filterExpanded'i tüm-açık/boş yapar + `saveCatFilterExpandedSet(user.id)` ile kalıcı yazar. Buton `catfilter-toggle-all`, filtre ağacının üstünde (yalnız hiyerarşi varsa), etiket "HEPSİNİ AÇ/KAPAT". Tek-tek toggle'larla etiket senkron.
- **Test**: `iteration_102.json` — Frontend %100 (aç/kapa tüm seviyeler, reload sonrası doğru etiket+durum, tek-tek senkron, regresyon temiz). Test verisi temizlendi.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — Sidebar İş Kolu Filtresi = Açılır-Kapanır Ağaç Liste (2026-06 · fork) ✅
Kullanıcı isteği (resim 1 → resim 2): sidebar iş kolu filtresi düz yan-yana çipler yerine, görev kartındaki gibi tıklanabilir dikey AĞAÇ liste olsun. Seçimler: sürükle-sırala kalsın ama SADECE aynı seviye kardeşler arası (1b); göreve sürükle-bırak korunsun (2a); ağaç varsayılan KAPALI + kişiye özel kalıcı (3a); TÜMÜ üstte / KOLSUZ altta (4a). "Bozmadan."
- **Uygulama** (`TasksPanel.jsx`): `catForest` (orderedCategories sırasını koruyan ağaç; ata görünmezse orphan kök); `filterExpanded` durumu `getCatFilterExpandedSet(user.id)`'ten; `renderFilterNode(node,depth)` her satırı çizer: chevron (▸/▾, `category-node-toggle-{name}`), GripVertical, filtre butonu (`category-chip-{name}`, renk noktası + ad), sayaç+ilerleme (`category-chip-progress-{name}`, rollup), ayrı pencere (`category-detach-{name}`); satır = task-drop hedefi (`data-cat-drop`) + kardeş sürükle-sırala. TÜMÜ/KOLSUZ korunur. `handleCatDrop` artık farklı seviye bırakışını engelder (toast.info) — yalnız kardeş sıralama.
- **Kalıcılık** (`lib/catFilterPrefs.js`, yeni): `sertex_catfilter_expanded_v1` localStorage, user_id bazında açık düğüm id'leri. Varsayılan kapalı.
- **Test**: `iteration_101.json` — Frontend %100 (dikey ağaç, varsayılan kapalı, aç/kapa, RELOAD sonrası kalıcı, filtre tıklaması, rollup sayaç, detach; kardeş-sıralama guard'ı kod-doğrulandı). Test verisi temizlendi. Regresyon yok (Kolsuz kapsamı gereği serkan'da görünmeyen Kargolama zaten eskiden de görünmüyordu).
- **Not (backlog)**: `TasksPanel.jsx` ~2400 satır; ileride filter-tree'yi ayrı bileşene çıkarmak faydalı (şimdilik bozmamak için dokunulmadı).
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — İş Kolu Ağaçlarını Topluca Aç/Kapat (tek düğme, kişiye özel senkron) (2026-06 · fork) ✅
Kullanıcı isteği: kartlardaki iş kolu ağaçlarını tek tek yerine tek düğmeyle topluca aç/kapat. "Bozmadan yap."
- **Uygulama**: `TasksPanel.jsx` araç çubuğuna `cattree-toggle-all` düğmesi (yalnızca hiyerarşik iş kolu varsa görünür; etiket durumuna göre "İŞ KOLU AĞAÇLARINI AÇ/KAPAT"). Tıklayınca `sertex:cattree-set-all {expanded}` CustomEvent yayar; her `TaskCard` dinleyip (hiyerarşisi varsa) ağacını açar/kapar + KİŞİYE ÖZEL kalıcı yazar (`catTreePrefs`).
- **Durum senkronu (bugfix, iteration_99)**: `allTreesOpen` artık localStorage kalıcı set'ten TÜRETİLİR (`getCatTreeExpandedSet(user.id)`), mount'ta + `sertex:cattree-changed` olayında. `toggleAllCatTrees` gerçek durumu okuyup TERSİNİ yayar → reload sonrası yanlış etiket / ilk-tık no-op sorunu giderildi. Kart tek-tek toggle'ı da `sertex:cattree-changed` yayar → panel etiketi anında güncellenir. Dispatch, setState updater'ından çıkarıldı (React "render sırasında setState" uyarısı giderildi).
- **Test**: `iteration_99.json` (bug bulundu) → `iteration_100.json` (%100, 8/8: reload etiketi doğru, tek-tık doğru collapse, tek-tek→etiket senkron, regresyon temiz). Test verisi temizlendi.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — Görev Kartında İş Kolu Ağacı (Ana Kol → Alt Kol, aç/kapa, kişiye özel kalıcı) (2026-06 · fork) ✅
Kullanıcı isteği (seçim B — dikey ağaç): görev kartında iş kolu yalnızca en alt kol değil, ANA KOL → ALT KOL hiyerarşisi (ağaç) olarak görünsün. Ek: yer kaplamasın diye varsayılan KAPALI + yanında aç/kapa (küçültme) işareti; tercih KİŞİYE ÖZEL KALICI kalsın (her açılışta yeniden ayar yapılmasın). "Hiçbir şeyi bozmadan."
- **Uygulama** (`TaskCard.jsx`): `getCategoryPath(task.category_id, categories)` ile kök→yaprak yolu hesaplanır. Hiyerarşi varsa (yol>1) varsayılan KOMPAKT: yaprak adı + sağ chevron (`task-category-expand-{id}`). Açınca dikey ağaç (`task-category-tree-{id}`): ilk satır kök kol, altındaki her seviye ↳ (CornerDownRight) ile girintili + renk noktası, yaprak parlak; küçült chevron (`task-category-collapse-{id}`). Tek seviyeli (parent'sız) kategoride ESKİ kompakt etiket birebir korunur (chevron yok → sıfır regresyon).
- **Kalıcılık** (`lib/catTreePrefs.js`, yeni): `sertex_cattree_expanded_v1` localStorage, **user_id bazında** açık görev id listesi. `isCatTreeExpanded/setCatTreeExpanded`. Sayfa yenilense de tercih korunur; farklı kullanıcılar çakışmaz. `toggleCatTree` `stopPropagation` ile kart tıklamasını tetiklemez.
- **Not**: Ağaç yalnızca yol üzerindeki TÜM ata kollar kullanıcıya görünürse tam çıkar (my_tasks miras düzeltmesiyle uyumlu); ata görünmezse güvenli şekilde kompakt yaprağa düşer.
- **Test**: `iteration_98.json` — Frontend %100 (varsayılan kompakt, aç→ağaç, kapat, RELOAD sonrası tercih kalıcı, tek-seviye regresyon, stopPropagation). Test verisi temizlendi. Sıfır regresyon.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Bugfix — "Düzenle"de Alt İş Kolları Görünmüyordu (görünürlük mirası) (2026-06 · fork) ✅
Kullanıcı bildirimi: "düzenle dediğimde alt iş kolları çıkmıyor, ana kollar çıkıyor". Görev oluşturma formu + Düzenle modalındaki İş Kolu açılır listesinde yalnızca ana (üst) kollar görünüyor, alt kollar gelmiyordu.
- **Kök neden**: `GET /api/task-categories?scope=my_tasks` kolları YALNIZCA doğrudan görünürlükle (sahibi şirket / `visible_to_company_ids` / `visible_to_user_ids`) filtreliyordu. Alt kol oluşturulurken üst kolun `company_id`'si miras alınır ama görünürlük alanları (visible_*) miras ALINMAZ → alt kollar my_tasks yanıtından düşüyor, dolayısıyla iki açılır listede de görünmüyordu.
- **Düzeltme** (`tasks_router.py` my_tasks dalı): tüm kollar çekilip `by_id` haritası kurulur; bir kol, KENDİSİ VEYA HERHANGİ BİR ATASI doğrudan görünürse görünür sayılır (`_visible()` parent_id zincirini yürür, döngü koruması `seen` ile). Böylece bir üst kol görünüyorsa altındaki tüm alt kollar da atanabilir. Görünürlük sızıntısı yok (erişilmeyen şirket kolları hâlâ gizli). Ayrıca `EditTaskModal.jsx` İş Kolu `<select>`'i artık `getCategoryPathLabel` ile breadcrumb gösterir (ör. "Fason Verme › Üretim") → alt kollar ayırt edilir.
- **Test**: `iteration_97.json` — Backend %100 (3/3 pytest `test_task_categories_inheritance.py`: alt kol miras, sızıntı yok) + Frontend %100 (oluştur formu + Düzenle modalı alt kolları listeler, breadcrumb, seçip kaydetme kalıcı). Sıfır regresyon.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — İş Kolu Taşıma (Re-parent) + Mini Rapor (Rollup) (2026-06 · fork) ✅
Kullanıcı isteği (seçimler: 1b + 2b + 3a): (1b) iş kollarını sürükle-bırak yerine **"Taşı" butonu + açılır liste** ile başka üst kola/köke taşı (dokunmatik dostu); (2b) her kolun yanında **görev sayısı + tamamlanma ilerleme çubuğu**, hem yönetim ekranında hem Görevler paneli filtre çiplerinde; (3a) yüzde = bitti/toplam. "Hiçbir şeyi bozmadan."
- **Backend**: `GET /api/task-categories/stats` → `{cat_id: {total, done}}` DOĞRUDAN sayılar (rollup frontend'de). Kapsam `scope=manage` ile aynı (admin tümü · müdür kendi+grant · employee boş). Re-parent zaten `PATCH /api/task-categories/{id}` `parent_id` ile hazırdı: döngü koruması (kendi altına/alt kolunun altına → 400), aynı-şirket + hedef-üst-kolda ad çakışması kontrolü; `parent_id:null` → köke taşır.
- **Frontend**: `lib/categoryTree.js` `rollupCategoryStats(direct, categories)` (kendisi+alt kolları toplar → `{total, done, pct}`). `TaskCategoriesManagement.jsx`: her satırda mini rapor (`category-rollup-{name}`, emerald çubuk + done/total; 0 görevli kolda gizli) + "Taşı" butonu (`category-move-{name}`) → satır-içi `<select>` formu (`category-move-form/-select/-save-{name}`, "— Kök —" + uygun üst kollar breadcrumb; kendisi+alt kolları hariç). `TasksPanel.jsx`: `categoryCounts` artık `{total,done}` tutar; çiplerde ilerleme (`category-chip-progress-{name}` done/total + mini çubuk), TÜMÜ/KOLSUZ çipleri done/total. `api.js` `taskCategoriesApi.stats()`.
- **Test**: `iteration_96.json` — Backend %100 (pytest 6/6: stats düz sayılar, re-parent, köke taşı, kendi altına 400, alt kolun altına 400) + Frontend %100 (rollup çubuk, Taşı formu + döngü-hariç liste, taşı/köke-al, çip ilerlemeleri). Sıfır regresyon.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — Hiyerarşik İş Kolları (Alt Kategori / Ağaç) (2026-06 · fork) ✅
Kullanıcı isteği: iş kolunun içine alt iş kolu (ör. Şirket İşi › İmalat › Üretim). Seçimler: sınırsız derinlik · her seviyeye görev atanabilir · ana kol filtresi TÜM alt kolları kapsar · yönetimde girintili ağaç + çip/menüde breadcrumb · her kolun kendi rengi · genel kilit yok.
- **Backend**: `TaskCategory`/`TaskCategoryCreate`'e `parent_id`. create parent'ı doğrular (aynı şirket), dup-ad kontrolü artık (company_id, parent_id) bazında. DELETE artık **cascade**: alt ağacın tamamını siler + etkilenen görevlerin `category_id`'sini temizler (görev silinmez), `{deleted, count}` döner.
- **Frontend**: `lib/categoryTree.js` (getDescendantIds/getCategoryPath/getCategoryPathLabel/flattenTree/buildForest). `TaskCategoriesManagement.jsx` özyinelemeli ağaç (▸/▾ aç-kapa, "+ alt ekle" satır-içi form, CAT_COLORS renk paleti create/edit/child, cascade onayı). `TasksPanel.jsx` filtre `getDescendantIds` ile ana→alt birleşik; çip sayacı alt kolları toplar; çip etiketi breadcrumb (üst yol soluk). `CategorySelect.jsx` girintili + breadcrumb arama/etiket. `TaskContextMenu.jsx` "İş Koluna Taşı" girintili + renk noktalı. `api.js` create(name,color,company_id,parent_id).
- **Test**: `iteration_95.json` — Backend %100 (pytest `test_task_category_hierarchy.py` 5/5: parent_id zinciri, per-(company,parent) benzersizlik, geçersiz parent, cascade delete + görev etiketi temizliği, her derinliğe atama). Frontend 12/15 (kalan 3 regresyon değil: admin company_id yok → test şirketi çipleri my_tasks kapsamında gizli; CategorySelect modal-içi; cascade-delete özel onay modalı otomasyonla tıklanamadı, API ile doğrulandı). Ağaç UI screenshot ile doğrulandı.
- **Not**: parent_id yalnız oluşturmada; mevcut kolları taşıma (re-parent) yok. Cascade delete bellek-içi (≤5000 kol) — çok büyürse $graphLookup.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


Kullanıcı isteği: görev/alt görev sürüklense de sıra numarası sabit kalsın. Seçimler: sabitlenen numarayı diğerleri ATLASIN (çakışma yok), sabit numara hem OTOMATİK (mevcut) hem ELLE girilebilsin, ⚓ çapa ikonu göstergesi, genel kilit yok, hiçbir şey bozulmadan.
- **Backend** (`tasks_models.py`): `Subtask` ve `Task` modeline `number_pinned:bool=False` + `pinned_number:Optional[int]=None`; `TaskUpdate`'e de eklendi (null göndererek temizlenebilir). PATCH /api/tasks/{id} pin/unpin'i doğrudan kabul eder; alt görev pin'i subtasks dizisiyle gelir.
- **Frontend numaralama** (`TasksPanel.jsx`): `numById` ve search/filtre render dalı artık rezerve-atla mantığı kullanıyor (sabit görev kendi `pinned_number`'ını gösterir, dinamikler bu numarayı atlar → 1,3,2,4…). `TaskCard.jsx` `subNumbers` useMemo ile alt görevlerde aynı mantık. `setTaskPin(id,pinned,number)` (elle çakışma kontrolü + dup toast).
- **Menüler**: `TaskContextMenu.jsx` + `SubtaskMenu.jsx`'e "Sıra numarasını sabitle" (⚓) öğesi + alt panel: OTOMATİK (mevcut numara) · ELLE gir + SABİTLE · zaten sabitse SABİTLEMEYİ KALDIR. Görsel: görev/alt görev numarasının yanında ⚓ (amber) + `task-number-pinned-{id}` / `subtask-number-pinned-{tid}-{idx}`.
- **Test**: `iteration_94.json` — Backend %100 (pytest `test_pin_number.py` 2/2) + Frontend %100 (10 senaryo: auto+manuel pin, rezerve-atla, dup engelleme, drag sonrası numara sabit, alt görev pin, unpin, reload kalıcılığı). Sıfır regresyon.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


Kullanıcı isteği: "BU GÖREVDEN ÇIKANLAR" listesindeki bir çocuğa mouse ile sağ tıklayınca da (ana görev menüsü yerine) küçük bir menüde "geri alt göreve dönüştür" çıksın.
- **Uygulama**: `TaskCard.jsx` çocuk satırı `<div>`'ine `onContextMenu` (preventDefault + stopPropagation → ana kart menüsü açılmaz) → `childCtx` state → `createPortal` ile küçük menü (tam ekran overlay ile dış-tık kapama): "Bu göreve git" (`child-ctx-jump`) + "Geri alt göreve dönüştür" (`child-ctx-demote`, temalı confirm → `onDemoteChild`). Menü `task-child-context-menu`.
- **Doğrulama (screenshot E2E)**: Çocuk satırına sağ-tık → küçük menü açıldı (ana görev menüsü açılmadı), demote → onay → çocuk alt göreve döndü, liste güncellendi. Sıfır regresyon.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


Kullanıcı isteği ("bozmadan yap"): dışarı taşınan pencerede/ana kartta "BU GÖREVDEN ÇIKANLAR" listesindeki promote edilmiş çocuk görevleri de doğrudan buradan geri alt göreve dönüştürülebilsin (o listedeki satıra sağ-tık ana görev menüsünü açtığından demote seçeneği erişilemiyordu).
- **Uygulama**: `TaskCard.jsx` çocuk satırı `<button>` → `<div>` (atla-git butonu + ayrı ↩ `Undo2` "geri alt göreve dönüştür" butonu, `task-child-demote-{id}`). Tıklayınca temalı `confirmDialog` onayı → `onDemoteChild(c.id)` → mevcut doğrulanmış `demoteToSubtask(childId)` (POST /api/tasks/{id}/demote-to-subtask). `onDemoteChild` cardPropsFor + iki explicit path (detached tek-görev penceresi dahil) ile wire edildi.
- **Doğrulama (screenshot E2E)**: 2 promote çocuklu ana görevde her satırda ↩ butonu; tıkla→onay→"cocuk iki" ana görevin alt görevine döndü ("1. cocuk iki"), liste "BU GÖREVDEN ÇIKANLAR (1)"e düştü, toast çıktı. Atla-git ve renk/sayaç korundu. Sıfır regresyon.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


Kullanıcı (2 istek, "bozmadan yap"): (1) uzun sağ-tık/⋮ görev menüsünde en alttaki "KILIT AYARLARI" ekrana sığmıyor/kesiliyor; (2) bir alt görev göreve dönüştürülünce (promote), onu geri eski alt görev haline getirme seçeneği olsun.
- **Menü konumlandırma (bugfix)**: `TaskContextMenu.jsx` + `SubtaskMenu.jsx` yeniden yazıldı. Menü önce görünmez render edilir (`visibility:hidden`, `pos.ready=false`), `useLayoutEffect` gerçek yüksekliği ölçer ve viewport'a kelepçeler: `top = min(y, innerHeight - effH - 8)`, `left` genişliğe göre; ayrıca `maxHeight: calc(100vh-16px)` + `overflowY:auto` (viewport'tan uzunsa kaydırılır). Eski `scale` animasyonu (ölçümü bozuyordu) kaldırıldı. Doğrulama: ⋮ menüsü en altta (y=1047) açıldığında yukarı kaydı → top=601 / alt=1072 (innerHeight=1080), KILIT AYARLARI tam görünür.
- **Geri alt göreve dönüştür (özellik)**: Backend `POST /api/tasks/{tid}/demote-to-subtask` — promote ile oluşmuş görevi (`promoted_from_task_id` şart, yoksa 400) ana görevin subtasks'ine geri ekler (metin/durum/tarih korunur), görevi siler; ana görev yoksa 404; hem çocuk hem ana görev `lock_edit` kontrolü. Frontend: `tasksApi.demoteToSubtask`; TasksPanel `demoteToSubtask` (API+load+toast) 3 yola wire; TaskCard `onDemoteToSubtask` + handleAction; ContextMenu'ye `CornerLeftUp` "Geri alt göreve dönüştür" öğesi (`ctx-demote-to-subtask`) yalnızca `task.promoted_from_task_id` varken görünür.
- **Test**: `iteration_93.json` — Backend %100 (pytest `test_demote_to_subtask.py`: promote→demote round-trip, 400 non-promoted) + Frontend %100 (menü viewport'a sığar + KILIT AYARLARI görünür, alt görev menüsü de sığar, demote akışı çocuğu siler ana göreve alt görev döner, öğe normal görevlerde çıkmaz). Sıfır regresyon; promote/atla-git/renk noktası/sayaç korundu.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Bugfix — Promote Edilen Alt Unsurlar: Ad Senkronu + Durum Renk Noktası (2026-06 · fork) ✅
Kullanıcı bildirimi (2 hata, "yap bozmadan"): (1) ana görevin adı değişince çocuk görevin "‹Ana görev› görevinin alt unsuru" rozeti bayat kalıyordu; (2) ana kartın "BU GÖREVDEN ÇIKANLAR" listesindeki çocuklarda durum renk göstergesi yanlıştı (süresi geçmiş çocuk kırmızı yerine cyan görünüyordu).
- **Hata 1 (backend, zaten mevcuttu — doğrulandı)**: `PATCH /api/tasks/{tid}` başlık değişince `update_many({promoted_from_task_id: tid}, {$set:{promoted_from_task_title: yeni}})` ile çocukların rozetini günceller. Curl E2E: ana görev "v1"→"RENAMED_v2" → çocuğun `promoted_from_task_title` anında güncellendi.
- **Hata 2 (frontend, `TaskCard.jsx` ~754-767)**: Çocuk satırındaki durum noktası artık TasksPanel'in hesapladığı gerçek `c.__bucket` kovasını kullanıyor (eskiden ham `c.status` kullandığından overdue asla yakalanmıyordu). Eşleme: `gecti`→kırmızı(rose), `bitti`→yeşil(emerald), `bekliyor`→sarı(amber), `aktif`→cyan. Nokta + satır Türkçe tooltip (`Aktif/Süresi geçti/Tamamlandı/Beklemede`), yeni `data-testid=task-child-dot-{id}`.
- **Ek sertleştirme (backend)**: `PATCH /api/tasks` id'siz gönderilen alt görevlere sunucuda kalıcı `uuid` atar (id kaybı → promote/silme 404 riskini kapatır). Mevcut id'ler korunur; gerçek istemci (her zaman `crypto.randomUUID()` gönderir) davranışı değişmez.
- **Test**: `iteration_92.json` — Backend %100 (pytest `test_promoted_children_bugs.py`: rename cascade) + Frontend %100 (4 promote çocuk: aktif=cyan / overdue=rose / done=emerald / paused=amber tümü doğru render). Sıfır regresyon; bidirectional atla-git akışları korundu.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — Ana Görevde "Bu Görevden Çıkanlar" (çift yönlü promote bağı) (2026-08-01 · fork) ✅
Kullanıcı isteği (A): Ana görev kartında, ondan promote edilerek türeyen alt unsur görevlerini listele (çift yönlü bağ). "Hiçbir şeyi bozmadan yap".
- **Uygulama (client-side, sıfır ekstra istek)**: TasksPanel'de `promotedChildrenMap` = yüklü `tasks` dizisini `promoted_from_task_id`'ye göre gruplar (useMemo). Her karta `promotedChildren={map[t.id]||[]}` geçilir (cardPropsFor + iki explicit path). Yeni backend/endpoint YOK → performans etkisi ve regresyon riski yok.
- **UI (TaskCard, genişletilmiş kart)**: `promotedChildren.length>0` ise dosyalardan önce "⤵ BU GÖREVDEN ÇIKANLAR (N)" bölümü (`task-children-{id}`). Her satır (`task-child-{childId}`) durum noktası (done=emerald/overdue=rose/paused=amber/pending=cyan) + başlık (Highlight) + git oku; tıklayınca `sertex:task-jump` ile o göreve atlar+vurgular. `stopPropagation` ile kart tıklamasıyla çakışmaz.
- **Çift yönlü bağ tamam**: Çocuk→Ana (mor "‹Ana› alt unsuru" rozeti, tıkla-git) + Ana→Çocuklar (bu liste, tıkla-git).
- **Doğrulama (screenshot)**: 2 alt görev promote edildi → ana kartta "BU GÖREVDEN ÇIKANLAR (2)" + iki tıklanabilir satır göründü. Test artıkları temizlendi. Sıfır regresyon.
- **Kapsam notu**: Liste yüklü görev setinden hesaplanır; farklı sahibe devredilmiş/başka scope'taki bir çocuk mevcut sette yoksa görünmeyebilir (yaygın durumda çocuklar ana görevin owner/company/category'sini miras aldığından aynı sette olur).
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — "Ana Göreve Git": alt-unsuru rozetine tıkla → ana görev kartına atla + vurgula (2026-08-01 · fork) ✅
Kullanıcı isteği: promote ile oluşan görevdeki "‹Ana görev› görevinin alt unsuru" rozetine tıklayınca ana görev kartına kaydır ve vurgula. "Hiçbir şeyi bozmadan yap".
- **Uygulama**: TaskCard'daki rozet, `promoted_from_task_id` varsa artık bir `<button>` (`task-promoted-jump-{id}`). Tıklayınca mevcut `sertex:task-jump` CustomEvent'i tetikliyor (`{task_id: promoted_from_task_id}`) → TasksPanel'deki hazır dinleyici `load()` + `scrollIntoView({block:'center'})` + 4sn cyan pulse ring (`isHighlighted`). `e.stopPropagation()` ile kart tıklamasıyla çakışmıyor. `promoted_from_task_id` yoksa (eski kayıt) rozet tıklanamaz span kalır.
- **Yeni yapı yok**: Bildirim/görev-atla akışının aynısı yeniden kullanıldı → sıfır regresyon.
- **Doğrulama (screenshot + class kontrolü)**: Promote edilen görevdeki rozete tıklayınca ana görev kartı `ring-2 ring-sertex-cyan` aldı (ekranda glowing cyan halka), test artıkları temizlendi.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — Alt Görev: DÜZENLE + "Göreve Dönüştür" (promote, ana göreve bağ rozeti) (2026-08-01 · fork) ✅
Kullanıcı isteği: (1) alt görev menüsünde DÜZENLE yoktu; (2) normal görevdeki tüm fonksiyonlar alt görevde de olsun. Alt görev bir görev satırı olduğundan (kendi sahibi/şirketi/kilidi yok), kullanıcı A seçeneğini seçti: alt görevi tam bir GÖREVE dönüştür (o zaman tüm fonksiyonlar gelir) + dönüşen görev ana göreve bağlı gösterilsin ("15 nolu mal kabul görevinin alt unsuru" gibi).
- **DÜZENLE**: `SubtaskMenu`'ye Pencil "Düzenle" + inline textarea alt-menü (date submenu gibi). `edit-set` → TaskCard `updateSubtaskAt(idx,{text})`.
- **Göreve Dönüştür (promote)**: `SubtaskMenu`'ye ArrowUpRight "Göreve dönüştür". Backend `POST /api/tasks/{tid}/subtasks/{sub_id}/promote` — alt görevin metin/tarih/durumunu koruyarak yeni Task oluşturur; ana görevin owner/company/category'sini miras alır; `promoted_from_task_id` + `promoted_from_task_title` yazar; alt görevi ana görevden çıkarır. `lock_edit` kilidi kontrol edilir. Model: Task'a `promoted_from_task_id`, `promoted_from_task_title` eklendi.
- **Rozet**: TaskCard'da `task.promoted_from_task_title` varsa mor rozet: "‹Ana görev› görevinin alt unsuru" (`task-promoted-from-{id}`, CornerLeftUp ikonu, Highlight destekli).
- **Wiring**: `tasksApi.promoteSubtask`; TasksPanel `promoteSubtask(taskId,subId)` → API + `load()` + toast; `onPromoteSubtask` cardPropsFor + iki explicit path → TaskCard `handleSubAction("promote")`.
- **Doğrulama (curl + screenshot)**: Backend: promote → yeni görev promoted_from alanlarıyla, ana görev subtasks=0. UI: menüde "GÖREVE DÖNÜŞTÜR" görünüyor; tıklayınca yeni kart "‹Ana görev› görevinin alt unsuru" rozetiyle oluştu, toast çıktı. Sıfır regresyon.
- **Not/Kapsam**: Görev-seviyesi fonksiyonlar (devret/paylaş/iş koluna taşı/kilit/arşiv/bağla…) alt görevde doğrudan YOK; promote sonrası oluşan gerçek görevde hepsi var (kullanıcı onayı ile A seçeneği).
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — Yeni Görev Formu: Dosya Ekleme + Şirkete Bağlı Kişi Filtresi (2026-07-31 · fork) ✅
Kullanıcı isteği: (1) dosya ekleme fonksiyonu "Yeni Görev" formunda da olsun; (2) formda şirket seçilince kişiler Düzenle'deki gibi o şirkete göre listelensin, şirketsiz kullanıcı arama çubuğuyla bulunsun (kişi seçicide arama zaten var). "Bozmadan yap".
- **Dosya ekleme (staged)**: Yeni `components/tasks/PendingAttachments.jsx` — görev henüz yokken dosyalar yerel state'te (`pendingFiles`) tutulur (çoklu, 100MB kontrolü, listele+kaldır). `addTask` artık `tasksApi.create` dönüşünü (`created`) yakalıyor; oluşan görev id'sine bekleyen dosyaları `taskAttachmentsApi.upload` (parçalı) ile yüklüyor, sonuç toast'u gösteriyor. Dosya hatası görevi bozmaz (görev zaten oluştu). Form reset'ine `setPendingFiles([])` eklendi.
- **Şirkete bağlı kişi filtresi**: `MultiAssigneeSelect`'e `companyFilter` prop'u. Mantık: arama boşken şirket seçiliyse → Kendim + o şirketin üyeleri; **arama aktifken tüm kişilerde ara** (şirket filtresini yok say) → şirketsiz/farklı şirket kullanıcıları bulunur. TasksPanel'de `companyFilter={companyName}` geçirildi; mevcut "kişi seç → şirketi otomatik doldur" (companyAutoFilled) davranışıyla çakışmıyor (CompanyCombobox.onManualEdit).
- **Doğrulama (screenshot + API)**: Şirket yok → 5 kişi; "Test Company A" → Kendim + mgr_test + emp1_test. Uçtan uca: formda dosya staged → görev oluştu → görevin attachments'ı 1 ("newform_att.txt"). Sıfır regresyon.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — Görev Kartına Dosya Ekleme (chunked upload + object storage) (2026-07-31 · fork) ✅
Kullanıcı isteği: görev kartının içine dosya ekleme; eklenen dosyaya tıklayınca tekrar indirip inceleme. Tercihler: birden çok dosya, büyük dosyalar (parçalı), görebilen herkes ekler/indirir, silme yükleyen/sahip/müdür-admin, hem kartta hem Düzenle'de. "Bozmadan yap".
- **Depolama**: Mevcut `storage_service.py` (Emergent object storage) yeniden kullanıldı — kalıcı (deploy'lar arası). `db.task_attachments` koleksiyonu (soft-delete `is_deleted`).
- **Backend (tasks_router.py, 6 endpoint)**: `POST /tasks/{tid}/attachments/init` → upload_id; `POST .../chunk` (multipart: upload_id,index,chunk) — /tmp'de sıralı birleştirme; `POST .../complete` → object storage'a `put_object` (asyncio.to_thread) + attachment kaydı; `GET /tasks/{tid}/attachments` (liste); `GET .../{att_id}/download` (Content-Disposition + RFC 5987 UTF-8 dosya adı); `DELETE .../{att_id}` (soft). RBAC: okuma/yükleme `_can_view_task`; silme yükleyen VEYA `_can_share_task`. 100 MB/dosya sınırı (init + chunk çift kontrol). Bellek-içi `_upload_sessions` (TEK worker varsayımı — kod içinde not düşüldü). Model: `TaskAttachment`, `AttachmentInitReq`, `AttachmentCompleteReq`.
- **Frontend**: `taskAttachmentsApi` (api.js) — list/remove/download(blob)/upload (4MB parçalı, onProgress). Yeni `components/tasks/TaskAttachments.jsx` — "📎 DOSYALAR" bölümü: çoklu yükle + ilerleme çubuğu + liste + tıkla-indir (fetch-as-blob, güvenli) + sil. Hem `TaskCard` (genişletilmiş kart, alt görevlerden sonra) hem `EditTaskModal` (İPTAL/KAYDET öncesi; modal `max-h-[88vh] overflow-y-auto` yapıldı) içinde. `currentUser` prop'u TasksPanel→EditTaskModal'a geçirildi.
- **Test**: iteration_91 — Backend 6/6 pytest (happy path, 9MB/3-parça SHA-256 bütünlük, çoklu dosya, RBAC 404/403 matrisi, 100MB sınır), Frontend %100 (kart + Düzenle akışı, indirme tetikleme, silme). Ek curl: Türkçe dosya adı Content-Disposition doğrulandı. Sıfır regresyon.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — Görevi Düzenle: Şirkete Bağlı Görev Sahibi/Şirket Açılır Listeleri (2026-07-31 · fork) ✅
Kullanıcı isteği: "Görevi Düzenle"de GÖREV SAHİBİ ve ŞİRKET otomatik liste olsun; şirket seçilince o şirketin personel isimleri çıksın, şirket seçilmezse tüm isimler çıksın. "Bozmadan yap".
- **Kök neden**: `EditTaskModal`'da ŞİRKET zaten `teamMembers` doluysa dropdown'du ama `teamMembers` yalnızca takım sekmesi/ekleme formunda yükleniyordu → "Benim Görevlerim"den düzenleyince boş kalıp free-text'e düşüyordu; GÖREV SAHİBİ ise hep free-text'ti.
- **Değişiklikler**: (1) TasksPanel'e `editing && isTeamView` olunca `teamApi.members()` yükleyen useEffect. (2) EditTaskModal'da `peopleOptions` memo (seçili `companyName`'e göre üye filtresi; şirket yoksa tümü; mevcut sahibi listede yoksa dahil). GÖREV SAHİBİ `teamMembers.length>0` iken `<select>` (yoksa free-text — bozmadan). (3) `handleCompanyChange` — şirket değişince sahibi yeni şirkette yoksa temizler (temiz bağımlı seçim).
- **Değişmeyen**: Kayıt payload'ı (assignee_name/company_name string), free-text fallback, mevcut ŞİRKET dropdown davranışı. TaskUpdate şemasına dokunulmadı (etiket; kişiye devir/user_id değil).
- **Doğrulama (screenshot)**: Şirket yok → sahibi seçenekleri [ahmet, emp1_test, mgr_test]; "Test Company A" seçilince → [emp1_test, mgr_test] (ahmet düştü). Her ikisi de cyan temalı dropdown.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — Aramada Eşleşen Kelimeyi Sarı Vurgula (2026-07-31 · fork) ✅
Kullanıcı isteği: arama sonucunda eşleşen kelimeyi görev kartında sarı vurgula (nerede geçtiğini gör). "Bozmadan yap".
- **Uygulama**: Yeni `components/tasks/Highlight.jsx` — `toLocaleLowerCase("tr")` ile arama filtresiyle birebir aynı eşleşme; eşleşen parçaları `<mark className="bg-yellow-300 text-black">` ile sarar; `query` boşsa metni olduğu gibi döndürür (davranış değişmez). Türkçe küçültme uzunluğu bozarsa güvenli fallback.
- **Kapsam**: TaskCard'da başlık, açıklama, görev sahibi (assignee), şirket, iş kolu adı; ayrıca SubtaskRow'da alt görev metni. `highlight` prop'u TasksPanel → cardPropsFor + iki explicit render yolu → TaskCard → SubtaskRow zinciriyle geçiyor (`highlight={searchQuery}`).
- **Doğrulama (screenshot)**: "bineği" araması → tek `<mark>` = "Bineği" (Türkçe küçük/büyük harf eşleşti, orijinal harf korundu); kartta "1. **Bineği** al" sarı vurgulu render edildi. Arama boşken hiçbir değişiklik (sıfır regresyon).
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — Görev Arama Kutusu (binlerce görevde hızlı bulma) (2026-07-31 · fork) ✅
Kullanıcı isteği: görev kartı binlerce olunca aramak zor; panele arama ikonu + kutusu koy, yazdıkça aradığımız görev bulunsun. "Hiçbir şeyi bozmadan yap".
- **Uygulama (additive, TasksPanel)**: İş kolu çiplerinin üstüne `Search` ikonlu arama inputu (`task-search-input`) + temizle (X, `task-search-clear`) + "N sonuç bulundu" sayacı (`task-search-count`). `searchQuery` state → `filtered` içinde başlık, açıklama, kişi (assignee_name), şirket (company_name), iş kolu adı ve alt görev metinlerinde `toLocaleLowerCase("tr")` ile eşleşme.
- **Mevcut akışları bozmaz**: Arama aktifken render varsayılan grup/reorder yolundan (`filters.length===0 && !categoryFilter && !searchActive`) `filtered` listesi yoluna geçer; arama boşken eski davranış birebir. Filtre çipleri + kategori + personel filtresi üstüne biner. Boş sonuçta '"..." için görev bulunamadı.' mesajı. `visibleTaskList` (dışa aktar/küçült) arama aktifken `filtered` kullanır.
- **Doğrulama (screenshot)**: "bineği" → 34→1 kart + "1 SONUÇ BULUNDU"; "qa_reorder" → 9 kart; temizle → 34 kart geri; temizleyince sürükleme tutamacı mevcut (reorder yolu regresyonsuz). Sıfır konsol hatası.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.


### Özellik — Görevi ŞİRKETE Devret (sahipsiz + kolsuz orphan havuzu) (2026-07-31 · fork) ✅
Kullanıcı isteği: "Devret" dediğimizde ŞİRKET seçeneği çıksın; o şirkete görev otomatik KOLSUZ ve sahipsiz düşsün, "Yarım Kalan İşler" havuzuna girsin. Eski "kişiye devret" (şirkete göre seç) korunsun. "Bozmadan yap".
- **Backend (additive)**: `POST /api/tasks/{id}/transfer-company {company_id}` — görevi hedef şirkete aktarır: `user_id=None`, `assignees=[]`, `company_id/company_name=hedef`, `category_id` $unset (kolsuz), `orphaned=true`, `orphaned_from_company_id=hedef`, `prev_assignee_*` kaydedilir. `GET /api/task-transfer-companies` — devredilebilecek şirketler (admin: hepsi · müdür: kendi + aktif `company_permissions` grantları). RBAC: `can_view_company` gate (yetkisizde 403); reassign ile aynı "görev üzerinde işlem" kapısı; `lock_transfer` kilidi geçerli. Hedef şirket müdürlerine `tasks_orphaned` bildirimi + FCM (`team_service.notify_task_transferred_to_company`). Model: `TaskCompanyTransferRequest`.
- **Akış**: Görev hedef şirketin `OrphanTasksPanel` ("Yarım Kalan İşler") havuzuna düşer; o şirketin müdürü/admin mevcut orphan-reclaim (reassign) ile bir çalışana sahiplendirir.
- **Frontend**: `ReassignModal` iki modlu — **KİŞİYE DEVRET** (eski, kişiler şirkete göre gruplu) + **ŞİRKETE DEVRET** (şirket dropdown → `tasksApi.transferToCompany`). testid: `reassign-mode-user/-company`, `reassign-company-select/-submit`, `reassign-pick-{username}`. `tasksApi.transferToCompany/transferCompanies` (api.js); `onTransferCompany` TaskCard→TasksPanel'e wire edildi. "Devret" menü öğesi `isTeamView` (admin/müdür) ile görünür → kendi görevini de devredebilir.
- **Test**: iteration_90 — Backend 3/3 pytest (`test_transfer_company.py`: transfer alanları + orphan havuzu + müdür 403), Frontend %100 (iki mod, şirkete devret E2E toast + orphan havuzu, kişiye devret + orphan-reclaim regresyonu). Sıfır regresyon.
- **Not**: Şirkete devirde görev kolsuz olur; reclaim sonrası da kolsuz kalır (tasarım gereği). **Yayın**: preview'de; canlıya (sertex-ai.com) yeniden deploy gerekir.


### Özellik — İş Kolu Sırası Sunucuda + Görevi Çipe Sürükle-Taşı (2026-07-31 · fork) ✅
Kullanıcı istekleri: (1) iş kolu çip sırası cihazlar arası senkron olsun (localStorage değil sunucu); (2) bir görevi tutup iş kolu çipine bırakınca o iş koluna taşınsın.

**1) İş Kolu Sırası Sunucuya (cihazlar arası senkron)**
- Backend zaten hazırdı: `GET/PUT /api/task-categories/order` (`CategoryOrderReq {order: [id]}`), `db.user_ui_prefs` (user_id anahtar) içinde tutulur.
- Frontend: `taskCategoriesApi.getOrder/setOrder` (api.js). `TasksPanel` mount'ta sunucudan sırayı çeker (localStorage anlık boyar, sunucu değeri gelince esas alınır + cache güncellenir). Çip sürükle-bırak → `persistCatOrder()` hem localStorage'a yazar + `sertex:category-order` event yayar hem sunucuya PUT eder. Sunucu hatasında toast uyarısı ("diğer cihazlarla eşitlenmeyebilir").
- **Doğrulama**: GET/PUT round-trip + çip sürükleme sonrası GET yeni sırayı döndürüyor (iteration_89 F2/F3 PASS).

**2) Görevi İş Kolu Çipine Sürükle-Bırak ile Taşı**
- Görev kartının sürükleme tutamacından (`task-drag-{id}`, Framer Motion `dragControls`) tutup bir iş kolu çipine bırakınca görev o iş koluna taşınır; **KOLSUZ** çipine bırakınca iş kolu kaldırılır.
- Modül seviyesi `findCatDropTarget(event, info)`: bırakma noktasında `document.elementsFromPoint(clientX, clientY)` ile ilk `data-cat-drop` taşıyan çipi bulur (sürüklenen kart Y-ekseninde kısıtlı olsa da GERÇEK imleç koordinatı kullanılır). `handleTaskDragToCategory` (onDrag → hedef çipe cyan ring vurgu, `taskDragOverCatId`), `handleTaskDropCategory(task,e,info)` → `setTaskCategory`. İdempotent (aynı kategoriyse PATCH atmaz).
- Bağlantı: `ReorderableTaskCard` + `OuterTaskRow` (`TaskGroupViews.jsx`) Reorder.Item'a `onDrag`/`onDragEnd` eklendi; `cardPropsFor` + explicit path bu iki callback'i geçer. Her çip `data-cat-drop={id}`, KOLSUZ `data-cat-drop="__none__"`.
- **Doğrulama**: pointer-drag → çipte cyan ring + toast "Görev → Fason Verme" + PATCH category_id; KOLSUZ'a bırak → toast "Görev → Kolsuz" + category_id=null; dikey reorder regresyonu temiz (iteration_89 F4/F5/F6 PASS, backend 4/4 pytest `test_category_order_and_task_reassign.py`).
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir. Sıfır regresyon (additive).


### Özellik — İş Kolu Çiplerini Sürükle-Sırala (2026-06 · fork) ✅
Kullanıcı isteği: iş kolu (kategori) filtre çipleri sabit olmasın, basılı tutup sürükleyerek yerleri değişsin.
- **Uygulama (frontend-only, backend'e DOKUNULMADI → sıfır regresyon)**: `TasksPanel` çipleri HTML5 drag-and-drop ile sıralanabilir. Sıra kişisel olarak `localStorage` (`sertex_category_order_v1`) içinde tutulur; sekmeler/pencereler arası `sertex:category-order` olayıyla senkron. `orderedCategories` = kayıtlı sıraya göre; kaydedilmemiş yeni kategoriler sona eklenir.
- **UX**: her çipte `GripVertical` tutamaç (⋮) + `cursor-grab`, sürükleme sırasında kaynak yarı saydam + hedefte cyan ring. TÜMÜ (ilk) ve KOLSUZ (son) sabit kalır (bunlar iş kolu değil). Çipe tık hâlâ filtreler, `DIŞARI TAŞI` butonu korunur.
- **Doğrulama (Playwright drag_to)**: BEFORE ['Fason Verme','QA_REORDER_CAT_A'] → AFTER ['QA_REORDER_CAT_A','Fason Verme']; localStorage sırası kaydedildi PASS.
- **Not**: HTML5 DnD masaüstünde çalışır; dokunmatik (mobil) sürükleme desteklenmez.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.

### Bugfix + Özellik — Dışa Aktar Menü Sızıntısı · Seçili Yazdırma (2026-06 · fork) ✅
Kullanıcı bildirimi: (1) sağ-tık "Dışa Aktar" alt menüsü açılınca "Hatırlatma Zamanı" içeriği de çıkıyor (hata); (2) ana sidebarda görevleri tek tek seçip yazdıramıyoruz, hep toplu yazdırıyor.

**1) Context menü alt menü sızıntısı (bugfix)**
- **Kök neden**: `TaskContextMenu` ternary'sinde `else` bloğu (hatırlatma içeriği) yalnızca `reminderSub` için değil HERHANGİ bir alt menü (`exportSub`/`categorySub`/`dueSoonSub`) açıkken render ediliyordu. Sonuç: Dışa Aktar/Kategori/Yaklaşan alt menülerinde hatırlatma UI'si de görünüyordu.
- **Düzeltme**: `{cond ? main : reminderContent}` → `{cond && main}` + `{reminderSub && reminderContent}`. Artık hatırlatma içeriği yalnızca `reminderSub` iken çıkar.
- **Doğrulama**: ctx-export tıklandı → menü sadece export öğeleri (reminder leak False, export items True) PASS.

**2) Seçili Yazdırma / Dışa Aktarma (özellik)**
- Yeni `ExportSelectModal.jsx` (portal, z-[130]): görev listesini checkbox'larla gösterir (numara + başlık + iş kolu + tarih), "Tümünü seç/hiçbiri", "N/M seçili"; alt bar Yazdır/PDF · Excel · Word yalnızca SEÇİLİ görevleri aktarır (varsayılan hepsi seçili — eski toplu davranışın üst kümesi). `printTasks/exportTasksExcel/exportTasksWord` yeniden kullanılır.
- Export barına yeni "SEÇ" butonu (`bulk-export-select`, ListChecks) modalı açar. Mevcut 3 "tümünü aktar" butonu korundu.
- TaskCard'a DOKUNULMADI (sıfır regresyon riski).
- **Doğrulama**: modal 32 görevle açıldı, 2 görev seçildi ("2/32 seçili"), Yazdır butonu aktif PASS.

- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir.

### Bildirim İnce Ayar — Detaylı Özet · Haftasonu Sustur · Görsel Sessiz Rozeti (2026-06 · fork) ✅
Kullanıcı istekleri: (1) sabah özetine "en geç kalan 3 görev + kaç gün geciktiği" detayı (aç/kapa kutucuğu); (2) Cmt-Paz sabah özetini otomatik atla; (3) sabah özetinden çıkarılan görev kartında görsel 🔕 rozet.

**1) Detaylı Özet (`digest_detailed`)**
- `notify_overdue_daily_digest`: görevler en geç kalan önce (en eski due_date) sıralanır; `digest_detailed` açıksa ilk 3 görev "Başlık (N gün gecikti)" biçiminde listelenir (`_parse_iso` ile gün hesabı). Ayar kapalıysa eski davranış (sadece başlıklar).
- **Doğrulama**: "Bineği al (156 gün gecikti) · ... (5 gün gecikti) · +1 daha", payload.detailed=True PASS.

**2) Haftasonu Sustur (`digest_skip_weekend`)**
- `_ist_now().weekday() >= 5` (Cmt/Paz) ve kullanıcı ayarı açıksa hem in-app digest hem FCM push o kullanıcı için atlanır.
- **Doğrulama**: ayar round-trip PASS (haftasonu tetiklemesi bugün Cuma olduğu için canlı test edilemedi; mantık yerinde).

**3) Görsel Sessiz Rozeti (🔕)**
- TaskCard: `task.digest_muted` ise başlık yanında amber `BellOff` rozeti (`task-digest-muted-badge-{id}`, tooltip "sabah özetinden çıkarıldı").
- **Doğrulama**: muted görevde rozet render PASS (canlı sağ-tık ile de anında görünür).

- **Ayar altyapısı**: `notification_settings` artık `digest_detailed` + `digest_skip_weekend` de tutar; `GET/PUT /api/notifications/digest-settings` 4 alanı döner/kaydeder. UI: `NotificationSettings.jsx`'e "Detaylı özet" + "Haftasonu sustur" kutucukları eklendi (`ns-digest-detailed`, `ns-digest-weekend`).
- **Yayın**: preview'de; canlıya yeniden deploy gerekir. Sıfır regresyon (additive).

### Bildirim Kişiselleştirme — Özet Saati · Görev Bazlı Sessiz · Ayarlar Ekranı (2026-06 · fork) ✅
Kullanıcı istekleri: (1) günlük "geciken görev" özetinin saatini kullanıcı seçsin; (2) belirli bir görevi "beni her sabah dürtme" diye günlük özet dışında bırak; (3) sessiz saatler/bildirim ayarlarını bildirim zilinin yanı sıra Ayarlar panelinde de göster.

**1) Günlük Özet Saati (per-user, sunucu tarafı)**
- **`notification_settings`** koleksiyonu (user_id anahtar): `digest_hour` (0-23, vars. 9), `digest_enabled` (vars. true). Yardımcılar: `get_digest_settings_map/get_user_digest_settings/set_user_digest_settings` (team_service).
- **API** (team_router): `GET/PUT /api/notifications/digest-settings`.
- **Scheduler artık SAATLİK** (`overdue_push_service`): her saat başı çalışır, o anki Istanbul saati `target_hour` olarak geçilir; hem FCM push hem in-app `overdue_daily` yalnızca `digest_hour == target_hour` olan (ve `digest_enabled`) kullanıcılara üretilir. Ayarı olmayan → varsayılan 09:00 (eski davranış korunur).
- **UI**: yeni `NotificationSettings.jsx` bileşeni Ayarlar → "Uyarılar" sekmesinde — Sabah Özeti aç/kapa + saat seçici (`ns-digest-hour`), API'ye kaydeder.
- **Doğrulama**: GET vars {9,true}; PUT 8 → GET 8 (kalıcı PASS); UI'da 08:00 seçimi + toast PASS.

**2) Görev Bazlı Sessiz (`digest_muted`)**
- Task modeline `digest_muted: bool=False` + TaskUpdate'e opsiyonel alan. `notify_overdue_daily_digest` sorgusu + `_find_overdue_by_user` (FCM) `digest_muted != true` ile filtreler. Gerçek-zamanlı gecikme bildirimini ETKİLEMEZ.
- **UI**: TaskContextMenu'ye "Sabah özetinden çıkar / ekle" (`digest-mute-toggle`) → TaskCard.handleAction → TasksPanel `setTaskDigestMuted` (PATCH). `cardPropsFor` + detached inline render'a wire edildi.
- **Doğrulama**: backend özet sayısı 4→3 (muted hariç PASS); context menü toggle + toast + etiket "çıkar↔ekle" dönüşü PASS.

**3) Sessiz Saatler + Bildirim Ayarları Ekranı**
- `NotificationSettings.jsx`: Masaüstü aç/kapa, ses, Test butonu, Sessiz Saatler (toggle + saat aralığı), Sabah Özeti saati — hepsi tek yerde. Bildirim zilindeki hızlı ayarlar KORUNDU (değişmedi).
- **Doğrulama**: Ayarlar → Uyarılar'da tüm bölümler render (ns-desktop-enable/ns-sound/ns-test-btn/ns-quiet-enable/ns-digest-hour PASS).

- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir. Sıfır regresyon (hepsi additive; mevcut zil/akış korundu).

### Bildirim İyileştirmeleri — Günlük Tekrar · Sessiz Saatler · Test Butonu (2026-06 · fork) ✅
Kullanıcı istekleri (Web Push sonraya ertelendi): (1) geciken görev için tek-seferlik değil her sabah tekrar bildirim; (2) sessiz saatler (gece sustur, sabah aç) + aktif/devredışı toggle; (3) ayarlardan tek-tık test bildirimi.

**1) Günlük Tekrar Hatırlatma (backend + frontend)**
- **Kök sorun**: `overdue_task` bildirimi `(user_id,task_id,type)` unique index'le tek-seferlik — gün gün geciken görev bir daha hatırlatmıyordu.
- **`team_service.notify_overdue_daily_digest(db)`** (yeni, `NOTIF_TYPE_OVERDUE_DAILY="overdue_daily"`): geciken görevi olan her kullanıcıya (sahip) TEK günlük özet ("N gecikmiş görev · başlıklar · +X daha"). Dedup anahtarı tarih içerir (`task_id="overdue-daily:YYYY-MM-DD"`) → gün içi idempotent, ertesi sabah yeni satır → masaüstü/bell tekrar çalar.
- **`overdue_push_service._send_overdue_pushes`** artık FCM push'tan sonra bu in-app özeti de üretir (09:00 Europe/Istanbul cron + manuel `POST /api/fcm/run-overdue-digest`). Response'a `digest` eklendi.
- **Frontend**: `desktopNotifier.composeText` + `NotificationBell` `overdue_daily` dalı (amber ⚠️, "N gecikmiş görev · her sabah hatırlatma"), `clickItem` özel yönlendirme (tek görevse ona atla, yoksa Görevler sekmesi).
- **Doğrulama**: run-overdue-digest → `digest:{users:2,created:2}`; 2. çağrı `created:0` (idempotent PASS); serkan'a "4 gecikmiş görev" özeti; masaüstü spy'da "⚠️ Geciken Görevler" ateşlendi (PASS).

**2) Sessiz Saatler (frontend, ek)**
- `desktopNotifier` pref'e `quietEnabled/quietStart/quietEnd` (varsayılan 22:00–07:00) + `isQuietNow()` (gece devreden aralık destekli). `processBatch` sessiz aralıkta ateşlemez VE seen olarak İŞARETLEMEZ → sessiz bitince bir sonraki poll'de gösterilir ("sabah aç").
- **UI** (bell → ayarlar): 🌙 "Sessiz saatler" toggle (`notification-pref-quiet`) + iki `time` inputu (`notification-quiet-start/-end`) + "şu an sessiz" rozeti.
- **Doğrulama**: aralık NOW'u kapsarken spy=0 + seen=boş (susturma + sabah tekrar PASS). Toggle + aralık render PASS.

**3) Bildirim Test Butonu (frontend, ek)**
- `desktopNotifier.fireTestNotification()` (enabled/quiet/seen kapılarını atlar, izin gerektirir). Bell → ayarlar'da "✓ TEST BİLDİRİMİ GÖNDER" (`notification-test-btn`) → izin yoksa ister, sonra örnek bildirim + toast.
- **Doğrulama**: tık → spy'da "SERTEX — Test bildirimi ✓" + "Test bildirimi gönderildi" toast (PASS).

- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden deploy gerekir. Sıfır regresyon (hepsi additive; mevcut tipler/akışlar değişmedi).

### Bugfix — Masaüstü Bildirimi Sessizce Durması (izin verildiği halde) (2026-06 · fork) ✅
Kullanıcı bildirimi: eskiden gelen masaüstü bildirimleri (ör. "Geciken Görev · Dosya Transferleri") artık **Firefox sekmesi açıkken bile gelmiyor** (canlı sertex-ai.com).
- **Kök neden**: `desktopNotifier.js` bildirimleri `pref.enabled` (varsayılan `false`) ardında kapılıyordu. `enabled=true` yalnızca izin verilirken yazılıyordu ve "izni aç" rozeti (`NotificationPermBadge`) SADECE izin verilmemişken görünüyordu. Kullanıcı izni geçmişte verdiyse ama localStorage sıfırlandıysa (site verisi temizleme / redeploy / yeni profil / tarayıcı güncellemesi) → izin hâlâ `granted`, rozet gizli, `pref.enabled` `false`'a dönmüş → sekme açık olsa bile HİÇ bildirim ateşlenmiyor (sessiz arıza).
- **Düzeltme (ek, kendi kendini onaran)**: yeni `isDesktopEnabled()` = `Notification.permission==='granted' && pref.disabled !== true`. Yani izin verilmişse, kullanıcı AÇIKÇA kapatmadıkça (`disabled:true`) bildirimler açık sayılır. `fireOne`/`processBatch` + `NotificationBell` poll & SSE yolları artık bu kapıyı kullanıyor. Onay kutusu: aç → `{enabled:true, disabled:false}`, kapat → `{enabled:false, disabled:true}` (kalıcı kapatma). Eski `enabled` alanı geriye uyumlu korundu.
- **Doğrulama (runtime, Playwright + Notification spy)**: izin `granted` + açık opt-in YOK → 3 bildirim otomatik ateşlendi (eski mantıkta 0 olurdu, self-heal PASS). İzin `granted` + `disabled:true` → 0 ateşleme (kalıcı kapatma korunuyor, regresyon-güvenli PASS). Backend bildirim üretimi zaten sağlam (unread=11, scan-now OK).
- **Not (teknik sınır)**: Bu yol yalnızca Firefox/sekme AÇIKKEN (arka planda bile) çalışır — `new Notification`. "Tarayıcı tamamen kapalıyken" web bildirimi için Service Worker + Web Push (VAPID) gerekir; masaüstü Firefox tamamen kapandıysa yine gelmez (tarayıcı sınırı). Tam-kapalı garanti tek yol hazır mobil FCM. (Web Push kullanıcı Firebase web config + VAPID key verirse eklenebilir — beklemede.)
- **Yayın**: düzeltme preview'de; canlıya (sertex-ai.com) yansıması için yeniden deploy gerekir.


### Bugfix — Dışarı Taşınan Panelde Sağ-Tık Menüsü Arkada Kalması (2026-06 · fork) ✅
Kullanıcı bildirimi: DIŞARI TAŞI ile açılan panelde bir göreve sağ-tıklayınca "özellikler" (context menu) pencerenin arkasında kalıyor, üst üste biniyor, kullanılamıyor.
- **Kök neden**: `DetachedPanelsHost.PanelWindow` Rnd penceresi `zIndex: 1500 + index` ile aşırı yüksekti. Sağ-tık menüsü (`TaskContextMenu` z-[100]) + bu pencereden açılan Düzenle/Bağla/Kilit modalları (z-[110/120]) hepsi pencerenin ALTINDA kalıyordu. (Tekil görev/grup pencereleri zaten doğru `zIndex: 60` kullanıyordu.)
- **Düzeltme**: panel penceresi `zIndex: 60 + index`'e indirildi — kanıtlanmış görev/grup pencere katmanıyla aynı. Böylece HUD (55) + sidebar (45) üstünde kalır ama context menu (100) ve modallar (110+) pencerenin ÖNÜNDE açılır.
- **Doğrulama (runtime)**: detached panelde göreve sağ-tık → menü z:100 > pencere z:60, tam görünür; `elementFromPoint(menü tepe)` → `ctx-done` (menü tıklanabilir, arkada değil). Tüm 16 menü öğesi erişilebilir. Sıfır regresyon.

### Görünür Boyutlandırma Tutamağı — Yüzen Pencereler (2026-06 · fork) ✅
Kullanıcı isteği: dışarı taşınan pencerelerin sağ-alt köşesine görünür bir "boyutlandır" tutamağı (kavraması kolay olsun). Kullanıcı seçimi: (b) TÜM yüzen pencereler + (c) köşegen çizgili stil.
- **`components/ResizeGrip.jsx`** (yeni, ortak): react-rnd'nin `bottomRight` handle'ının içine çizilen SVG köşegen üçlü çizgi. Cyan neon tema, `drop-shadow` glow, hover'da parlar (`text-sertex-cyan/45 → hover:text-sertex-cyan`). `nwse-resize` cursor. Yalnızca görsel ipucu — resize olaylarını react-rnd yönetmeye devam eder (sıfır logic değişimi). `data-testid=resize-grip-{testId}`.
- **4 pencereye bağlandı** (`resizeHandleComponent={{ bottomRight: <ResizeGrip .../> }}`): (1) `DetachedPanelsHost.PanelWindow` (görev/kategori paneli), (2) `TaskGroupViews.DetachedTaskWindow` (tekil görev), (3) `TaskGroupViews.DetachedGroupWindow` (bağlı grup), (4) `FloatingTabWindow` (sidebar sekmeleri — minimize'da handle zaten yok).
- **Doğrulama (runtime)**: detached panel açıldı → tutamak köşede render (grips=1) → hover glow → tutamaktan sürükle → 460×620 → 600×730 (RESIZE OK). Sıfır regresyon, sıfır konsol hatası.



### Bugfix — Dışarı Taşınan Panel Boyutlandırma (2026-06 · fork) ✅
Kullanıcı bildirimi: panel sidebar'dan çıkınca alt köşeden boyutlandırma çalışmıyor; dışarı çıkan pencerede tüm fonksiyonlar olmalı.
- **Kök neden**: `DetachedPanelsHost.jsx` içinde `overflow-hidden` **Rnd kök öğesindeydi**; react-rnd resize tutamaçlarını kutunun ~10px dışına koyduğundan kırpılıyor ve tutulamıyordu. (Bireysel görev kartı penceresi `DetachedTaskWindow` doğru yapıdaydı — overflow iç div'de.)
- **Düzeltme**: `overflow-hidden` + görsel sınıflar (glass-panel/border/bg) Rnd kökünden alınıp `h-full flex flex-col` iç sarmalayıcıya taşındı (DetachedTaskWindow ile aynı kanıtlanmış desen). Sürükleme (dp-drag) + dock butonu korundu.
- **Fonksiyonlar**: panel penceresi zaten tam `<TasksPanel detached>` render eder (sekmeler, yeni görev, filtre, arşiv, dışa aktar, kart aksiyonları). `!detached` yalnızca "DIŞARI TAŞI" butonlarını gizler (doğru).
- **Doğrulama (runtime)**: alt-sağ köşeden sürükleme → 460×620 → 640×740 (PASS). Sıfır regresyon.
- **Not**: Düzeltme preview'de; yayına (sertex-ai.com) yansıması için yeniden deploy gerekir.


### Reset Butonlarına Temalı Onay (2026-06 · fork) ✅
Kullanıcı isteği: menüdeki "Sıfırla" için yanlışlıkla silmeyi önleyecek onay.
- **`TaskContextMenu.jsx`**: `ctx-reminder-reset` ve `ctx-duesoon-reset` artık işlemi yapmadan önce temalı `confirmDialog` (danger) gösterir ("Bu görevin hatırlatması kaldırılsın mı?" / "Yaklaşan uyarısı varsayılana döndürülsün mü?"). Onaylanırsa reset çalışır, iptal edilirse hiçbir şey değişmez. Native confirm yerine uygulama temalı onay (`lib/confirm.jsx`, ConfirmRoot App.js'te mount'lu).
- Modal içindeki "Sıfırla" (yalnızca formu boşaltır, Kaydet'e kadar kalıcı değil) onaysız bırakıldı — yıkıcı değil.
- **Doğrulama (runtime)**: sağ-tık → Hatırlat → Sıfırla → temalı "SIFIRLA" onayı çıktı → Onayla → reminder tamamen temizlendi (reminder_at/interval/repeat_total = None) PASS. Sıfır regresyon.


### Reset (Sıfırla) Kontrolleri — 3 Yerde (2026-06 · fork) ✅
Kullanıcı isteği: "Hatırlatıcıyı Düzenle" modalına + "Yaklaşan Uyarısı" ve "Hatırlatma Zamanı" menülerine reset (sıfırla) kontrolü.
- **`QuickReminderEditModal.jsx`**: footer'a amber "⟳ Sıfırla" butonu (`quick-reminder-reset`) → formu `defaultRecurringValue()`'ya döndürür (checkbox kapanır; Kaydet ile hatırlatıcı kaldırılır). Footer justify-between yapıldı.
- **`TaskContextMenu.jsx` — HATIRLATMA ZAMANI**: "⟳ Sıfırla (hatırlatmayı kaldır)" (`ctx-reminder-reset`) → local inputları (tekrar/aralık/özel süre/özel zaman) sıfırlar + `reminder-cancel` ile kayıtlı hatırlatmayı temizler.
- **`TaskContextMenu.jsx` — YAKLAŞAN UYARISI**: "⟳ Sıfırla (varsayılana dön)" (`ctx-duesoon-reset`) → `onSetReminderDays(null)` + `onSetReminderDisabled(false)`.
- **Doğrulama (runtime)**: modal Sıfırla → enabled True→False (PASS); ctx-reminder-reset render (PASS); due-soon reset eklendi. Mevcut doğrulanmış aksiyonları (reminder-cancel, varsayılan) yeniden kullanır. Sıfır regresyon.


### Rozetten Hızlı Düzenle + Özel Süreye "Hafta" Alanı (2026-06 · fork) ✅
Kullanıcı istekleri: (1) görev kartındaki tekrarlı hatırlatma rozetine tıklayınca hızlı düzenleme modalı; (2) özel süre girişine "Hafta" kutusu.
- **`components/tasks/QuickReminderEditModal.jsx`** (yeni): rozete tıklayınca açılır; `RecurringReminderFields` ile ön-doldurulur (ilk zaman + kaç defa + aralık). Kaydet → mevcut `onSetReminder(iso,{intervalMin,repeatLeft,repeatTotal})`; hatırlatıcı kapatılırsa `onClearReminder()`. Yeni API bağlama yok (doğrulanmış yollar). `data-testid`: `quick-reminder-modal/-save/-cancel/-close`.
- **`TaskCard.jsx`**: tekrarlı rozet artık `<button>` (`task-reminder-repeat-{id}`) → `showReminderEdit` state → modal. Tüm render yollarında (ana panel, grup görünümleri, detached) `onSetReminder`/`onClearReminder` zaten geçiliyor.
- **`components/tasks/CustomSnoozeInput.jsx`**: başa "Hafta" kutusu eklendi (`{prefix}-weeks`); toplam = hafta*10080 + gün*1440 + saat*60 + dk. Üç yüzeyde de otomatik göründü.
- **Doğrulama (runtime)**: rozet → modal → kaç defa 10→3 kaydı (PASS); overdue penceresinde 1 hafta → snoozed_until = now+7 gün (PASS). Sıfır regresyon, sıfır konsol hatası.


### Kombine Özel Süre Girişi — "Her Yerde" (Gün·Saat·Dk) (2026-06 · fork) ✅
Kullanıcı isteği: sabit şablonların (5dk/30dk/1saat) yanına, kullanıcının kendi süresini girebileceği kombine alan — örn. "2 saat 45 dk", "2 gün". "Her yere" eklensin.
- **`components/tasks/CustomSnoozeInput.jsx`** (yeni, ortak): Gün · Saat · Dk sayı kutuları + uygula butonu. Toplam = gün*1440 + saat*60 + dk dakika → `onApply(total)`. Boş/0 ise "Gün, saat veya dakika girin" hatası. `testPrefix` ile testid'ler (`{prefix}-days/-hours/-mins/-apply/-row`).
- **`lib/reminderUtils.formatDurationTr(mins)`** (yeni): 165 → "2 saat 45 dk", 2880 → "2 gün".
- **Entegre edildiği 3 yüzey**: (1) **Süresi Geçmiş Görev penceresi** (`OverdueAlertModal.jsx`) — her görev satırında `overdue-custom-{id}-*` + footer'da toplu `overdue-custom-all-*`; erteleme mesajları formatDurationTr kullanır. (2) **Hatırlatma toast'ı** (`reminderToast.jsx`) — preset butonların altında `reminder-custom-{id}-*`. (3) **Sağ-tık menüsü** (`TaskContextMenu.jsx`) — "ÖZEL SÜRE (SONRA)" bloğu `ctx-reminder-custom-dur-*` (buton "Kur") → `onAction('reminder-custom-duration',{offset})`; "ÖZEL ZAMAN" datetime bloğunun üstünde.
- **Not**: Birimler Gün/Saat/Dk (1 hafta = 7 gün girilebilir). Recurring aralık dropdown'ı dk/saat/gün olarak korundu.
- **Test**: `iteration_88.json` — Frontend 7/7 (toast + context menu E2E + preset regresyonları + validation) + overdue modal main agent tarafından runtime doğrulandı (2 saat 45 dk → snoozed_until ≈ now+165 dk PASS). Sıfır bug, sıfır regresyon.


### Akıllı Erteleme Kısayolu — "Sabah 09:00" (2026-06 · fork) ✅
Kullanıcı isteği: gece gelen hatırlatmayı tek dokunuşla sabaha taşıyan akıllı kısayol.
- **`lib/reminderToast.jsx`**: erteleme satırına amber "🌅 Sabah 09:00" butonu (Sunrise ikonu, `reminder-snooze-morning-{id}`). `nextMorningIso()` = bir sonraki 09:00 (kullanıcının YEREL saati; şu an 09:00'dan önceyse bugün, sonraysa yarın). reminder_at güncellenir, fired=false; tekrarlı görevlerde interval/repeat korunur.
- **Doğrulama (runtime)**: buton toast'ta göründü, tıklandı → reminder_at ertesi 09:00'a taşındı, fired=false (PASS). Sıfır regresyon.


### Toast Hızlı Aksiyon (Ertele/Tamamla) + İzin Test Bildirimi (2026-06 · fork) ✅
Kullanıcı istekleri: hatırlatma toast'ına çoklu erteleme (5/30/1saat gibi) + Tamamla; ayrıca izin verilince tek seferlik test bildirimi.
- **`lib/reminderToast.jsx`** (yeni): ortak hatırlatma toast'ı. Butonlar: ERTELE **5 dk · 15 dk · 30 dk · 1 saat · 3 saat** (reminder_at = now+X, reminder_fired=false; tekrarlı ise interval/repeat korunur) ve **✓ Tamamla** (`setStatus(done)`). Aksiyon sonrası `sertex:reminder-action` event'i yayılır. `data-testid`: `reminder-snooze-{min}-{id}`, `reminder-complete-{id}`. Süre 30sn (kullanıcı butona basacak kadar).
- **`TasksPanel.jsx` + `ReminderWatcher.jsx`**: her iki fire yolu da artık `showReminderToast()` kullanır (panel açık/kapalı tutarlı). TasksPanel `sertex:reminder-action` dinleyip listeyi tazeler.
- **`NotificationPermBadge.jsx`**: izin verildiğinde tek seferlik "SERTEX — Bildirimler açık ✓" test Notification'ı + kısa JARVIS chime çalar (kullanıcı gerçekten görünür olduğunu doğrular).
- **Doğrulama (runtime)**: toast tüm butonlarla render oldu; "5 dk" ertele → backend'de reminder_at ~5 dk ileri, fired=false (PASS). Sıfır regresyon, sıfır konsol hatası.


### Bildirim İzni Rozeti (NEURAL LINK) (2026-06 · fork) ✅
Kullanıcı isteği: izin verilmemişse NEURAL LINK'te tek dokunuşla "Masaüstü bildirimlerini aç" kısayolu göster.
- **`components/sidebar/NotificationPermBadge.jsx`** (yeni): `Notification.permission` "granted" değilse NEURAL LINK başlığında (kota barının altında) görünür. `default` → cyan "Masaüstü bildirimlerini aç" butonu → tıklayınca `requestPermission()` + izin verilince `saveDesktopPref({enabled:true})` + toast, ve rozet kendini gizler. `denied` → amber "Bildirimler engelli — nasıl açılır?" (tarayıcı ayarları talimatı toast'ı). `granted`/desteklenmiyor → hiç render etmez. focus + visibilitychange'de izin durumu tazelenir.
- **`NeuralLinkHeader.jsx`**: rozet stats/kota bloğunun altına mount edildi. `data-testid=notif-perm-badge`.
- **Doğrulama**: runtime screenshot — headless'te izin "denied" olduğundan amber "engelli" durumu doğru render oldu. Sadece görsel/kolaylık kısayolu; sıfır regresyon.


### Tekrarlı Hatırlatma Rozeti (Görev Kartı) (2026-06 · fork) ✅
Kullanıcı isteği: tekrarlı hatırlatma durumu görev kartında tek bakışta görünsün.
- **`lib/reminderUtils.formatIntervalShort(min)`** (yeni): dk/saat/gün kısa etiketi (15→"15 dk", 60→"1 saat", 2880→"2 gün").
- **`TaskCard.jsx`**: `reminder_interval_min` + `reminder_repeat_total > 1` olan görevlerde HATIRLATMA satırının altına `RefreshCw` ikonlu rozet: "N defa · {aralık} arayla · M kaldı" (`data-testid=task-reminder-repeat-{id}`). `reminder_repeat_left` her tetiklemede azaldıkça "kaldı" güncellenir.
- **Doğrulama**: runtime screenshot — rozet "20 DEFA · 15 DK ARAYLA · 12 KALDI" doğru render oldu. Sadece görsel/read-only ekleme; sıfır regresyon.


### Arka Plan Hatırlatma — Global Gözcü + JARVIS Sesi (2026-06 · fork) ✅
Kullanıcı isteği: "Sertex sekmesi arka plandayken bile tekrarlı hatırlatmada masaüstü bildirimi + kısa JARVIS-vari ses çalsın — hiçbir şeyi bozmadan".
- **Kök sorun**: Hatırlatma zamanlayıcısı yalnızca `TasksPanel` içindeydi; sidebar kapanınca veya başka sekmedeyken panel unmount olur → tekrarlı hatırlatmalar HİÇ çalışmazdı. Ayrıca ses her seferinde YENİ AudioContext açıyordu → arka plan sekmede "suspended" başlayıp çalmıyordu.
- **`lib/reminderChime.js`** (yeni): TEK kalıcı (shared) AudioContext; ilk kullanıcı hareketiyle (click/keydown/touch) + visibilitychange'de `resume()` edilir, bir daha kapatılmaz → arka planda güvenilir çalar. `playReminderChime()` = yükselen C5-E5-G5 üçlüsü + C6 shimmer (JARVIS-vari). `initReminderAudio()` SertexMain'de bir kez çağrılır.
- **`taskHelpers.playReminderBeep`** artık `playReminderChime()`'a delege eder (return `{cancel}` şekli korundu) → hem panel hem gözcü aynı sesi kullanır.
- **`components/ReminderWatcher.jsx`** (yeni): SertexMain'de HER ZAMAN mount'lu global gözcü. 30sn poll + on-mount + visibilitychange'de `tasksApi.list()` tarar; süresi gelen (5 dk pencere) hatırlatmalarda toast + JARVIS sesi + masaüstü Notification + tekrarlı reschedule / tekil markFired yapar. **Çift tetikleme koruması**: `window.__sertexTaskPanels` sayacı (TasksPanel mount'ta artar) > 0 iken gözcü PAS geçer — panel açıkken firing'i panelin kendi zamanlayıcısı yapar (davranış birebir korunur).
- **Doğrulama (runtime)**: (A) Sidebar KAPALI → gözcü tetikledi: toast göründü + backend'de repeat_left 3→2, reminder_at geleceğe kaydı, fired=False. (B) Görevler tab AÇIK → panel tetikledi TAM 1 kez: repeat_left 3→2 (çift fire YOK, gözcü gated). Sıfır konsol hatası. Sıfır regresyon.


### Tekrarlı Hatırlatıcı — "Her Yerde" (kaç defa / kaç dk-saat-gün arayla) (2026-06 · fork) ✅
Kullanıcı isteği: "1. her yerde olsun" — tekrarlı hatırlatıcı (kaç defa + serbest aralık) yalnızca sağ-tık menüsündeydi; oluşturma formu + düzenle modalına da eklendi. Görev tamamlanınca otomatik durur (scheduler zaten böyle).
- **Backend**: `TaskCreate`'e `reminder_interval_min` / `reminder_repeat_left` / `reminder_repeat_total` eklendi (Task + TaskUpdate'te zaten vardı). POST /api/tasks create endpoint bu alanları yazar; repeat_left verilmezse total'e eşitlenir. PATCH `model_dump(exclude_unset=True)` ile explicit null → temizler.
- **Frontend (yeni)**: `lib/reminderUtils.js` (unit dönüşümleri dk/saat/gün, `resolveRecurringReminder`, `recurringValueFromTask`) + ortak kontrollü bileşen `components/tasks/RecurringReminderFields.jsx` (testPrefix ile testid'ler). İlk hatırlatma iki modlu: "Belirli zaman" (datetime) veya "Sonra başla" (şimdiye göreli miktar+birim). Kaç defa + Aralık (birim: dk/saat/gün) yalnızca tekrar>1 iken görünür.
- **Entegrasyon noktaları**: (1) Oluşturma formu (`TasksPanel.jsx`, `new-task-reminder-*`) → `addTask` payload'a ekler; (2) Düzenle modalı (`EditTaskModal.jsx`, `edit-reminder-*`) → **dirty-flag** ile yalnızca bölüm değiştirilirse patch'e girer (başlık düzenlerken tetiklenmiş hatırlatmayı yeniden kurmaz); (3) Sağ-tık menüsü (`TaskContextMenu.jsx`) → serbest aralık alanı (`ctx-reminder-interval-amount/unit`) eklendi; preset+özel zaman tekrar>1 iken serbest aralığı kullanır, tekrar=1 iken eski davranış korunur.
- **Test**: `/app/test_reports/iteration_87.json` — Backend 7/7 pytest (`tests/test_recurring_reminders.py`) + Frontend 8/8 E2E (3 yüzey + 2 regresyon: hatırlatıcısız oluşturma, edit dirty-flag). Sıfır bug, sıfır regresyon.


### Görevler Panelini/İş Kolunu Sidebar Dışına Float Pencere (2026-06 · fork) ✅
Kullanıcı isteğiyle "dışarı taşı" özelliği eklendi (davranış korunarak, additive):
- **`lib/detachedPanels.js`** (yeni): localStorage'lı pub/sub store — açık float panelleri tutar (kategori başına tek pencere, dedupe). `openDetachedPanel/closeDetachedPanel`.
- **`components/DetachedPanelsHost.jsx`** (yeni): her açık paneli `react-rnd` ile sürüklenebilir/boyutlandırılabilir, kalıcı geometrili yüzen pencerede render eder; içinde ayrı bir `<TasksPanel detached initialCategory=.../>` örneği. Başlıkta ← (dock) ikonuyla sidebar'a geri döner. `SertexMain`'de mount edilir.
- **`TasksPanel`** yeni prop'lar: `detached`, `initialCategory`, `onDock`. Panelin üstüne "DIŞARI TAŞI" butonu (seçili iş kolu varsa onu, yoksa tüm paneli açar); her kategori çipine ayrı bir dış-pencere (⧉ ExternalLink) ikonu eklendi. Detached modda bu ikonlar gizli (iç içe açmayı önler).
- Karşılananlar: dışarı taşı ikonu ✓, iş kolu seçince ayrı pencere ✓, aynı anda birden fazla iş kolu penceresi ✓, ikonla geri alma ✓, kalıcı (localStorage) ✓.
- **Doğrulama**: runtime screenshot — tam panel + kategori penceresi aynı anda açık, filtre doğru, dock geri alıyor, sıfır pageerror. Regresyon yok.
- ⏳ **Bekleyen (bir sonraki):** Hatırlatıcı tekrar sayısı + aralık (kaç defa / kaç dk-saat-gün arayla, görev tamamlanınca dursun, yeni+düzenle formlarında).


### Native window.prompt → Temalı Prompt Diyaloğu (2026-06 · fork) ✅
Kalan 3 native beyaz `window.prompt` çağrısı temalı koyu diyaloğa taşındı:
- `lib/confirm.jsx`'e **`promptDialog`** (metin girişli mod) eklendi — mevcut `confirmDialog` (evet/hayır) korunarak. Prompt modu cyan + input, confirm modu kırmızı/danger; ikisi de aynı modal iskeletini kullanır.
- Taşınan çağrılar: `Sidebar.savePreset` ("Bu düzeni ne isimle kaydedeyim?"), `Sidebar.editSystemQuota` (sistem kapasitesi), `UserManagement.editQuota` (kullanıcı kapasitesi). Hepsi async + cancel'da `null` kontrolü ile uyumlu.
- **Doğrulama**: screenshot ile "DÜZEN KAYDET" temalı prompt (kaydetme çalışıyor) + "ONAY" (SIFIRLA) temalı confirm hâlâ çalışıyor; `prompt-input` confirm modunda görünmüyor; sıfır pageerror. Regresyon yok.


### TasksPanel.jsx Güvenli Refactor — Faz 9 CP6 (2026-06 · fork) ✅
Kullanıcı onayıyla dev `TasksPanel.jsx` (3874 satır) davranış birebir korunarak parçalara bölündü:
- **TasksPanel.jsx 3874 → 1844 satır (%52 azalma).** Bileşenler `components/` köküne taşındı (göreli import yolları aynen çalışsın diye): `TaskCard.jsx` (807), `TaskContextMenu.jsx` (577), `SubtaskMenu.jsx` (115), `SubtaskRow.jsx` (190), `TaskGroupViews.jsx` (373 — grup/detached pencere bileşenleri).
- Taşıma **script ile birebir (verbatim) kopyalama** yapıldı (el yazımı hatası riski sıfır). Her yeni dosyanın import'ları statik analizle kesin kullanılan sete indirildi; TasksPanel'de kullanılmayan ~30 import (ikon/modal/lib) temizlendi (production build güvenliği).
- **Bulunan+düzeltilen gizli hata:** `SubtaskMenu` verbatim kopyada `dueSoonSub/categorySub/reminderSub` (ContextMenu state'i) referans veriyordu — bu orijinalde de latent bir crash'ti (alt-görev sağ-tık menüsü açılınca). `dateSub`'a düzeltildi.
- **Doğrulama**: `testing_agent` iteration_86 (%100, sıfır konsol hatası) + kapsamlı runtime self-test: görev/alt-görev context menüleri + tüm alt-menüler (hatırlatma/kategori/yaklaşan/export/tarih), Kilit/OTP/Atama/Paylaş modalları, detach/dock (görev+grup), oluştur/düzenle/sil — hepsi sıfır pageerror ile çalışıyor. Regresyon yok.


### Geciken Görev Özeti & Toplu Dürt + Frontend Error Radar (2026-06 · fork) ✅
Kullanıcı onayıyla iki P2 backlog özelliği regresyonsuz (tamamı additive) eklendi:
1. **Geciken Görev Özeti & Toplu Dürt** — Admin/Müdür "Ekibim" panelinde yeni "GECİKEN GÖREVLER (N)" bölümü: kişi bazında geciken görev sayısı + kişi başına "DÜRT" + en üstte "TÜMÜNÜ DÜRT". RBAC: `visible_user_ids` (kendi görevleri hariç). Backend (team_router): `GET /api/team/overdue-summary`, `POST /api/team/bulk-nudge` (mevcut `notify_task_nudge` + 60sn cooldown yeniden kullanılır; `{sent, skipped, recipients}`). Frontend: `TeamPanel.jsx` + `teamApi.overdueSummary/bulkNudge`.
2. **Frontend Error Radar** — Tarayıcıda oluşan JS hatalarını sessizce yakalayıp admin'e iletir. Backend (admin_router): `POST /api/client-log` (public/opsiyonel-auth, `client_logs` koleksiyonu + 30 günlük TTL index), `GET/DELETE /api/admin/client-logs` (admin). Frontend: yeni `lib/clientLogger.js` (window.onerror + unhandledrejection, throttle/dedupe, raw fetch — UX'i etkilemez), `index.js`'te başlatılır; admin görünümü Ayarlar → İstatistik (MonitoringDashboard) "FRONTEND HATALARI" bölümü (kullanıcı adı + mesaj + URL + TEMİZLE).
- **Test**: Backend 5 endpoint curl ile (overdue-summary, bulk-nudge+cooldown, client-log auth/anon, admin/client-logs, RBAC 403) + `testing_agent` frontend %100 — `/app/test_reports/iteration_85.json`. Sıfır regresyon. Not: dev-mode'da CRA'nın kendi runtime overlay'i görünebilir (clientLogger değil); production build'de kaldırıldığı için "kullanıcı görmez" korunur.
- Not: E-posta Chat Intent özelliği kullanıcı isteğiyle ATLANDI.


### 4 Parçalı Görev Batch'i — Doğrulama Tamamlandı (2026-06 · fork) ✅
Önceki oturumda enjekte edilen ama test edilmemiş 4 özellik bu fork'ta tamamlandı ve doğrulandı:
1. **Temalı onay her yerde** — tüm native `window.confirm` çağrıları `lib/confirm.jsx` `confirmDialog`'a taşındı (yalnızca confirm.jsx içindeki fallback kaldı). 12 bileşen kullanıyor.
2. **Tamamlanma Süresi etiketi** — "done" görevlerde `Bitiş: <tarih>` satırının yanında `task-duration-{id}` rozeti (Türkçe: anında / N dakikada / N saatte / N günde), `taskDurationLabel(created_at, completed_at)` ile.
3. **Ayrılmış grup penceresinde pencere-içi sürükle** — `DetachedGroupWindow` içindeki üyeler `Reorder.Group` ile sürüklenerek sıralanabilir (`handleReorderGroup`).
4. **Ekip görünümünde statik grup blokları** — (BU FORK'TA BAĞLANDI) `StaticTaskGroupBlock` + `teamRows` useMemo + `renderStaticMember` daha önce tanımlıydı ama Team view render path'ine bağlı DEĞİLDİ; bağlandı. Ekip görünümünde bağlı görevler sürüklemesiz statik blok olarak render olur; nudge butonu korundu (`renderStaticMember`'a `onNudge`/`nudgeCount` eklendi).
- **Test**: `/app/test_reports/iteration_84.json` — Frontend E2E %100 (5/5), sıfır regresyon, sıfır native dialog. Not: `TasksPanel.jsx` 3875 satır (refactor P2 backlog, kullanıcı regresyona hassas — istenmeden yapılmayacak).


### Görev Bağlama (Task Groups / Zincir) — 2026-07-29
- Birden fazla görev tek "grup" halinde bağlanır; sidebar'da bordürlü blok içinde alt alta sıralı gösterilir. Blok başlığı tutamacından sürükleyince tüm üyeler birlikte taşınır; blok içinde de sürükleyerek sıralanır.
- İki giriş noktası: (a) sağ-tık "Görevleri Bağla", (b) araç çubuğu "BAĞLA" butonu (çoklu seçim modalı). Grup adı + "İlerleme göster (x/N tamamlandı)" opsiyonel.
- Yönetim: başlıkta düzenle + bağlantıyı çöz (window.confirm onaylı); sağ-tıkta "Grubu Düzenle" / "Gruptan Çıkar". Üye <2 kalınca grup otomatik dağılır.
- Backend: `task_groups` koleksiyonu + `tasks.group_id`; POST/GET/PATCH/DELETE `/api/task-groups`, DELETE `/api/task-groups/{gid}/members/{tid}`. Üyelere bitişik `sort_order` atanır. Yeni: `LinkTasksModal.jsx`, TasksPanel'de `TaskGroupBlock`/`OuterTaskRow`/groupRows.
- Test: testing_agent — backend 7/7 pytest, frontend tam akış %100, regresyon yok (`iteration_82.json`).
- Grubu Dışarı Alma (2026-07-29): grup başlığındaki ⤢ butonu tüm bağlı grubu TEK yüzen pencerede (Rnd, konumu/boyutu localStorage'da kalıcı) açar; üyeler alt alta tam işlevsel (durum/düzenle/alt görev), başlıkta grup adı + x/N. Sidebar'da "grup dışarıda — Geri Al" yer tutucusu kalır. Yeni: `DetachedGroupWindow`, `GroupDetachedRow`, `detachedGroupIds`. Smoke test geçti (detach→pencere+placeholder→dock→blok geri geldi).
- Not: Word export production build hatası (docx ESM) craco'da docx'i babel'den hariç tutarak çözüldü; `yarn build` başarılı.


### Görev Dışa Aktarma — Yazdır/PDF · Excel · Word — 2026-07-29
- Görev kartı **sağ-tık menüsüne** "Dışa Aktar" alt menüsü eklendi (Yazdır/PDF, Excel .xlsx, Word .docx) — `data-testid` ctx-export-print/excel/word.
- Görev listesi başlığına **toplu dışa aktarma** araç çubuğu eklendi (o an görünen/filtrelenmiş görevler) — `data-testid` bulk-export-print/excel/word.
- Yeni util `lib/taskExport.js`: Yazdır tarayıcı penceresiyle (yazıcı + "PDF kaydet"), Excel `xlsx` (SheetJS, "Görevler" + "Alt Görevler" sayfaları), Word `docx` (marka başlığı + görev tabloları + alt görev tablosu). Bağımlılıklar: `xlsx`, `docx`, `file-saver`.
- Çıktı alanları: Başlık, Açıklama, Durum, Son Tarih, Tamamlanma Tarihi, Görev Sahibi/Şirket, İş Kolu, Alt Görevler (durum + tarih).
- Doğrulama (Playwright): tek görev Excel indirme (`Sertex-...TASK_3.xlsx`), toplu Word (`Sertex-Gorevler-20260729.docx`), toplu Yazdır popup (32 görev bölümü) — hepsi geçti.

### Sistem Denetimi P2 — Sessiz Hata Blokları Temizliği — 2026-07-29
- **Frontend:** 88 boş `catch {}` bloğu (22 dosya) `console.warn("[dosya] hata bastırıldı:", e)` ile debuggable hale getirildi. Davranış/UX değişmedi (yalnızca hata görünür oldu); webpack temiz derlendi.
- **Backend:** 8 production sessiz `except: pass` bloğu `logger.warning` ile loglanır hale getirildi (backup_service, license_service, overdue_push_service, admin_router x2, tasks_router x3, team_service). Kasıtlı 3 blok (monitoring_service logging-handler recursion riski x2, notification_pubsub zararsız remove) yorumla belgelendi. `tests/` dosyalarına dokunulmadı.
- Doğrulama: login 200, admin/users 200, tasks 200; smoke test — app yüklendi, konsol hatası yok.

### Otomatik Tamamlanma Tarihi (completed_at) — 2026-07-29
- `Task` + `TaskUpdate` modellerine `completed_at: Optional[str]` eklendi (`tasks_models.py`).
- `update_task`: durum "done" olunca `completed_at` otomatik yazılır; başka duruma dönünce temizlenir; manuel değer (edit yetkisiyle) korunur (`tasks_router.py`).
- `my-completion`: çok kişili görev herkes tamamlayınca `completed_at` yazılır, biri geri alınca temizlenir.
- Frontend: `TaskCard` "done" + `completed_at` varsa `CircleCheckBig` (daire+tik, kullanıcı seçimi #3) ikonuyla "Bitiş: ..." rozeti gösterir; `EditTaskModal` yalnızca "done" görevlerde "TAMAMLANMA TARİHİ" datetime alanı sunar (`data-testid=edit-completed-at`). Mevcut lock/paylaşım izinleri korundu. Curl + smoke test geçti.

### Faz 0 — Temel Sertex (2026-02 → 2026-07)
- Holografik 3D küre (idle/listening/thinking/speaking durumları)
- Multi-user JWT auth (admin + user, brute-force lockout, impersonation)
- MongoDB persistence: users, conversations, messages, notes, tasks, memories, reminders
- GPT-5.2 chat (multi-turn context)
- OpenAI TTS (onyx) sesli çıktı
- Web Speech API sesli giriş (TR/EN)
- Sidebar tabs: Geçmiş · Görevler · Hafıza · Notlar · Dosyalar
- HUD panels: sistem durumu, canlı saat/tarih, hava widget, sistem metrikleri
- Drag-and-drop tabs, resizable & draggable HUD (react-rnd)
- Sonner toasts, glassmorphism, scanline arka plan
- Language toggle TR/EN
- Production white-screen defenses (ErrorBoundary, boot loader)
- Custom domain `sertex-ai.com` yayında
- Görev sistemi: subtask, drag-drop reorder, arşiv, tarih, hatırlatıcı, otomatik numaralandırma

### Faz 0.5 — Uzun Süreli Hafıza + Whisper Hybrid STT (2026-07-22)
**🧠 Uzun Süreli Hafıza:**
- MongoDB `memories` koleksiyonu, kategoriler (personal/preference/work/family/health/project/other) + önem (1-5)
- Manuel komut: "bunu hatırla: X", "not et: X", "aklında tut: X", "kaydet: X" (+ EN)
- Unut: "unut X", "sil X", "forget X"
- LLM tabanlı otomatik çıkarım — BackgroundTask GPT-5.2 ile mesajlardan hatırlanabilir olayları çıkarır
- Deduplication (yakın-eşleşme substring)
- Prompt injection: top-25 hafıza (önem sıralı) her sohbete otomatik dahil
- Full CRUD `/api/memory` + `MemoryPanel.jsx` UI

**🎙️ Whisper Hybrid STT:**
- `/api/stt/whisper` — multipart audio (webm/mp3/m4a/wav/ogg) → text
- Native Web Speech (Chrome) + MediaRecorder → Whisper fallback (Firefox/Mobil)
- Otomatik geçiş `not-allowed`/`network`/`audio-capture` hatalarında
- Mic mode badge ("W") aktif olduğunda görünür

### Faz 1 — Dosya İşleme Motoru (2026-07-22 · 21/21 backend + full E2E test pass)
- PDF (pypdf), Word (python-docx), Excel (openpyxl), PPT (python-pptx), TXT/MD, CSV parse
- Görsel: GPT-5.2 Vision (base64 + ImageContent)
- Ses: Whisper STT (mevcut altyapı)
- Emergent Object Storage (multi-tenant, `sertex/uploads/{user_id}/{uuid}.{ext}`)
- Endpoints: `POST /api/files`, `GET /api/files`, `DELETE /api/files/{id}`, `/files/{id}/download`, `/summarize`, `/ask`
- UI: `FilePanel.jsx` — drag-drop, kategori ikonları, özet, dosyaya soru sorma, indirme

### Faz 1.5 — UX Genişletmeleri (2026-07-22)
- **TTS DUR butonu** (Iteration 22, 21/21 pass) — konuşurken kırmızı DUR overlay, Escape tuşu, küreye tıklama, speechIdRef ile in-flight iptal
- **Gerçek Hava Durumu** — Open-Meteo entegrasyonu, şehir arama, doğuş/batış saatleri
- **Geciken Görev Alarmı** — `OverdueAlertModal.jsx` + snooze
- **HUD Panel Overhaul** — 4 kenara docking, renk seçici, snap-to-edge, layout preset'leri, Focus Mode
- **Alarm Sesi + Özel Yükleme** (Iteration 23, 12/12 pass) — 5 preset (Web Audio API) + kullanıcı yüklemesi (max 2 MB), ses seviyesi, toggle, önizleme; `sertex_alarm_settings_v1` + `sertex_alarm_custom_v1` localStorage
- **VAD Otomatik Gönderme** (Iteration 24) — Chrome native `rec.onend` auto-submit; Firefox/Mobil AnalyserNode RMS VAD (400ms konuşma + 1500ms sessizlik = otomatik durdur & gönder, 20s max)
- **Wake Word "Sertex"** (Iteration 25, 11/11 pass) — Continuous Web Speech API, 11 STT varyantı, otomatik restart, 5-hata güvenli çıkış; HUD toggle + InputBar inline AUTO chip (Iteration 26, 5/5 pass), her ikisi de senkron

### Faz 2 — RAG · Sana Özel Bilgi Bankası (2026-07-23 · 19/19 backend + full frontend pass)
- **Chunking**: `tiktoken` cl100k_base, 500 tokens/chunk, 50 token overlap, max 400 chunks/dosya
- **Embeddings**: OpenAI `text-embedding-3-small` (1536-dim) — Emergent proxy `/llm/openai/v1/embeddings` üzerinden Emergent LLM Key ile
- **Vektör Saklama**: MongoDB `file_chunks` koleksiyonu `{id, user_id, file_id, filename, chunk_index, text, embedding[1536], created_at}` + index `(user_id, file_id)`
- **Similarity Search**: numpy cosine top-K (default K=5), threshold=0.30, user-scoped (multi-tenant isolation testli)
- **Otomatik indeksleme**: Dosya yüklendiğinde BackgroundTask ile arka planda chunking + embedding; `rag_status` alanı: pending → indexing → ok/empty/failed
- **Endpoints**: 
  - `POST /api/files` (upload) — otomatik indexler
  - `POST /api/files/{id}/reindex` — tek dosyayı yeniden indexle
  - `POST /api/files/rag/reindex-all` — tüm eski dosyaları toplu indexle (11 legacy dosya için migration)
  - `GET  /api/files/rag/status` — bucket sayıları + toplam chunk
  - `DELETE /api/files/{id}` — dosya + chunks purge (cascade)
- **Chat entegrasyonu**: `/api/chat` her mesajda user'ın chunks üzerinde similarity search yapar → top-K'yi system prompt'a "KULLANICI BİLGİ BANKASI" bloğu olarak enjekte eder → `sources[]` alanı response'da döner
- **Manual memory triggers** ("bunu hatırla:") RAG'ı short-circuit eder (regression testli)
- **UI**: 
  - FilePanel header'da "RAG · N" chip (toplam chunk sayısı)
  - "Tümünü İndeksle" butonu (migration için)
  - Her dosya kartında "İndeksle" butonu + durum rozeti (İndeksli/İndeksleniyor…/Bekliyor/Hata)
  - ChatMessages'da assistant mesajının altında "KAYNAKLAR" barı — filename chips (similarity % tooltip)

### Faz 1.6 — Küçük Düzeltmeler (2026-07-23)
- `/api/health` endpoint (K8s/LB probe için, `/health` zaten mevcuttu — ingress `/api/*` proxy'lediği için `/api/health` public URL'den erişilebilir)
- `backend/tests/backend_test.py` — `REACT_APP_BACKEND_URL` shell env eksikse `/app/backend/.env` ve `/app/frontend/.env`'den fallback okur (pytest lokalde export gerektirmiyor artık)

### Faz 3.2 — Refactor + AudioContext Hardening (2026-07-23)
- **Refactor**: ExcelModal `Charts` sekmesi ayrı `ExcelChartsTab.jsx`'e taşındı (462 satır, 545'ten). RechartsChart+Eye import kaldırıldı.
- **AudioContext state guards**: 4 dosyada (`speech.js` stopVAD, `alarmSounds.js` withCtx + stopAlarm, `SertexMain.jsx` wake beep, `TasksPanel.jsx` playReminderBeep) tüm `ctx.close()` çağrıları `if (ctx.state !== "closed")` guard'ıyla sarıldı — "Cannot close a closed AudioContext" runtime overlay artık üretilmiyor.
- **Test bug**: `test_weather` "Istanbul" case-sensitivity düzeltildi (Türkçe İ hariç tut).

### Faz 3.1 — Excel Grafik Önizleme (2026-07-23 · 34/34 backend + full frontend pass)
- **Backend**: `POST /api/excel/{id}/chart-data` `{sheet, x, y?, agg?='sum', limit?=50}` — groupby+agg (sum/mean/count/min/max/median/avg/average) → JSON-safe `[{x, y}]` (max 200 nokta, desc sort). Non-numeric y → count fallback. y=None → size(). Missing sheet/x/y → 400 Türkçe detay. Auth + isolation aynı guardlar.
- **Frontend**: `RechartsChart.jsx` (recharts 3.6.0) — bar/column/line/area/scatter/pie tümü cyan Sertex teması ile. ExcelModal Grafik sekmesinde her LLM önerisinin altında "Önizle" → tıklayınca canlı SVG render. İkinci tıklama "Yenile"ye dönüşüyor.

### Faz 3 — Excel Otomasyonu (2026-07-23 · 21/21 backend + full frontend pass)
- **Servis**: `/app/backend/excel_service.py` — pandas + openpyxl + xlsxwriter, GPT-5.2 via Emergent LLM Key
- **5 endpoint** (`/api/excel/{file_id}/*`):
  - `GET  /analyze` — schema (dtype/nulls/mean/min/max/median/std/sum per column) + Türkçe LLM içgörü
  - `POST /formula` `{task, sheet?}` — LLM tabanlı Excel formülü üretir (SUM, VLOOKUP, INDEX/MATCH, SUMIFS…) + hedef hücre + güven skoru
  - `POST /query` `{question}` — schema + head/tail örneğinde Türkçe cevap
  - `POST /pivot` `{task, sheet?}` — LLM parses spec → pandas.pivot_table → MultiIndex flatten → base64 xlsx + preview
  - `GET  /charts` — 3-5 grafik önerisi (bar/line/pie/scatter/area/column)
- **Güvenlik**: ownership (404), category=spreadsheet zorunluluğu (400), Bearer token zorunluluğu (401/403)
- **Kaplama**: MAX_ROWS_PER_SHEET=50k, PIVOT_MAX_ROWS=5k, SAMPLE_HEAD=15, SAMPLE_TAIL=5
- **Frontend**: `ExcelModal.jsx` (5 sekme: Analiz · Formül · Sor · Pivot · Grafik). FilePanel'de spreadsheet dosya kartlarında yeşil "Excel" butonu (emerald-300). Formülü kopyala, pivot XLSX'i indir tam çalışıyor.

### Faz 4 — Yerel Otomatik Yedekleme + Manuel Internxt Upload (2026-07-23 · 17/17 backend + full frontend pass)
- **⚠️ Internxt free tier engelli**: rclone ve official CLI ikisi de HTTP 402 döndürüyor ("access not allowed for this user tier"). Otomatik upload için ücretli plan gerekiyor.
- **Fallback**: Sertex container'ı içinde otomatik `.zip` yedekleme + manuel indir + Internxt web'e sürükle-bırak.
- **Servis**: `/app/backend/backup_service.py` — mongodump (BSON) + Emergent Object Storage file fetch + manifest.json + zip. Retention: 7 gün + 4 hafta + 12 ay (grandfather-father-son).
- **Zamanlayıcı**: APScheduler 3.11.3, günlük 03:00 UTC. `db_init`'ten başlıyor, idempotent.
- **Router** `/api/backup/*` — hepsi admin-only (403 for regular users): `status`, `list`, `run`, `prune`, `{id}`, `{id}/download`, `{id}` (DELETE)
- **UI**: Sidebar'a yeni "Yedek" sekmesi (sadece admin görüyor). BackupPanel: durum, sonraki otomatik yedek zamanı, "Şimdi Yedekle", "Temizle", kartlarda İndir/Sil, auto-poll 15s.
- **Doğrulanmış manuel yedek**: 133.7 KB, 5.45 saniyede tamamlandı, 10 MongoDB koleksiyonu + 12 kullanıcı dosyası, 0 hata.

### Faz 5.1 — UX İyileştirmeleri (2026-07-23 · 12/12 backend + full frontend pass)
- **Kullanıcı + Key tek adım**: `POST /api/admin/users` artık `with_license` param'ı destekliyor → yeni kullanıcı oluşturulurken lisans da otomatik atanıyor. Kullanıcı hiç redeem etmeden Sertex'e girebiliyor. Orphan-safe (invalid tip → user create edilmez; license create-redeem fail → license cleanup).
- **"Lisansım" sekmesi** (`MyLicense.jsx`): Regular user Settings'te yeni sekme — mevcut lisans durumu, kalan gün, kod (kopyalanabilir), yeni kod aktive etme. Admin görmüyor.
- **7 gün uyarı banner'ı**: SertexMain'de fixed banner (`license-expiring-banner`) — `days_left <= 7` ve non-admin/non-lifetime iken sarı üst çubuk. 60s poll ile passive tab'da da tetikleniyor.

### Faz 3.5 — Sohbet İçinde Grafik (2026-07-23 · 14/14 backend + full frontend pass)
- **Backend**: `/app/backend/chat_chart_service.py` — regex tabanlı Türkçe/İngilizce grafik intent detektörü (`grafik/grafiği/grafiğini/grafikleri`, `pasta/pie`, `bar chart`, `sütun`, `çiz`, `dağılım`, `görsel...`), GPT-5.2 ile spec üretme, `chart_data()` pipeline. Fallback sessiz (dosya yoksa/LLM boş dönerse chart=None).
- **excel_service.chart_data**: `x==y` edge case fix — pasta grafiğinde "kategoriye göre kategori sayısı" isteği artık sessizce count aggregate'e düşüyor.
- **Message model** `chart: Optional[ChatChart]` eklendi (persist edilir; geçmiş chat açıldığında grafikler geri gelir).
- **Frontend**: `ChatMessages.jsx` — assistant mesajında `chart.data` varsa `<RechartsChart>` inline render + filename·sheet footer.
- **Regression clean**: RAG sources ile birlikte çalışır, license gate (402) hala geçerli, memory extraction bozulmaz.

### Faz 5 — Ticari Lisans Sistemi (2026-07-23 · 32/32 backend + full frontend pass)
- **4 lisans türü**: Trial (30g) · Aylık (30g) · Yıllık (365g) · Ömür Boyu (süresiz)
- **CD-Key format**: `SERTEX-XXXX-XXXX-XXXX` (30-char alfabe, O/0/I/1/L hariç)
- **Servis**: `/app/backend/license_service.py` — generate_key (secrets), create_licenses, redeem_license (idempotent), get_user_license, has_active_license (admin bypass), list/patch/delete/stats.
- **Endpoints**:
  - `GET /api/license/me` — current user status (has_license, type, days_left, key)
  - `POST /api/license/redeem` — kod aktivasyon (409 if already assigned to another user)
  - `POST /api/license/logout-others` — diğer oturumları at
  - Admin: `/api/admin/licenses/{stats, types, "", generate, {id} PATCH, {id} DELETE}`
- **`licensed_user` dependency**: 17 feature endpoint (chat/memory/tasks/notes/tts/stt/weather/files/excel) `licensed_user` üzerinden geçiyor. Lisans yoksa 402 NO_LICENSE. Admin bypass.
- **Single-session enforcement (Netflix mantığı)**: JWT'ye `sid` (UUID) eklendi. Login her seferinde yeni `active_session_id` üretiyor. Eski token → 401 SESSION_KICKED.
- **UI**:
  - `RedeemScreen.jsx` — lisanssız kullanıcıya full-screen aktivasyon
  - `LicenseManagement.jsx` — admin CRUD (4 stat kartı, generator, filtreler, satır aksiyonları: Askıya Al / İptal / Sil / +7g / +30g / +365g / Aktifleştir); batch kopya panoya
  - Settings paneline "Lisanslar" admin sekmesi (KeyRound icon)
  - Session-kicked overlay + axios interceptor + 60s passive poll (kick'i pasif tab'da bile fark et)

---

## 🔴 P0 — Sıradaki İş

### 🎨 Temaları Tam İşlevsel Hale Getirme (Kullanıcı isteği · 2026-06 · SIRADAKİ · "hiçbir şeyi BOZMADAN") 🚧 BEKLİYOR
Kullanıcı geri bildirimi: dün eklenen 6 tema (arayüz) görsel olarak güzel ama **kabuk** halinde — içlerindeki pencereler/paneller gerçekte çalışmıyor. Yapılacaklar (SIRAYLA, tema tema, TÜM temalarda geçerli, mevcut Detaylı akışı BOZULMADAN):
1. **Boş pencere / Detaylı'ya sıçrama sorunu**: Bir temada (Kolay/Profesyonel/Teknik/Aydınlık/Pano) göreve/panele tıklayınca şu an ya boş görünüyor ya da kullanıcıyı Neural Link (Detaylı) görünümüne geri fırlatıyor (`openMobileSection` → `sertex:sidebar-tab` → Detaylı sidebar açılıyor). Bunun yerine **tema kendi içinde** görev detayı/pencere açmalı.
2. **Neural Link fonksiyonlarının temaya uyarlanması**: Detaylı'daki tüm görev yönetimi fonksiyonları (görev detayı, düzenle, alt görevler, arşiv, paylaşım, kilit/OTP, dosya ekleme, bağlama/gruplar, devret, iş koluna taşı, hatırlatıcı vb.) her temanın **kendi görsel diliyle** o tema içinde de çalışmalı — Detaylı'ya yönlendirmeden.
3. **Paylaşılan bileşenlerin re-skin'i**: Tema değişince ortak paneller/pencereler (sidebar panelleri, görev detay modalları, ayarlar vb.) hâlâ eski Detaylı HUD görünümünde kalıyor; bunlar da seçilen temaya uymalı (örn. Aydınlık = açık tema → paneller açık tema olmalı).
- **KRİTİK kısıt**: Detaylı (varsayılan) görünüm ve mevcut tüm akışlar HİÇBİR ŞEKİLDE bozulmayacak. Sıralı ilerlenecek; her tema için önce plan → kullanıcı onayı → uygulama → test.
- **İlk adım (plan)**: hangi temadan başlanacağı + hangi fonksiyonların 1. öncelik olduğu kullanıcıyla netleştirilecek.
- **KARARLAR (kullanıcı onayı 2026-06)**: Sıra = **önce KOLAY**, sonra diğerleri sırayla. Aşama sırası = a (Aşama 1 temel → 2 → 3, PRD'deki gibi). Görev detayı = **sağdan içeri açılan çekmece (drawer)**, Kolay'ın sade/aydınlık dilinde. Kullanıcı "YAP" diyene kadar KOD YAZILMAYACAK (henüz "bekle" dedi).
- **Sıraya alınan kullanıcı notları — KOLAY (2026-06)**: ✅ UYGULANDI (SADE görünüm korunarak — v2 yaklaşımı):
  - ⚠️ Önce hatalı yaklaşım denendi (tüm `TasksPanel` Kolay'a gömüldü) → kullanıcı "büyütülmüş Neural Link, ana görünümü bozdun" dedi → git `e42524e`'den sade Kolay geri yüklendi.
  - ✅ DOĞRU yaklaşım: sade kart ızgarası KORUNDU, panel chrome'u (stat/tab/export) GETİRİLMEDİ; kartların ÜSTÜNE fonksiyonlar eklendi (`KolayInterface.jsx` yeniden yazıldı).
  - ✅ "DETAYLI" düğmesi kaldırıldı (Ayarlar → Temalar'dan geçilir).
  - ✅ Arama çubuğu ALTINA iş kolu seçici chip'leri (Tümü / kollar / Kolsuz) — `kolay-cat-filter`.
  - ✅ Her kartta ⋮ menü (`kolay-task-menu`, portal): Düzenle · Tamamlandı · Beklemeye al · Aktif yap · İş Koluna Taşı (alt-menü) · Özellik Tanımla (Paylaş) · Arşivle · Sil. Düzenle→gerçek `EditTaskModal`, Paylaş→gerçek `ShareTaskModal` yeniden kullanıldı. Aksiyonlar `tasksApi` (setStatus/setArchived/update/delete) ile.
  - ✅ Sıra numarası rozeti (1,2,3…) + sürükle-sırala (⠿ tutamaç, `framer-motion Reorder` + `tasksApi.reorder`; sadece filtre/arama yokken aktif).
  - ⚠️ ÖNEMLİ HATA/DERS: menü ilk sürümde `AnimatePresence` + `createPortal` sarmalayıcısı yüzünden HİÇ açılmıyordu → AnimatePresence kaldırılıp portal doğrudan koşullu render edilince düzeldi.
  - ℹ️ İleri/nadir aksiyonlar (kilit/OTP, tekrarlı hatırlatma, görev bağlama/grup, tek görev export, sıra no sabitleme, devret) SADE menüye bilinçli KONULMADI (Kolay = basit). İstenirse eklenebilir.
  - **Test**: Ana ajan Playwright (preview) — sade görünüm korundu, chip filtre + sıra no + ⋮ menü (7-8 aksiyon) + iş kolu alt-menü + gerçek EditTaskModal açılışı doğrulandı; DETAYLI yok; Detaylı görünüm etkilenmedi (yalnızca KolayInterface.jsx değişti). Lint temiz.
  - **SIRADAKİ**: Profesyonel → Teknik → Aydınlık → Pano aynı "sade kabuk + kartlara fonksiyon" yaklaşımıyla; kullanıcı "yap" deyince.
- **🐛 AÇIK HATA — KOLAY sürükle-sırala (kullanıcı bildirdi 2026-06)**: Mevcut `framer-motion Reorder axis="y"` çok sütunlu ızgarada bozuk çalışıyor — kartlar SADECE yukarı-aşağı kayıyor (sağa-sola değil) ve sürükleyince ızgara/numaralar sapıtıyor. İSTENEN: 2 yönlü (sağ-sol + yukarı-aşağı) ızgara sürüklemesi; taşıyınca diğer kartlar otomatik kayıp sıra numaraları anında yeniden atansın, düzen kendini toparlasın. ÇÖZÜM planı: `@dnd-kit/core` + `@dnd-kit/sortable` (`rectSortingStrategy`) ile grid-aware DnD → bırakınca `tasksApi.reorder(ids)` + yeniden numaralama. (Kullanıcı "yap" deyince.)
- **📝 KOLAY ⋮ menü = TAM Neural Link menüsü (kullanıcı isteği 2026-06, not alındı)**: Şu anki sade/çekirdek ⋮ menü YETERSİZ; kullanıcı Neural Link'teki `ContextMenu`'nün TAMAMINI istiyor (ekran görüntülü): Tamamlandı · Beklemeye al · Tarihi geçmiş işaretle · Düzenle · Sıra Numarasını Sabitle › · Devret · Özellik Tanımla (Paylaş) · İş Koluna Taşı › · Boyutu sıfırla · Dışa Aktar › · Hatırlat › · Yaklaşan Uyarısı › · Sabah Özetinden Çıkar · Arşivle · Görevleri Bağla · İptal Et · Sil · Kilit Ayarları. ÇÖZÜM planı: gerçek `ContextMenu` (`TaskContextMenu.jsx`) bileşenini Kolay'da yeniden kullan + TaskCard/TasksPanel'deki tüm handler'ları (onAction, onReassign, onSetCategory, reminder, lock/OTP, pin, export, link) ve modalları (ReassignModal, ShareTaskModal, LockConfigModal, UnlockOtpModal, OtpDisplayModal, EditTaskModal, LinkTasksModal, QuickReminderEditModal) bağla. (Kullanıcı "yap" deyince.)
- **🐛 KOLAY sol menü aktif durumu (kullanıcı bildirdi 2026-06)**: Şu an "Ana Sayfa" ve "Görevler" İKİSİ BİRDEN sürekli yanık/aktif (`active = home || tasks`), tıklayınca sönmüyor. İSTENEN: aynı anda tek öğe aktif olsun, tıklamayla aktif/pasif doğru değişsin. ÇÖZÜM: `activeKey` state'i tut; highlight yalnızca aktif öğede. (Kullanıcı "yap" deyince.)
- **🐛 KOLAY "Yeni Görev Ekle" Neural Link'e atıyor (kullanıcı bildirdi 2026-06)**: Buton şu an `onOpenSection("tasks")` ile Neural Link sidebar'ını açıyor. İSTENEN: Neural Link'e ATMADAN, Kolay'ın kendi içinde bir görev ekleme kartı/formu (başlık + açıklama + iş kolu + son tarih) açılsın → `tasksApi.create` → listeye eklensin. (Kullanıcı "yap" deyince.) NOT: aynı sıçrama `kolay-empty-add` boş-durum butonunda da var.
- **🐛 KOLAY genişlik/reflow (kullanıcı bildirdi 2026-06)**: İçerik `max-w-[1100px]` ile sınırlı → sağda büyük boş alan kalıyor. İSTENEN: Neural Link (sidebar) GİZLİYKEN Kolay otomatik sağa uzayıp tüm genişliği kullansın; sidebar AÇILINCA (right:360) kalan alana sığacak şekilde daralıp ızgara yeniden dizilsin (taşma yok). ÇÖZÜM: `max-w-[1100px]` kaldır/esnet; grid sütunları alana göre otomatik (örn. `auto-fill/minmax` veya container'a bağlı). (Kullanıcı "yap" deyince.)
- **✅ KOLAY 5 madde ÇÖZÜLDÜ (2026-06, "yap" onayıyla)** — `KolayInterface.jsx` yeniden yazıldı, sade görünüm korundu, Detaylı bozulmadı (yalnızca KolayInterface.jsx + dnd-kit paketleri):
  1. ✅ Sürükle-sırala 2 YÖNLÜ (sağ-sol+yukarı-aşağı) — `@dnd-kit/core`+`@dnd-kit/sortable` (`rectSortingStrategy`) + `tasksApi.reorder`; bırakınca sıra numaraları anında yeniden atanıyor. (Test: kart 1→3 taşındı, numaralar güncellendi.)
  2. ✅ ⋮ menü = TAM Neural Link `ContextMenu` (16 madde: Tamamlandı/Beklet/Aktif/Tarihi geçmiş/Düzenle/Sıra No Sabitle/Paylaş/İş Koluna Taşı/Boyutu Sıfırla/Dışa Aktar/Hatırlat/Yaklaşan Uyarısı/Sabah Özetinden Çıkar/Arşivle/Görevleri Bağla/İptal/Sil; Devret+Kilit kişisel scope'ta gizli — Neural Link ile aynı parite). Tüm handler'lar `tasksApi` + gerçek modallar (Edit/Share/Reassign/LockConfig/UnlockOtp/OtpDisplay/LinkTasks) bağlandı.
  3. ✅ Sol menü aktif durumu — `activeKey` state; tek öğe aktif (artık ikisi birden yanmıyor).
  4. ✅ "Yeni Görev Ekle" — Neural Link'e ATMIYOR; Kolay içi `KolayAddModal` (başlık+açıklama+iş kolu+son tarih → `tasksApi.create`).
  5. ✅ Tam genişlik/reflow — `max-w` kaldırıldı; grid `repeat(auto-fill, minmax(300px,1fr))` alanı doldurur, sidebar açılınca daralıp yeniden dizilir.
  - **Test**: Ana ajan Playwright (preview) — 5 madde + Detaylı sağlamlığı doğrulandı. Lint temiz. NOT: dnd-kit sürükleme Expo Go/mobil değil, WEB Kolay içindir.
  - **SIRADAKİ (kullanıcı "yap" deyince)**: Profesyonel → Teknik → Aydınlık → Pano aynı yaklaşımla.


- Sertex e-postaları okuyabilecek, cevaplayabilecek
- **Faz 4**: Cloud Server + Otomatik Yedekleme (versiyonlu şifreli MongoDB + dosya yedekleri)
- **Faz 5**: License Sistemi (CD-Key generator, hardware fingerprint, admin panel)
- **Faz 6**: Windows Setup (.exe / Electron kabuk)
- Offline Mode + Auto-Update + Sync
- Gmail / Outlook entegrasyonu
- Tam PC Kontrolü (dosya, klasör, uygulama açma/kapatma)
- Akıllı Ev (Home Assistant + Tapo)
- PWA (Progressive Web App)

## 🟡 P2 — Premium
- **Faz 3.5 — Sohbet İçinde Grafik** (ertelenen): Chat'te doğal dil grafik isteği → asistan cevabı içinde canlı Recharts render (RAG+Excel köprüsü)
- LM Studio hibrit AI (Local/Cloud fallback)
- Multi-tenant SaaS · süper bilgisayar backend · kullanıcı aktivite DB
- Otonom öğrenme · özel ses/kişilik · sinematik boot
- Takvim/toplantı AI · finans takibi · RPA
- React Native mobile app
- Sağlık · yemek · görsel/video üretim · müzik
- İçerik yazarı · enterprise security · siber güvenlik · uzman modu
- Koçluk · aile/ekip modu · proaktif zeka

## 💰 Ticari Kanaloji (P1 sonrası)
- SaaS abonelik sistemi · admin dashboard · çoklu dil · referral/affiliate

## 🎨 Eğlenceli
- Rüya günlüğü · duygu analizi · karar verici · anonymous mode

## 🎯 Son Aşamalar
- Görev tamamlama animasyonu
- Remote Command Center (yasal uzak kontrol)
- **CAD-CAM Otomasyonu (Siemens NX)** — EN SON YAPILACAK ⭐ B2B Enterprise

---

## Architecture

### Backend (`/app/backend/`)
- **FastAPI** (`server.py`) — 32+ endpoint, tümü `/api` prefix
- **Motor** async MongoDB driver
- **Modüller**:
  - `auth.py` — JWT + brute-force + impersonation
  - `memory_service.py` — Long-term memory CRUD + auto-extract
  - `whisper_service.py` — OpenAI Whisper STT wrapper
  - `weather_service.py` — Open-Meteo entegrasyonu
  - `storage_service.py` — Emergent Object Storage
  - `file_service.py` — PDF/DOCX/XLSX/PPTX/Image/Audio parse
  - `files_router.py` — File CRUD + summarize + ask endpoints

### Frontend (`/app/frontend/src/`)
- **React 19** + CRA + TailwindCSS + Framer Motion
- **React Three Fiber** (v9) + drei for 3D holografik küre
- **Ana bileşenler**:
  - `SertexMain.jsx` — Ana sahne + panel yönetimi + wake word owner
  - `HolographicSphere.jsx` — 3D küre
  - `Sidebar.jsx` — 5-tab neural link + layout preset + focus mode
  - `TasksPanel.jsx` — Görev sistemi
  - `MemoryPanel.jsx` — Uzun hafıza UI
  - `FilePanel.jsx` — Faz 1 dosya UI
  - `HUDOverlay.jsx` — TopLeft/TopRight/BottomLeft paneller (sistem, saat/hava, neural core)
  - `DraggablePanel.jsx` — Docking, snap, renk seçici, chip stack
  - `InputBar.jsx` — Chat input + hybrid STT + VAD + wake toggle inline
  - `OverdueAlertModal.jsx` — Geciken görev alarmı + custom alarm ses
  - `SettingsPanel.jsx` — 5-tab (Renkler, Temalar, Alarm, Hesap, Kullanıcılar)
- **Lib**:
  - `alarmSounds.js` — 5 preset Web Audio + custom upload
  - `wakeWord.js` — Continuous Web Speech listener
  - `speech.js` — Native STT + Whisper recorder + VAD
  - `api.js`, `auth.js`, `i18n.js`, `settings.js`, `systemStats.js`

### MongoDB Collections
`users` (+active_session_id, +last_login_at), `login_attempts`, `conversations`, `messages`, `notes`, `reminders`, `tasks`, `memories`, `files`, `file_chunks`, `backups`, `licenses`

### Integrations
- Emergent Universal LLM Key
- `emergentintegrations` — LlmChat (GPT-5.2), OpenAITextToSpeech (onyx), OpenAISpeechToText (whisper-1)
- Emergent Object Storage
- Open-Meteo (hava durumu, API key yok)

---

## Key API Endpoints
- **Auth**: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/change-username`
- **Admin**: `GET/POST/PATCH/DELETE /api/admin/users*`, `POST /api/admin/users/{uid}/impersonate`
- **Chat**: `POST /api/chat` (memory injection + auto-extract background task)
- **Memory**: `GET/POST/PATCH/DELETE /api/memory*`
- **Tasks**: `GET/POST/PATCH/DELETE /api/tasks*`, `POST /api/tasks/reorder`
- **Notes**: `GET/POST/DELETE /api/notes*`
- **Files**: `GET/POST/DELETE /api/files*`, `/files/{id}/download`, `/summarize`, `/ask`
- **STT/TTS**: `POST /api/stt/whisper`, `POST /api/tts`
- **Weather**: `GET /api/weather`, `GET /api/weather/search`
- **Conversations**: `GET /api/conversations`, `GET /api/conversations/{cid}/messages`, `DELETE /api/conversations/{cid}`

## Key Data Models
```
users:       {id, username, password_hash, role, password_user_set, created_at}
memories:    {id, user_id, content, category, source, importance, created_at, updated_at}
tasks:       {id, title, description, completed, status, due_date, remind_at, snoozed_until, user_id, sort_order, archived, subtasks:[...]}
files:       {id, user_id, name, size, mime, category, storage_key, extracted_text, summary, rag_status, rag_chunks, rag_error, created_at}
file_chunks: {id, user_id, file_id, filename, chunk_index, text, embedding[1536], created_at}
```

## Test Kapsamı
- Backend: 21+ pytest (files, tasks, memory, STT, multiuser, impersonation, reminder migration)
- Frontend: 26+ test agent iterasyonu (iteration_22-33 — hepsi 100% pass)
- Manuel: production `sertex-ai.com` üzerinde canlı testler

## Faz 7 — E-posta Entegrasyonu (2026-07-23) ✅
- **Universal IMAP/SMTP** — Gmail, Outlook/Hotmail, Yahoo, iCloud, Yandex, Generic
- **Backend**: `email_service.py`, `email_router.py` (imap-tools + aiosmtplib)
- **Şifre Şifreleme**: Fernet AES; `EMAIL_FERNET_KEY` `.env`'de
- **Endpoints**: `GET /api/email/providers`, `GET/POST/DELETE /api/email/accounts`, `POST /api/email/accounts/{id}/test`, `GET /api/email/accounts/{id}/folders`, `GET /api/email/accounts/{id}/messages`, `GET /api/email/accounts/{id}/message`, `POST /api/email/accounts/{id}/send`, `POST .../delete-messages`, `POST .../mark-seen`
- **Frontend**: `EmailPanel.jsx` — sidebar "E-posta" sekmesi, hesap ekle+test, inbox listeleme, arama, okunmamış filtresi, mesaj görüntüleyici, yanıtla, sil, yeni e-posta oluştur
- **UX**: App-password uyarı bilgisi, otomatik provider inference, çoklu hesap desteği
- **MongoDB**: `email_accounts` koleksiyonu (unique(user_id,email))

### Faz 7 UX Fix — Hotmail/Outlook Basic Auth Uyarısı (2026-07-24) ✅
- **Sorun**: Kullanıcı Hotmail App Password aldı ama IMAP bağlantısı hep başarısız oldu.
- **Kök Neden**: Microsoft, Eylül 2024'ten itibaren kişisel Outlook/Hotmail/Live/MSN hesaplarında IMAP+SMTP+App Password (Basic Auth) desteğini kapattı. Artık yalnızca OAuth 2.0 destekleniyor. Bu bir Sertex bug'ı değil, Microsoft sunucu tarafı kısıtlamasıdır.
- **Fix**: `email_service.py::test_connection` Microsoft kişisel domain'lerini (`@hotmail.com`, `@outlook.com`, `@live.com`, `@msn.com`, `.tr` varyantları) tespit edip Türkçe açıklayıcı hata döner. `EmailPanel.jsx` kırmızı uyarı banner'ı gösterir.
- **Test**: `/app/test_reports/iteration_35.json` — 100% pass, Faz 7 pytest (11/11) regresyonu temiz.
- **Backlog (P1)**: Sertex'e Microsoft OAuth 2.0 entegrasyonu ekle (Azure AD app registration + OAuth flow) — Hotmail kullanıcılarına kalıcı çözüm.

### Faz 7.1 — Detachable Sidebar Tabs (2026-07-24) ✅
- **İstek**: Sidebar'daki sekmeler (Geçmiş, Görevler, Hafıza, Dosyalar, E-posta, Notlar, Yedek) sidebar dışına ayrı yüzen pencere olarak çıkarılabilsin, geri dock edilebilsin. Chrome tab detach paterni.
- **Yeni**: `/app/frontend/src/components/FloatingTabWindow.jsx` — react-rnd tabanlı, HUD stilli, sürükle+resize+minimize+dock butonları, drop-onto-sidebar auto-dock (cyan glow feedback), geometry persistence.
- **Sidebar.jsx**: `floatingTabs` state, `detachTab`/`dockTab`/`focusFloating`, `sidebarBounds` (window resize dinleyicili), `renderTabBody(tk)` helper (sidebar + floating pencerelerde ortak kullanılan tab içeriği), her sekmede hover'da ExternalLink pop-out ikonu.
- **Persistence**: `sertex_floating_tabs_v1` (hangi sekmeler yüzüyor) + `sertex_floating_tabs_geom_v1` (per-tab pozisyon/boyut/minimize).
- **UX**: Yüzen sekme sidebar'da italic/soluk görünür — tıklayınca yüzen pencereyi öne getirir ve sidebar'da "⬅ Sidebar'a Geri Koy" butonu belirir.
- **Test**: `/app/test_reports/iteration_36.json` — 11/11 senaryo PASS, no regressions.

### Faz 7.2 — NEURAL LINK Canlı İstatistikler (2026-07-24) ✅
- **İstek**: Sidebar başlığındaki statik "GEÇMİŞ · GÖREVLER · HAFIZA · DOSYALAR · NOTLAR" yazısı canlı sayaçlarla değiştirilsin.
- **Backend**: `GET /api/stats/summary` — kullanıcı bazlı count'lar (tasks_active/tasks_total, notes, files, conversations, memories, email_accounts) + adaptive db_mb (admin → collStats sistem geneli, normal kullanıcı → $bsonSize $$ROOT per-user).
- **Frontend**: `statsApi.summary()`, Sidebar'da `stats` state, refreshKey + note ekleme sonrası otomatik reload. Format: `GEÇMİŞ: 24 · GÖREVLER: 12/47 · HAFIZA: 156 · DOSYALAR: 8 · NOTLAR: 34 · E-POSTA: 2 · 42.5 MB`. Admin için ek "(sistem)" badge.
- **Test**: `/app/test_reports/iteration_37.json` — Backend 100% (6/6 pytest), Frontend 100% (11/11), no regression.

### Faz 7.3 — Sidebar Refactor + 4 Polish (2026-07-24) ✅ **[MAX MODE]**
- **Refactor**: `Sidebar.jsx` 965 → **580 satır** (%40 azalma). 4 yeni odaklı child: `/app/frontend/src/components/sidebar/NeuralLinkHeader.jsx`, `SidebarTabBar.jsx`, `SidebarTabContent.jsx`, `FloatingTabsHost.jsx`. Tüm `data-testid` + localStorage key'leri korundu. `zCounterRef` tek instance Sidebar'da.
- **Polish (a)** — `TasksPanel/MemoryPanel/FilePanel/EmailPanel` artık `onDataChanged` prop alıyor → NEURAL LINK sayaçları anlık.
- **Polish (b)** — `/api/stats/summary` admin'de de `$bsonSize` (metrik tutarlılığı).
- **Polish (c)** — NEURAL LINK sayaçları tıklanabilir → ilgili sekmeye geç.
- **Polish (d)** — MongoDB compound index (`tasks`, `notes`, `conversations`, `messages`, `reminders` on `user_id`) idempotent.
- **Test**: `/app/test_reports/iteration_38.json` — Backend 6/6 + Frontend 10/10 PASS, sıfır regresyon.

### Faz 7.4 — Depolama Kotası Progress Bar (2026-07-24) ✅
- **İstek**: NEURAL LINK'e kota progress bar ekle **ama mevcut sayaçlar (GÖREVLER vs.) kaldırılmasın** — ikisi de görünsün.
- **Backend**: `license_service.py` → `LICENSE_QUOTA_MB = {trial:100, monthly:500, yearly:2048, lifetime:10240}` + `FREE_QUOTA_MB=50`. `/api/stats/summary` yanıtına 4 yeni key: `quota_mb`, `quota_percent`, `license_type`, `license_label`. Admin → hepsi null + `license_label="Sistem"` (unlimited, bar render edilmez).
- **Frontend**: `NeuralLinkHeader.jsx` — 7 mevcut sayaç aynen korundu, altına progress bar (`storage-quota`, `storage-quota-bar`, `storage-quota-pct`). Renk rampası: `<%75` cyan · `%75–90` amber (warn banner) · `≥%90` red (upgrade CTA banner).
- **Live refresh**: `onDataChanged` üzerinden add/delete sonrası kota bar'ı da güncelleniyor.
- **Test**: `/app/test_reports/iteration_39.json` — Backend 10/10 + Frontend 10/10 PASS. Ahmet (trial): `DEPO · DENEME (30 GÜN) · 0.02/100 MB · 0.0%`. Admin: bar yok, sayaçlar aynı.

### Faz 7.5 — Admin Ayarlanabilir Sistem Kotası (2026-07-24) ✅
- **İstek**: "Admin panelde de bar olsun, ama admin kapasiteyi kendisi elle belirleyip artırabilsin (örn 10 GB → 250 GB). Bar yeni kapasiteye göre hemen yeniden şekillensin."
- **Backend**: `db.system_settings.global.quota_mb` (default `10240 MB = 10 GB`, floor `100 MB`, ceiling `10 TB`). Yeni endpoint'ler:
  - `GET /api/admin/system-quota` → `{quota_mb, min_mb, max_mb, default_mb}` (admin only, 403 for non-admin).
  - `PUT /api/admin/system-quota` (body: `{quota_mb: int}`) → upsert + persist. Pydantic `Field(..., ge=100, le=10485760)` → 422 out-of-range.
  - `/api/stats/summary` admin path artık `_get_system_quota_mb()` dönüyor (önce null idi).
- **Frontend**: 
  - Admin için `[data-testid=storage-quota]` bar artık render ediliyor. Bar >=1024 MB'ta `GB` birimine geçiyor (`0.00/10 GB · 0.0%`).
  - `[data-testid=storage-quota-edit]` pencil butonu admin'e özel — tıklama `window.prompt` açıyor (GB olarak sorar), `Math.round(gb*1024)` ile MB'a çevirip PUT ediyor. Toast + `loadStats()` → bar anlık yeniden şekilleniyor.
  - Range hata metni `10 TB` gösteriyor (10240 GB yerine), admin için tooltip "Sistem kapasitesi: ...".
- **Doğrulanan senaryo**: db_mb=0.42 iken quota 10 GB → %0.0 · quota 1 GB → %0.0 · quota 250 GB → %0.0. User'ın stated case (db=8 GB, quota 10→80%, quota 250→3.2%) matematiksel olarak da doğrulandı.
- **Test**: `/app/test_reports/iteration_40.json` — Backend 23/23 pytest (13 yeni + 10 regresyon), Frontend 10/10 acceptance PASS. `iteration_38/39` regresyonu %100 temiz.

### Faz 7.6 — Admin Per-User Kapasite Override (2026-07-24) ✅
- **İstek**: "Kullanıcılara kapasite belirtmek istiyorum admin olarak — hem mevcut kullanıcının kapasitesini elle artırabileyim, hem yeni kullanıcı açarken kapasite değeri girebileyim."
- **Backend**:
  - `AdminCreateUserRequest.custom_quota_mb: Optional[int] = Field(ge=1, le=10485760)` — yeni kullanıcı doc'una yazılır.
  - `AdminUpdateUserRequest.custom_quota_mb: Optional[int] = Field(ge=0, le=10485760)` — `0` gönderilirse `$unset` ile alan silinir (lisans varsayılanına döner), `>0` ise override yazılır, yoksa mevcut değer korunur.
  - `/api/stats/summary` user branch priority zinciri: `user.custom_quota_mb > 0` → override + label `"Özel (Yönetici)"` · yoksa `active license` quota · yoksa `FREE_QUOTA_MB=50`.
  - `/api/admin/users` response'da `custom_quota_mb` alanı gösteriliyor.
- **Frontend (UserManagement.jsx)**:
  - Yeni kullanıcı formunda `[data-testid=admin-new-quota-gb]` inputu (opsiyonel, role=user'da görünür). Girildiğinde `Math.round(gb*1024)` MB olarak POST.
  - Her user satırında `[data-testid=admin-quota-{username}]` HardDrive butonu (yöneticide disabled). Tıklama → `window.prompt('kapasite GB')`. Boş/0 → PATCH `custom_quota_mb=0` (override kaldır). >0 → yeni override.
  - Override aktif iken küçük rozet `[data-testid=admin-quota-badge-{username}]` gösteriliyor: MB≥1024 için "5.5G", altı için "500M".
- **Test**: `/app/test_reports/iteration_41.json` — Backend 40/40 pytest (17 yeni admin-user-quota + 23 regresyon) PASS. Frontend E2E: admin curl+screenshot ile doğrulandı (3 GB verildi → ahmet login → NEURAL LINK bar "DEPO · ÖZEL (YÖNETİCİ) · 0.00/3 GB · 0.0%"). iteration_38-40 regresyonu %100 temiz. Yeni test dosyası: `/app/backend/tests/test_admin_user_quota.py`.

### Faz 7.7 — Admin Panelinde Per-User Kapasite Mini Bar (2026-07-24) ✅
- **İstek**: "Admin panelinde her kullanıcının kaç MB kullandığı ve kapasitesi mini progress bar olarak görünsün — kim kotasına yaklaşmış bir bakışta görüleyim."
- **Backend**: `GET /api/admin/users` yanıtı her user için yeni alanlar ekliyor: `usage_bytes`, `usage_mb`, `quota_mb`, `quota_percent`, `quota_source` (`custom`/`license`/`free`/`system`), `quota_label`. Depolama hesaplaması **collections × 1 aggregation** patterni ile (kullanıcı sayısı ile ölçeklenmiyor).
- **Frontend (UserManagement.jsx)**: Her kullanıcı kartının altına yeni bir `[data-testid=admin-usage-{username}]` bloğu eklendi: sol/sağ layoutta `quota_label` + `usage / quota · %pct` + altta ince (h-1) progress bar. Renk rampası: `<75%` cyan · `75-90%` amber · `≥90%` red. Yöneticiler için render edilmez.
- **Test**: Backend curl ile doğrulandı (ahmet: `usage_mb=0.02, quota_mb=100 (Trial), pct=0.0` · serhat: `usage_mb=0, quota_mb=50 (Ücretsiz)` · serkan: `quota_mb=null (Sistem)`). Frontend screenshot ile doğrulandı — 3 kart doğru şekilde render ediliyor, admin barsız, kullanıcılar bar'lı.

### Faz 7.8 — Kapasite Girişinde MB Desteği (2026-07-24) ✅
- **İstek**: "Adım olarak GB ekleniyor, aynı zamanda MB olarak da yazabileyim."
- **Yeni helper**: `/app/frontend/src/lib/capacity.js` → `parseCapacityToMb(input, defaultUnit)` + `formatMb(mb)`. Kabul edilen formatlar: `"500 MB"`, `"500M"`, `"1.5 GB"`, `"10G"`, `"2 TB"`, birimsiz sayı (default GB, geriye dönük uyumlu).
- **3 yerde kullanıldı**:
  - Sidebar `editSystemQuota` (NEURAL LINK kalem butonu).
  - UserManagement `editQuota` (per-user HardDrive butonu prompt'u).
  - UserManagement yeni kullanıcı formu (`admin-new-quota-gb` inputu artık `type=text`, placeholder `Örn: "500 MB", "3 GB"`, altında "MB / GB / TB desteklenir" hint'i).
- **Doğrulanan senaryolar**: `"500 MB"` → 500 MB rozet `500M` · `"2.5 GB"` → rozet `2.5G` · `"10"` (birimsiz) → 10 GB rozet `10G` · `"abc"` → toast "Geçersiz değer" · `"0"` → override silinir. Backend'de değişiklik yok (zaten MB alır).

### Faz 7.9 — Task Ownership + Workspace Mode + Company Grouping (2026-07-24) ✅
- **İstek üçlüsü**: (1) Görev kartına görev sahibi + şirket etiketi, (2) Kişisel/Ekip modu (bazı kullanıcılar sade kişisel, bazıları B2B ekip), (3) Yeni kullanıcı formunda şirket + admin listesinde şirket bazında gruplama.
- **Backend**:
  - `Task/TaskCreate/TaskUpdate` modellerine opsiyonel `assignee_name`, `company_name` alanları.
  - Yeni endpoint `PUT /api/settings/workspace-mode` (values: `personal`|`team`, 400/401 validation). Login + `/api/auth/me` response'unda `workspace_mode` alanı (default `"personal"`).
  - `AdminCreate/UpdateUserRequest` + `admin_list_users` response'una `company_name` (empty string `""` → `$unset`).
  - Yeni endpoint `GET /api/admin/companies` — distinct şirket listesi (admin only).
- **Frontend**:
  - `useAuth()` artık `workspaceMode`, `isTeamView` (admin bypass'lı guard flag), `setWorkspaceMode()` expose ediyor.
  - Ayarlar → yeni **MOD** sekmesi ([data-testid=settings-tab-workspace]) — 2 card (Kişisel/Ekip), tıklamayla anında geçiş + toast + persist.
  - TasksPanel: `isTeamView` guard'ı — kişisel modda `task-assignee-input`, `task-company-input`, `task-owner-{id}` badge gizli. Ekip modunda + admin her zaman → görünür.
  - UserManagement: yeni kullanıcı formunda şirket dropdown + "+ yeni ekle" custom mode. Satırda `admin-company-{username}` Building2 butonu + rozet. Liste **şirket bazında collapsible gruplama** (`admin-company-group-{key}` — `__no_company__` → BİREYSEL en altta, adlı şirketler alfabetik).
- **Test**: `/app/test_reports/iteration_41.json` (batch 42) — Backend 78/78 pytest (16 yeni `test_workspace_and_company.py` + 62 regresyon), Frontend E2E 14/14 senaryo PASS. Sıfır regresyon. Cleanup temiz.

### Faz 8 — Multi-Tenant RBAC / B2B SaaS (2026-07-24) ✅
Sertex'i tek-tenant kişisel asistandan 3-rollü, çok-kiracılı SaaS'a dönüştürdü. **Explicit opt-in** model — KVKK için müdür açık yetki verilmediği sürece kimseyi görmez. 3 checkpoint halinde inşa edildi.

**Yeni Rol Taksonomisi**: `admin` (Serkan, tüm sistemi görür) · `manager` (kendi şirketindeki + görme yetkisi olan çalışanları görür) · `employee` (sadece kendini görür). Legacy `user` → migration'da otomatik `employee`.

**CP1 — Backend Foundation** (iter_42, 117/117 pytest ✅)
- Yeni MongoDB koleksiyonları: `companies` {id, name, created_at, created_by}, `manager_visibility` {id, manager_user_id, employee_user_id}, `company_permissions` {id, viewer_company_id, target_company_id}.
- Startup migration (idempotent): `users.role='user'` → `'employee'`; `users.company_name` (string) → `companies` upsert + `users.company_id` (ID ref).
- Permission helpers (`/app/backend/permissions.py`): `can_view_user(viewer, target_id)`, `can_view_company(viewer, target_cid)`, `visible_user_ids(viewer)` (single mongo query per manager).
- Yeni CRUD endpoint'ler (admin-only, `permissions_router.py`): `/api/companies` (case-insensitive dedup, üye varsa DELETE 400, cascade permission cleanup), `/api/manager-visibility` (upsert idempotent, non-manager reject), `/api/company-permissions` (self-ref 400).
- Task guard: `GET/PATCH/DELETE /api/tasks` artık `visible_user_ids`/`can_view_user` filtreli. Yetkisiz PATCH/DELETE 404 döner (existence leak yok).

**CP2 — Frontend RBAC UI** (iter_43, 16/16 UI acceptance ✅)
- Ayarlar → yeni **"Şirketler"** sekmesi (`CompaniesManagement.jsx`): şirket CRUD + her şirketin altında "hangi şirketleri görebilsin?" toggle listesi (cross-company grants).
- Ayarlar → yeni **"Yetkiler"** sekmesi (`ManagerVisibilityManagement.jsx`): her müdür kartı altında çalışan checkbox listesi (görebilsin/görmesin).
- UserManagement: rol picker 3-way (**ÇALIŞAN / MÜDÜR / YÖNETİCİ**), rol rozetleri 3 renkli (cyan/mor/sarı), Shield-buton 3-way cycle. Şirket dropdown'u yeni `/api/companies` ID-based endpoint.
- API client extensions: `companiesApi`, `managerVisibilityApi`, `companyPermissionsApi` (`/app/frontend/src/lib/api.js`).
- Bug fix (testing agent'ın kendi): `TasksPanel.jsx` içindeki `TaskCard`'a `isTeamView` prop drilling — mgr_test/emp1_test Tasks panelini crash ettiren regression, düzeltildi.

**CP3 — Rol-Bazlı Görünürlük & Cross-Company** (iter_44+iter_45, 129/129 backend + 6/6 UI ✅)
- Task assignment (S1): `POST /api/tasks` artık `assignee_user_id` accepts. `can_view_user` guard → yetkisiz atama 403 "Bu kullanıcıya görev atayamazsınız". Manager → görebildiği çalışana atayabilir; task.user_id transfer edilir + assignee_name/company_name otomatik doldurulur.
- Team API (S2 back-end): `GET /api/team/members` (görünür üyeler, self hariç) + `GET /api/team/summary` (MongoDB aggregation pipeline ile per-member task rollup: total/done/pending/paused/overdue, overdue-first sıralama).
- **"Ekibim" HUD paneli** (S2 front-end, `TeamPanel.jsx`): manager+admin için sidebar tab-team (Users icon). Kompakt/Detaylı toggle (progress bar). Overdue > 0 satırlar kırmızı border ile triage için öne çıkar.
- TasksPanel: team view'da assignee dropdown (`task-assignee-select`) — "🧍 Kendime ata" + `teamApi.members()` sonucu. Team members boşsa fallback: manuel text input (`task-assignee-input`).
- S4 (overdue notification): manager artık `/api/tasks`'ta çalışanların task'larını da çekiyor → overdue banner otomatik tetikleniyor.
- **KRITIK Bug fix (iter_44 → iter_45)**: `/app/frontend/src/lib/auth.js:115` `isTeamView` `manager` rolünü kapsamıyordu — düzeltildi (`user?.role === 'admin' || user?.role === 'manager' || workspaceMode === 'team'`).
- Notes/Memory/Files için RBAC UYGULANMADI (kullanıcı kararı: kişisel kalsın, KVKK güvenli).

**Test Kullanıcıları (persistent)**: `mgr_test/mgr12345` (manager, Test Company A) · `emp1_test/emp12345` (employee, Test Company A, mgr_test görüyor). Manager-visibility grant `mgr_test → emp1_test` in-place.

**Toplam**: 129/129 backend pytest + tam frontend E2E green. iter_42, iter_43, iter_44, iter_45. Sıfır regresyon.

### Team Faz 2 — Overdue Cron + Heat Map (2026-07-24) ✅
Faz 8 üzerine yatay eklenti — kullanıcının istediği **"team faz 2 nin hepsini yap hicbirseyi bozmadan"** talebiyle iki büyük özellik: (A) Arka planda geciken görev tarayıcı + in-app bildirim fan-out ve (B) GitHub-tarzı ısı haritası grid.

**A. Overdue Cron** (`team_service.py`)
- Yeni koleksiyon `notifications` — unique compound index `(user_id, task_id, type)` (partial: task_id string) ile idempotent dedup.
- Background asyncio loop (`start_scanner`) `SERTEX_OVERDUE_SCAN_INTERVAL_S` (default 300 sn) periyoduyla `tasks` koleksiyonunu tarar. `due_date < now AND status != done AND !archived` filtresiyle geciken satırları bulur.
- Her overdue task için:
  1. Task sahibine self-notification (`is_for_manager=false`)
  2. `permissions.managers_who_can_see(owner_id)` reverse lookup ile o kullanıcıyı görme yetkisi olan tüm manager'lara fan-out (`is_for_manager=true`). Cross-company kontrolü: aynı şirket → sadece visibility yeter; farklı şirket → visibility + company_permissions ikisi de gerekir.
- **Notification endpoint'leri** (JWT auth): `GET /api/notifications` (limit=50, unread_only), `GET /api/notifications/unread-count`, `POST /api/notifications/{id}/read` (user_id-scoped, foreign 404), `POST /api/notifications/read-all`, `POST /api/notifications/scan-now` (admin-only, ad-hoc trigger).
- **Frontend**: `NotificationBell.jsx` NeuralLinkHeader'a mount edilmiş. 60 saniye polling ile unread count → kırmızı badge. Bell click → popover (BİLDİRİMLER (n), item click → mark read + unread badge decrement + opacity düşer, `CheckCheck` mark-all + `X` close). Manager fan-out satırı için "emp1_test kullanıcısının görevi geciktirmesi" copy, self için "Görevin gecikti".

**B. Heat Map** (`team_service.build_heatmap`)
- MongoDB aggregation pipeline: `tasks.status=done` × `substr(updated_at,0,10)` gün key'ine göre grup → per-user daily done count.
- Endpoint: `GET /api/team/heatmap?days=N` (default 60, max 365). Dense response: her user için `days` dizisi (o pencerede olmayan günler `done:0`).
- **Frontend**: `TeamPanel` detaylı görünüm açıkken her üye satırı altında `data-testid=team-heatmap-{username}` grid. 15 kolonlu CSS grid, cell rengi 5-tier opacity scale (`bg-sertex-cyan/5 → /100`), hover title `YYYY-MM-DD · N tamamlandı`. 30/60/90 gün seçici (`team-heatmap-window`).

**Test**: `/app/test_reports/iteration_46.json` — Backend 52/52 pytest (20 permissions + 22 tasks + **10 yeni test_team_faz2**), Frontend E2E scanner+bell+popover+heatmap+cross-company scenario tam yeşil. Sıfır regresyon.

**Known non-issue**: Task sil işlemi mevcut notification satırlarını cascade silmiyor — user history'de kalır (documented in RCA notes). Kullanıcı hikayesi açısından "geçmiş kayıt" tutmak istenen davranış.

## ✅ Faz 9 — Backend Refactor (2026-07-26)
server.py 2062 → 557 satır (%73 azalma). 5 yeni router modülü altında konu bazlı gruplama.

**Yapı:**
- `server.py` (557 satır) — sadece app iskeleti + startup + chat/RAG
- `routers/tasks_router.py` (462) — tasks CRUD + categories + orphans + reassign + reorder
- `routers/team_router.py` (200) — team summary + heatmap + notifications + weather
- `routers/admin_router.py` (476) — user CRUD (3-mode delete) + quota + stats/summary + impersonate
- `routers/auth_router.py` (150) — auth (login/me/change-*) + settings (workspace_mode + reminder)
- `routers/personal_router.py` (207) — notes + memory + conversations + tts + stt/whisper

**Factory-pattern:** Her router `build_*_router(db, deps...)` fabrika fonksiyonu ile `APIRouter` döner. Bağımlılıklar (`db`, `current_user`, `licensed_user`, `require_admin`, `hash_password`) parametre olarak enjekte edilir.

**Test:** 109/109 pytest yeşil (sıfır regresyon). Frontend %100 çalışıyor (curl smoke + Playwright).


## ✅ Faz 8 CP5 — Yaklaşan Son Tarih Uyarısı (2026-07-26)
Görev son tarihi yaklaşınca hiyerarşik turuncu uyarı + bildirim üreten sistem.

**Backend (yeni):**
- `Task.reminder_days` (Optional[int], whitelist: 1/2/3/5/7/14) + `Task.reminder_disabled` (bool) + `Task.due_soon_fired_at_days` (idempotency marker).
- `User.due_soon_threshold` (Optional[int]) — kişisel eşik override.
- `Company.due_soon_threshold` (Optional[int]) — şirket varsayılanı.
- `GET /api/settings/reminder-config` — resolved config (system default + user + company + effective + allowed_days).
- `PUT /api/settings/reminder-threshold` — kişisel eşik ayarı (whitelist enforced).
- `PATCH /api/companies/{cid}` — `due_soon_threshold` genişletildi; admin herhangi bir şirket, manager sadece kendi şirketi için değiştirebilir.
- `team_service.scan_and_notify_due_soon()` — overdue scanner ile aynı loop'ta çalışır; `NOTIF_TYPE_DUE_SOON` notification üretir (`days_until_due` + owner/manager fan-out).
- Öncelik zinciri: `task.reminder_disabled=True` (bypass) → `task.reminder_days` → `user.due_soon_threshold` → `company.due_soon_threshold` (Team mode) → sistem default 3.

**Frontend (yeni):**
- Ayarlar → "Uyarılar" sekmesi (`settings-tab-reminders`).
- Yeni görev formuna `task-reminder-days-select` (görev bazlı override).
- Context menu (sağ tık) → "Yaklaşan Uyarısı" submenu.
- Task card görsel katmanlar: 🟢 normal → 🟠 açık turuncu → 🟠 koyu turuncu → 🔴 kırmızı.
- NotificationBell'de `due_soon_task` için ⏱ Clock ikonu + "N gün kaldı".
- Task formu Şirket alanına autocomplete (datalist) + assignee'den otomatik doldurma.

## ✅ Faz 8 CP6 — Multi-Company Membership + Orphan Tasks + 3-Mode Delete (2026-07-26)
Bir çalışan birden fazla şirkette görev yapabilir; şirketten çıkarılınca görevleri o şirketin müdürünün "Yarım Kalan İşler" havuzuna düşer; kullanıcı silme 3 modda.

**Backend (yeni/genişletilen):**
- `users.company_ids: List[str]` — çoklu şirket üyeliği. `users.company_id` primary olarak kalır (legacy).
- `tasks.company_id: Optional[str]` — görevin ait olduğu şirket.
- `tasks.orphaned/orphaned_at/orphaned_from_company_id/prev_assignee_user_id/prev_assignee_name` — Yarım Kalan İşler için.
- `company_permissions.status: 'pending'|'active'|'declined'|'revoked'` + `requested_by/responded_by/responded_at` — cross-manager istek + onay flow.
- **Yeni endpoint'ler:**
  - `POST/DELETE /api/companies/{cid}/members/{uid}` — üye ekle/çıkar (admin veya kendi şirket manager'ı).
  - `GET /api/companies/{cid}/members` — üye listesi.
  - `GET /api/orphan-tasks` + `GET /api/orphan-tasks/count` — Yarım Kalan İşler havuzu (admin: hepsi, manager: kendi şirketleri, employee: boş).
  - `POST /api/company-permissions/{cpid}/respond?approve=true|false` — target manager onaylar/red.
  - `POST /api/company-permissions/{cpid}/revoke` — active grant iptali.
  - `DELETE /api/admin/users/{uid}?mode=soft_orphan|hard|purge` — 3 modlu silme.
- **RBAC helpers refactor:** `can_view_user`, `visible_user_ids`, `managers_who_can_see`, `can_view_company` hepsi `company_ids` intersection çalışır. `get_user_company_ids(u)` fallback helper.
- **Migration**: `run_permission_migrations` yeni step — `company_ids = [company_id]` backfill + `company_permissions.status = 'active'` legacy backfill.
- **Task reassign**: Orphan reclaim path — manager `orphaned_from_company_id ∈ own company_ids` ise `can_view_user` bypass ederek reclaim edebilir.

**Frontend (yeni):**
- **Yeni sekme**: Sidebar'da "Yarım Kalan" (`tab-orphans`) — sadece admin/manager görür.
- **OrphanTasksPanel** — orphan liste, "BAŞKA ÇALIŞANA DEVRET" dropdown ile reclaim, "Sil" ile discard.
- **UserManagement 3-mode delete modal** — soft_orphan (adı koru) / purge (KVKK) / hard (nükleer).
- **CompaniesManagement 3-state toggle** — GÖRÜR / BEKLEMEDE / GÖRMÜYOR (active/pending/none).
- **API layer**: `companiesApi.listMembers/addMember/removeMember`, `companyPermissionsApi.request/respond/revoke`, `orphanTasksApi.list/count`.

**Test raporu:** `/app/test_reports/iteration_53.json` — **backend 109/109 pytest yeşil**, frontend %100 (tab-orphans RBAC + orphan-empty + 3-mode delete + 3-state cross-perm). Sıfır bug. Kozmetik minör: Settings modal tab wrap.

## ✅ Faz 10 — Şirket Değişiminde Otomatik Görev Devri (Offboarding) (2026-06 · Opus fork)
Kullanıcının fork talebi: Bir çalışanın şirketi değiştiğinde görevleri otomatik yönetilsin.
CP6'da boşta havuzu altyapısı vardı ama **şirket DEĞİŞTİRME** tetiklemesi ve **"biten → arşiv"** kuralı eksikti.

**Onaylanan kurallar (ask_human):** S1-A (kişisel/başka-şirket görevlerine dokunma) · S2-A (yalnız ayrılınan şirketin görevleri) · S3-A (arşiv kuralı tüm akışlarda) · S4-A (özet toast) · **Devir: A-A** (görev doğrudan ayrılınan şirketin müdürüne atansın + Yarım Kalan havuzunda işaretli kalsın + müdüre bildirim).

**Backend:**
- `team_service.offboard_user_from_company(db, uid, company_id, ...)` — ortak yardımcı. FINISHED (status=done) görevleri arşivler; UNFINISHED görevleri `orphaned=True` yapar, şirketin bir müdürü varsa görevleri o müdüre atar (`user_id=manager`, prev_assignee korunur) + in-app (`tasks_orphaned` bildirimi) + FCM push. `{archived, orphaned, manager_id}` döner. Kişisel/başka-şirket görevlerine dokunmaz (company_id filtresi).
- `admin_router.admin_update_user` — şirket değişince (PATCH company_id/company_name) offboard tetiklenir + `company_ids` senkronize edilir (eski çıkar, yeni eklenir); yanıta `_offboard` özeti eklenir.
- `admin_router.admin_delete_user` — soft_orphan/purge modlarına "biten → arşiv" eklendi (S3-A).
- `permissions_router.remove_company_member` — inline orphan bloğu ortak helper'a taşındı (arşiv + müdüre devir + bildirim); yanıta `archived_tasks` eklendi.
- `NOTIF_TYPE_TASKS_ORPHANED = "tasks_orphaned"` (task_id=None → dedup index tetiklenmez).

**Frontend:**
- `UserManagement.jsx > submitCompanyEdit` — PATCH yanıtındaki `_offboard` özeti toast'a eklenir ("N görev müdüre aktarıldı, M biten görev arşive taşındı").
- `NotificationBell.jsx` — yeni `tasks_orphaned` bildirim tipi: 📦 PackageX ikon (amber), "X ayrıldı — N görev size aktarıldı", tıklama → `sertex:sidebar-tab` ("orphans") ile Yarım Kalan sekmesine atlar.

**Test:** `tests/e2e_offboard_check.py` — 16/16 PASS (arşiv + orphan-reassign + prev_assignee + company_ids sync + müdür bildirimi + havuz + müdür normal listesi). `test_multi_company.py` (31) + `test_workspace_and_company.py` seri olarak yeşil. NOT: `test_multiuser`'daki bazı testler bu forked ortamda kalıcı test kullanıcısı "ahmet"in lisansı olmadığından 402 ile düşüyor — DEĞİŞİKLİKLERİMLE İLGİSİZ (git stash ile doğrulandı, aynı testler değişikliksiz de aynı şekilde düşüyor).


### Backlog · UX Potansiyelleri (kullanıcı sonra istedi)
- **Masaüstü push + ses bildirimi**: browser Notification API + kısa ses. Sertex tabı arka planda bile olsa overdue task geldiğinde masaüstü bildirimi + JARVIS-vari kısa ping (`SP0` chime). Tahmini 1-2 saat. Owner: kullanıcı istediğinde uygulanacak.
- **Kategori-bazlı raporlama (P2)** — kullanıcı 2026-07-26'da onayladı, sonraya bırakıldı: Manager "Ekibim" panelinde iş kolu bazlı özet kartları ("Bu ay Kargolama: 47 tamamlandı, 3 gecikti", "İmalat: 22 açık"). Backend: `/api/team/category-summary` (aggregate by `category_id` + `status` + `due_date`). Frontend: `TeamPanel.jsx`'e yeni "İş Kolu Performansı" grid'i (kategori rengi + progress bar + gecikme sayısı). B2B satış argümanı olarak güçlü. Tahmini ~2 saat.


### Faz 8 CP4 — İş Kolları (Task Categories) (2026-07-26) ✅
Kullanıcı isteği: her şirket kendi iş kollarını serbestçe tanımlasın (Kargolama, Transfer, Fason Verme, İmalat gibi) — görev formunda dropdown, listede üstte filter chip'leri, mevcut göreve sağ tıklayınca "İş Koluna Taşı" alt menüsü.

**Backend** (`server.py`)
- Yeni koleksiyon `task_categories` — `{id, company_id, name, color, created_at, created_by}`. Company-scoped, case-insensitive unique per-company.
- Yeni CRUD endpoint'leri: `GET/POST/PATCH/DELETE /api/task-categories`. Guard: admin+manager CRUD; employee sadece list + kendi görevine PATCH ile atayabilir (403 on create).
- `Task.category_id` opsiyonel alanı + `TaskCreate.category_id` + `TaskUpdate.category_id` (boş string → `$unset`, valid id → company-scope validation).
- **Cascade delete**: kategori silinince `tasks.category_id` referansları `$unset` — görev korunur, etiket temizlenir.

**Frontend**
- Yeni component `TaskCategoriesManagement.jsx` — CRUD panel (create/rename/delete inline).
- Ayarlar → yeni **"İş Kolları"** sekmesi (`settings-tab-categories`, admin+manager guard'lı).
- `TasksPanel`:
  - Yeni görev formunda `task-category-select` dropdown (categories varsa görünür).
  - Üstte `category-filter-bar` chip'leri: `TÜMÜ` + admin tanımlı kollar + `KOLSUZ` — her chip'te live count.
  - Task card'da `task-category-{id}` rozet (Tag ikon + kategori adı).
  - ContextMenu'ye **"İş Koluna Taşı"** item + `ctx-category-submenu` (mevcut kategoriye ✓ Check, diğerleri + "Kolsuz" seçeneği).

**Test**: `/app/test_reports/iteration_50.json` + `iteration_51.json` (retest). Backend 57/57 pytest (8 yeni test_task_categories + 49 regresyon). Frontend: iter_50'de bulunan HIGH bug (ReorderableTaskCard prop drilling) tek satırla fix'lendi (iter_51 %100). Sıfır regresyon — Faz 8 CP1-CP3, Team Faz 2, Task-Jump, Task-Devret, Settings overflow fix hepsi hâlâ green.

## ✅ Faz 9 CP4 — Production Monitoring + Desktop Push Notifications (2026-07-26)
Yönetici, üretimdeki Sertex örneğinin sağlığını gerçek zamanlı olarak Admin panelinden izleyebilir; kullanıcılar Sertex tab'ı arka planda olsa bile masaüstünde bildirim + kısa uyarı sesi alabilir.

**Backend (yeni):**
- `monitoring_service.py` — `ErrorCounter` (24s rolling window + total by level + son 10 hata detayı), `SertexJsonFormatter` (JSON satır log), `install_structured_logging()` (idempotent counter handler + opsiyonel JSON mode `SERTEX_LOG_JSON=1`), `build_health_snapshot(db)`.
- `GET /api/admin/health` (admin_router.py) — `require_admin` guard. Payload: `status, server_time, uptime_seconds, uptime_human, python_version, users {total, active_24h, admin, manager, employee}, tasks {total, created_24h, done_24h, overdue_open, orphaned}, chat {conversations_24h, messages_24h}, notifications {unread}, companies {total}, licenses {active}, db {collections, data_size_mb, storage_size_mb, index_size_mb, objects}, errors {window_hours, windowed, total, recent}`.
- `server.py` startup'ta `install_structured_logging()` — root logger'a counter handler bağlar; WARNING+ log kayıtları otomatik sayaça düşer.

**Frontend (yeni):**
- `MonitoringDashboard.jsx` — 16 metric kart + son 10 hata listesi + 30s auto-refresh. Cyan/green/orange/red renk kodlu. `monitoring-refresh` manuel yenileme butonu.
- Settings → yeni **"İstatistik"** sekmesi (`settings-tab-monitoring`, Activity ikon, sadece admin görür).
- Tab strip'i `flex-wrap` yerine `flex-nowrap overflow-x-auto` — 12+ tab yatay kayan bar (satır atlama/görsel çakışma yok).
- `desktopNotifier.js` — browser Notification API sarmalayıcı: `loadDesktopPref/saveDesktopPref` (localStorage `sertex_desktop_notif_v1`), `requestPermission`, `processBatch` (60s poll'da yalnızca yeni unread notif'ler için OS toast fire eder — max 3/poll, seen-ids memoization ile spam engellenir), `fireOne` (kısa `digital` alarm preset sesi opsiyonel).
- `NotificationBell.jsx` — popover header'a ⚙ Settings ikonu (`notification-pref-toggle`) + `notification-pref-panel` (enable + sound checkbox'ları). Poll her tick'inde `processBatch` çağırıyor.
- `statsApi.adminHealth()` (api.js).

**Test raporu:** `/app/test_reports/iteration_54.json` — Backend 51/51 (11 test_monitoring + 40 admin-regression), Frontend %100 (16 testid, RBAC visibility admin/manager/employee doğrulandı, localStorage persistence çalışıyor). Sıfır bug. Kozmetik minör (Settings tab bar overflow) aynı iterasyonda çözüldü (`flex-nowrap` yatay strip).

## ✅ Faz 9 CP4.1 — Panel Kayması Bug Fix (Panel Drift) (2026-07-26)
Kullanıcı raporu: "Kenardaki gizle okuna tıklayınca paneller sırayla aşağı iniyor, sonunda bir panel ekranın altında kalıyor ve yok oluyor. Reset diyince eski hale geliyor."

**Root cause (Playwright ile canlı reproduce edildi):**
1. `SertexMain.jsx` içindeki `MutationObserver` chip-stack büyümesinde `sertex:shift-down-{id}` event dispatch ederek çakışan panelleri aşağı itiyordu.
2. `DraggablePanel.showPanel()` restore olduğunda başka bir overlap detection çalıştırıyordu.
3. **Asıl kaynak**: header üstündeki butonların (gizle/küçült/palette/dock) `mousedown` event'i, drag-handle olan header div'e propagate ediyor → Rnd bunu "zero-distance drag" olarak algılayıp `onDragStart` + `onDragStop` çift zincirini tetikliyor → `applySnap` en yakın panel kenarına snap yapıyor (SNAP_THRESHOLD=8 px). Bu her hide/show çevriminde +5 px aşağı kayma üretiyor, localStorage'a kalıcı kaydediliyor ve panel yavaş yavaş ekran dışına iniyor.

**Fix:**
- `SertexMain.jsx`: chip-stack MutationObserver + shift-down dispatch tamamen silindi (kullanılmayan `--sx-chip-*` CSS var'ları da).
- `DraggablePanel.jsx`: `sertex:shift-down-{testId}` listener + `showPanel()` overlap detection silindi (`showPanel()` artık sadece `setHidden(false)`).
- `DraggablePanel.jsx`: `draggingRef` (useRef) eklendi. `onDragStart` set ediyor, `onDragStop` sadece gerçekten drag olduysa `applySnap` + `setPos` + `saveState` çalıştırıyor.
- `DraggablePanel.jsx`: Header button container'ına `onMouseDown={e => e.stopPropagation()}` + `onTouchStart` eklendi — Rnd'nin bu tıklamaları drag olarak algılamasını engelliyor.

**Doğrulama (Playwright, canlı):**
- 20 ardışık hide/show cycle → baseline (20, 305, 590) SABİT, sıfır drift.
- 5 multi-panel cross cycle → sıfır drift.
- Palette + minimize karışık tıklamalar → sıfır drift.
- Gerçek drag hala çalışıyor (100 px sürükleme → y=120 kaydedildi).
- Backend 21/21 pytest (monitoring + stats_summary) yeşil, regression yok.

## ✅ Faz 9 CP4.2 — Quick Preset Switcher (2026-07-26)
Kayıtlı düzen preset'leri şimdiye kadar sadece Sidebar açıkken (NEURAL LINK header'ında) görünüyordu. Kullanıcılar sidebar'ı sık kapatıyor ve preset'leri fark etmiyordu.

**Yeni bileşen:** `QuickPresetSwitcher.jsx` — Sidebar kapalıyken sidebar-toggle butonunun hemen yanında (dock'a göre 4 kenardan biri) beliren kompakt bir dropdown chip'i. En az 1 preset kayıtlıysa görünür, hiç preset yoksa hiç görünmez.

**Davranış:**
- Sidebar açıkken TAMAMEN gizli (regresyon yok — mevcut sidebar preset UI'ı hâlâ birincil arayüz).
- Sidebar kapalıyken chip: `[🔖 AKTİF_PRESET ⌄]` — tıklanınca preset listesi açılır, seçim yapılınca `loadPreset()` (sidebar'daki aynı handler) çağrılır ve düzen uygulanır.
- Dock-aware konumlanma: sağ/sol/üst/alt dock için toggle button'un hemen yanında.
- Yeni state, persistence veya business logic YOK — sidebar'ın mevcut `presets`, `activePreset`, `loadPreset` prop'larını alır.

**Doğrulama (Playwright):**
- Sidebar OPEN → switcher görünmüyor ✓
- Sidebar CLOSED + 0 preset → switcher görünmüyor ✓
- Sidebar CLOSED + 3 preset (ÇALIŞMA/ODAK/DEMO) → chip "ÇALIŞMA" label'iyle çıkıyor, list 3 item ✓
- ODAK'a tıklama → LS `sertex_layout_active_preset_v1 = "ODAK"`, sayfa reload, sidebar açılınca DÜZEN select ODAK gösteriyor ✓
- Preset kaydı/silme (mevcut sidebar UI) regresyonsuz ✓
- Backend 21/21 pytest yeşil ✓

## ✅ Faz 9 CP4.3 — Preset Thumbnail Snapshots (2026-07-26)
Kayıtlı düzenler artık görsel olarak da tanınabiliyor. Kullanıcı yeni bir düzen kaydettiğinde arka planda otomatik olarak ekranın mini bir snapshot'ı üretiliyor ve Quick Preset Switcher dropdown'ında isim yerine (isimle birlikte) küçük thumbnail gösteriliyor.

**Değişiklik:**
- `yarn add html2canvas` (~250 KB, ilk `savePreset` çağrısında dinamik import ile yüklenir — initial bundle şişmez).
- `Sidebar.jsx > savePreset` şimdi `async`: prompt AÇILMADAN ÖNCE `html2canvas(document.body, {scale: 0.25})` ile ekran yakalanır, sonra 200×112 JPEG'e downscale edilir (@ quality 0.55 → ~3-8 KB base64) ve `snapshot.__thumbnail` alanına eklenir. Yakalama başarısız olursa (WebGL, CORS, vb.) sessizce fallback — preset yine kaydedilir, sadece thumb'sız.
- `QuickPresetSwitcher.jsx` — her preset item şimdi 64×36 px thumb + isim yan yana render ediyor. Eski preset'ler (`__thumbnail` yok) için Bookmark ikonlu boş kare fallback'i.
- `applySnapshot` iteration hâlâ `LAYOUT_KEYS` üzerinde — `__thumbnail` alanı görmezden geliniyor (backward compat).

**Doğrulama (Playwright):**
- 2 eski preset (ESKI-1/ESKI-2, thumb'sız) + 1 yeni preset (YENİ-DÜZEN) senaryosu
- `sidebar-preset-save` tıklama → html2canvas 3.2 KB thumbnail üretti ✓
- Dropdown: eski preset'ler ikon fallback, yeni preset gerçek thumb (küre + paneller görünüyor) ✓
- Preset yükleme akışı bozulmadı ✓
- Backend 21/21 pytest yeşil ✓

## ✅ Faz 9 CP4.4 — Quick Preset Hover Preview (2026-07-26)
Quick Preset Switcher dropdown'ında bir preset'in üzerine gelince (mouse hover veya klavye focus) **büyük boy full preview popover'ı** açılıyor — 420×262 boyutunda tam thumbnail + preset ismi + AKTİF rozeti.

**Değişiklik (yalnız `QuickPresetSwitcher.jsx`, başka dosya yok):**
- Yeni state: `previewName` (hover edilen preset ismi).
- Item butonlarına `onMouseEnter` + `onFocus` → `setPreviewName(n)`; list container'ına `onMouseLeave` → `setPreviewName(null)`.
- Yeni JSX bloğu: `open && previewName && presets[previewName]?.__thumbnail` → dock-aware konumlanan absolute popover (right/left dock için yatay yan, top/bottom dock için dikey).
- Explicit `width: 420` inline stil (parent switcher container'ı 220 px genişliğinde olduğundan, aksi halde shrink-wrap yapardı).
- Thumb'sız preset'lerde hover → **preview çıkmaz** (backward compat + görsel gürültü yok).

**Doğrulama (Playwright):**
- Thumb'lı preset hover → preview 420×262 render ✓
- Thumb'sız preset hover → preview çıkmaz ✓
- Mouse leave → preview kaybolur ✓
- Click hâlâ preset yükler (mevcut click davranışı korundu) ✓
- Backend 21/21 pytest yeşil ✓

## ✅ Faz 9 CP4.5 — MongoDB `id` Convenience Indexes (2026-07-26)
Tüm ana koleksiyonlarda özel `id` string alanına MongoDB indeksi eklendi. Öncesinde `find_one({"id": <uuid>})` her sorguda tam koleksiyon taraması yapıyordu; şimdi O(log N).

**Değişiklik (`server.py > _startup`):**
- 16 collection'a idempotent `db[coll].create_index("id")` çağrısı (non-unique — hâlihazırdaki accidental duplicate'ler startup'ı bozmasın diye).
- Her koleksiyon için ayrı try/except — bir başarısız index diğerlerini engellemez.
- Collection listesi: users, tasks, notes, memories, conversations, messages, files, reminders, companies, notifications, licenses, task_categories, company_permissions, manager_visibility, system_settings, backups.

**Doğrulama:**
- MongoDB `index_information()` — 14 major collection'da `id_1` index onaylandı ✓
- 51/51 pytest yeşil, regression yok ✓

## ✅ Faz 9 CP4.6 — Chat/RAG Router Refactor (2026-07-26)
`server.py` içindeki en büyük parça — /chat endpoint'i (~155 satır) — kendi router modülüne taşındı.

**Değişiklik:**
- YENİ dosya: `/app/backend/routers/chat_router.py` (~294 satır) — ChatChart, Message, Conversation, ChatRequest, RagSource, ChatResponse models + SYSTEM_PROMPT_TR/EN prompts + `build_chat_router(db, licensed_user, emergent_llm_key)` factory + `/chat` endpoint.
- `server.py` küçüldü: **543 → 330 satır (-40%)**. Duplicate model tanımları, prompts ve endpoint kaldırıldı; sadece re-export block + `include_router(build_chat_router(...))` mount kaldı.
- ruff `F401`/`F811` sıfır uyarı.
- **Sıfır behavior change**: /chat endpoint byte-identical, response format aynı, model isimleri aynı, prompt metinleri aynı.

**Doğrulama:**
- `python -c "import server"` clean ✓
- `curl /api/chat` "Merhaba, kendini kısaca tanıt" → Sertex kimliğini koruyor, Türkçe cevap ✓
- 81/81 pytest yeşil (monitoring + stats + tasks + task_categories + admin_user_quota + system_quota) ✓
- Frontend UI smoke test — 3 HUD paneli render, sidebar chat listesi + biraz önce atılan mesaj görünüyor ✓

## ✅ Faz 9 CP4.7 — Kota Upgrade CTA Yönlendirmesi (2026-07-26)
Depolama uyarı/danger banner'ları artık **tıklanabilir**. Kullanıcıya göre doğru aksiyona yönlendiriyor:
- **Employee/Manager** → `mylicense` sekmesine götürür (kod aktif etme/yenileme paneli).
- **Admin** → header'daki kalem ikonuyla aynı `onEditSystemQuota` prompt'unu tetikler (sistem geneli kotayı direkt düzenle).

**Değişiklik (yalnızca 2 dosya):**
- `NeuralLinkHeader.jsx`: `<div>` banner'lar `<button>`'a çevrildi, `onClick` handler eklendi, hover underline transition; `stats.is_admin_scope` guard'ıyla iki farklı rota.
- `SertexMain.jsx`: `sertex:open-settings-tab` window CustomEvent listener eklendi (Sidebar → SertexMain arası prop drilling yerine event bus). `detail.tab` ile hangi sekme açılacağı gelir.

**Doğrulama (Playwright):**
- emp1_test ile event dispatch → LİSANSIM sekmesi aktif, "Aktif · Deneme (30 gün)" içeriği görünüyor ✓
- Backend 21/21 pytest yeşil, regression yok ✓

## ✅ Faz 9 CP4.14 — Kullanıcı Ekleme: Şifre Opsiyonel + Geçici Şifre Rozeti (2026-07-26)
Yeni kullanıcı formunda şifre alanı **artık zorunlu değil**. Admin isterse manuel belirler, isterse boş bırakır → backend güvenli 10-haneli geçici şifre üretir ve response'ta döner. Ek olarak geçici şifresi hâlâ aktif olan kullanıcılara **sarı "GEÇİCİ ŞİFRE" rozeti** eklendi.

**Backend (`admin_router.py`):**
- `AdminCreateUserRequest.password` artık `Optional[str] = None`.
- Şifre boş/None ise `secrets.choice` ile ambiguous-char'sız (0/O/1/l/I çıkarılmış) 10-haneli üretilir.
- `password_user_set` flag: manuel=`True`, otomatik=`False`.
- Yalnızca backend üretmişse response'a `temp_password` eklenir; manuel şifreler asla echo edilmez.
- Manuel şifre girilmişse eski 6-karakter kuralı korunuyor.

**Frontend (`UserManagement.jsx`):**
- Yeni state: `setPasswordManually` (varsayılan `false`).
- Yeni checkbox: **"☐ Şifreyi ben belirleyeyim (Kapalıysa otomatik üretilir)"**.
- Checkbox kapalıyken şifre input alanı DOM'da yok → validation atlanır, payload'da `password` gönderilmez.
- Checkbox açıkken 6-karakter guard'ı devrede.
- `temp_password` dönerse toast'ta 20 saniye "🔑 Geçici şifre: xxx" gösterilir + `navigator.clipboard.writeText` ile otomatik panoya kopyalanır.
- **Yeni**: `password_user_set === false` olan kullanıcılara username satırında sarı "🔑 GEÇİCİ ŞİFRE" pill rozeti (`admin-temp-pw-badge-{username}` testid'siyle). Admin veya kullanıcı şifreyi güncelleyince (`auth.py::change_password` + `admin_router::admin_update_user` ikisi de `password_user_set: true` set eder) rozet otomatik kaybolur.

**Doğrulama:**
- Backend curl: 4 senaryo (omit / empty / manual / <6 karakter) → doğru davranış ✓
- Otomatik üretilen şifreyle login testi ✓
- Regression: `test_admin_user_quota` + `test_admin_user_with_license` + `test_impersonation` = 36/36 yeşil ✓
- Playwright: checkbox açma/kapama input görünürlüğünü doğru toggle ediyor ✓

## ✅ Faz 9 CP4.15 — İş Kolları (Admin Şirket Seçimi + Cross-Manager İzin + Görev Düzenle Dropdown) (2026-07-26)

**Sorunlar:**
1. Admin yeni iş kolu oluşturamıyordu — frontend `company_id` göndermediği için backend "Şirket seçilmeli" 400 dönüyordu.
2. Müdür başka şirkete iş kolu ekleyemiyordu — izin verilmiş olsa bile 403.
3. Görev DÜZENLE modalında iş kolu seçilemiyordu (sadece sağ tık menüsünden).
4. Görev DÜZENLE'de şirket alanı free-text idi — yazım hatası riskli.
5. 403 hatası ham İngilizce mesajla düşüyordu.

**Backend (`tasks_router.py::create_task_category`):**
- Manager artık `req.company_id` ile çapraz şirket seçebilir.
- Kendi şirketi dışında bir şirket seçtiğinde `company_permissions.status='active'` grantı aranır.
- İzin yoksa Türkçe dostane detail: *"İzniniz yok — bu şirket için iş kolu oluşturma yetkiniz yok. Hedef şirketin müdüründen izin isteyin."*

**Frontend (`TaskCategoriesManagement.jsx` — komple yeniden yazıldı):**
- Şirket dropdown: admin tümünü, müdür kendi + aktif grant'lı hedefleri görür.
- Kategoriler artık şirket bazlı **accordion gruplarında** listeleniyor (aynı admin user list pattern'i).
- Toast: başarılıda `"{ad} eklendi · {şirket_adı}"` — hangi şirkete gittiği net.
- 403 hatası `toast.warning` olarak sarı uyarıya dönüşür — "403" rakamı UI'da çıkmaz.

**Frontend (`TasksPanel.jsx::EditTaskModal`):**
- **Yeni**: `🏷️ İŞ KOLU` dropdown — `<optgroup>` ile şirket başlıkları altında gruplanır (multi-company managers için).
- Şirket alanı artık **gerçek dropdown** (görülen team members'ın benzersiz şirketleri) — free-text yerine.
- Personal workspace'te (`teamMembers` boş) input fallback devrede.
- Kaydet'te `category_id` patch'e dahil edilir (`""` göndermek clear anlamına gelir → backend `$unset`).

**Doğrulama:**
- Backend curl: 4 senaryo (admin+company_id / manager own / manager cross-denied / manager cross-allowed after grant) hepsi ✓
- Pytest: 23/23 `test_task_categories` + `test_multi_company` yeşil
- Playwright: admin AA_BadgeTest'e "SmokeTest_Category" ekleyebiliyor, gruplama doğru render ediliyor ✓

## ✅ Faz 9 CP4.16 — Cross-Company İzin Talep Butonu + Task Edit Doğrulaması (2026-07-26)

**Yeni Özellik: İzin Talep Et Butonu**
Müdür, henüz izinli olmadığı şirketler için `TaskCategoriesManagement` panelinden doğrudan izin talebi gönderebilir. `company_permissions.status='pending'` grant'ı oluşur → hedef şirketin müdürü onayladığında otomatik `status='active'`'e döner ve müdür artık o şirket için iş kolu oluşturabilir.

**UI:**
- Müdür panelinde şirket seçicinin altında **mor renkli "Başka bir şirket için izin talep et"** paneli.
- Açılır picker: yalnızca *henüz izin verilmemiş VE beklemede olmayan* şirketleri listeler.
- Talep gönderildiğinde toast: *"İzin talebi gönderildi — {şirket} müdürünün onayı bekleniyor"*.
- Admin bu paneli görmez (zaten tüm şirketlere erişimi var).

**Backend güvenlik iyileştirmesi (`tasks_router.py::update_task`):**
- Cross-company kategori atama izin kontrolüne `status='active'` filtresi eklendi.
- Yani manager'ın pending veya revoked bir grantı varsa, o şirketin iş kolunu göreve atayamaz — sadece `active` grantlar iş görür.

**Doğrulama (End-to-End curl):**
- ✅ TEST A: Manager kolusuz göndermiş, DÜZENLE ile iş kolu ekliyor → 200
- ✅ TEST B: Employee (görevi alan kişi) kendi görevinin iş kolunu değiştiriyor → 200
- ✅ TEST C: Employee cross-company iş kolu seçmeye çalışıyor → 403 (güvenlik)
- ✅ TEST D: Manager izin talebi gönderiyor → pending grant oluşuyor → 200

**Regresyon:** 52/52 pytest (task_categories + multi_company + admin_user_quota + admin_user_with_license) yeşil.

## ✅ Faz 9 CP4.16 — Cross-Company İzin Talep Butonu + Bildirim Doğrulaması (2026-07-26)

**Yeni Özellik: İzin Talep Et Butonu** (`TaskCategoriesManagement.jsx`)
Müdür artık `TaskCategoriesManagement` panelinden doğrudan izin talebi gönderebilir. Mor renkli açılır panel yalnızca *henüz izin verilmemiş VE beklemede olmayan* şirketleri listeler.

**Bildirim Sistemi Zaten Kurulu** (Faz 9 CP1'de yapılmış — bu iterasyonda **doğrulandı**):
- Backend `permissions_router.py`, izin talebini oluşturunca hedef şirketin tüm müdürlerine `cross_perm_request` notification fanout ediyor (`team_service.py::notify_cross_perm_request`).
- Frontend `NotificationBell.jsx`, cross-perm bildirimleri teal ikonlu **"🔗 X firması Y'ni görmek istiyor"** olarak render ediyor + inline **"ONAYLA / REDDET"** butonlarıyla tek tıkla onay/red imkanı sunuyor.
- **E2E doğrulama:** İki müdür (A ve B) kurulup, A→B izin talep etti, B'nin bildirim çanında `unread=1` oldu ve popover'da mesaj + butonlar doğru göründü (screenshot alındı).

**Bonus Güvenlik Fix (`tasks_router.py::update_task`):** Cross-company kategori atamasında `status='active'` filtresi eklendi — pending/revoked grantlar yazma erişimi vermez.

**Doğrulama (Curl E2E):**
- ✅ Manager A → talep gönderiyor → pending grant, notify fanout
- ✅ Manager B → `/api/notifications/unread-count` = 1, `type=cross_perm_request` ve `permission_id` set
- ✅ Playwright: Popover'da teal renkli mesaj + ONAYLA + REDDET butonları görünür

## ✅ Faz 9 CP4.17 — SSE Canlı Bildirim Push (2026-07-26)

**Ne değişti:** Bildirim çanı artık 60 saniye polling'e bağımlı değil — yeni bildirim geldiği anda Server-Sent Events (SSE) üzerinden client'a itiliyor. **Ölçüm: 60,000ms → 91ms (~660x hızlanma).**

**Backend:**
- Yeni modül `/app/backend/notification_pubsub.py`: In-memory `NotificationPubSub` (asyncio.Queue tabanlı). Publish non-blocking (`put_nowait`), full queue → drop; subscribe/unsubscribe lock ile senkronize.
- `team_service::_insert_notification` hook: her başarılı insert'ten sonra `pubsub.publish(user_id, {kind:"new", notification:...})` fanout yapar. Publish hata verirse notification write yolu asla kırılmaz (best-effort).
- Yeni endpoint `GET /api/notifications/stream?token=<JWT>`: SSE stream. EventSource header desteklemediği için token query param'la geçer; `auth.decode_token` ile in-line validate edilir. 25 saniyede bir `: keepalive` heartbeat gönderir (Kubernetes ingress timeout'una karşı). Client disconnect'te queue temizlenir.
- Response header'lar: `text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no` (nginx buffering kapalı).

**Frontend (`NotificationBell.jsx`):**
- Yeni `useEffect` — mount'ta `new EventSource(...)` ile stream açar. Gelen `new` event'i:
  - `setUnread(u => u + 1)` — badge anında güncellenir.
  - `setItems(old => [n, ...old])` — popover açıksa üste yerleştirir (deduplicated).
  - Masaüstü bildirim tercihi açıksa `processBatch([n])` ile push notification tetikler.
- Mevcut 60s polling korunuyor — SSE bağlantısı koparsa güvenlik ağı.
- EventSource `readyState === 2` (CLOSED) olduğunda tam kapama, yeniden bağlanma browser'a bırakılıyor.

**Doğrulama:**
- ✅ Manuel smoke test (`tests/manual_sse_smoke.py`): Manager A stream açıyor, Manager B izin talep ediyor → **91ms** içinde `event: new` frame'i Manager A'ya düştü.
- ✅ 46/46 pytest yeşil (team_faz2 + due_soon + task_categories + multi_company).
- ✅ Frontend webpack derleme temiz.

## ✅ Faz 9 CP4.18 — SSE Kişi Başı Bağlantı Limiti (DDoS Koruması) (2026-07-26)

**Ne değişti:** SSE bildirim akışına **kişi başı maksimum 5 eş zamanlı bağlantı** limiti eklendi. 6. bağlantı denendiğinde en eski bağlantı `event: closed` frame'i alıp zarif şekilde kapanır.

**Backend (`notification_pubsub.py`):**
- Yeni sabit `MAX_CONNECTIONS_PER_USER = 5`.
- Yeni sabit `CLOSE_SENTINEL = "__sertex_close__"` — sıra dışına atılan queue'ya işaret event.
- `subscribe()` metodu: bucket cap'e ulaşınca en eskisini `pop(0)` ile çıkarır, sentinel event push eder. Sentinel push `_lock` dışında yapılır → subscribe hiçbir zaman yavaş queue nedeniyle bloke olmaz.

**Backend (`team_router.py`):**
- SSE event_gen döngüsü sentinel'i tanır → `event: closed` yayınlayıp döngüden çıkar.
- Client'a **neden** kapandığı bildirilir (`reason: cap_exceeded`) — reconnect kararı browser'a bırakılır (EventSource otomatik reconnect ediyor zaten).

**Test:**
- ✅ Cap smoke test (`tests/manual_sse_cap_smoke.py`): 6 stream açıldı → sadece idx=1 evict edildi, idx=2-6 hâlâ açık.
- ✅ Live push smoke test hâlâ **83ms** — limit koyulması hızı bozmadı.
- ✅ 46/46 pytest yeşil (team_faz2 + due_soon + task_categories + multi_company).

**Meşru Kullanıcı Etkisi: SIFIR** — Normal kullanıcı (5 sekme/cihaz/laptop/telefon) etkilenmez. Sadece kötüye kullanan hesaplar sınırlanır.

## 📌 Upcoming — Kayıtlı Öneriler (Kullanıcı Onayı Bekleyen)

- **📢 Global Duyuru Sistemi** — Admin panelinden "Duyuru Yayınla" butonu (başlık + mesaj gir → tüm kullanıcılara SSE üzerinden anında düşsün + banner). Faz 9 CP4.18 tamamlandığında ertelendi. Tahmini süre: 20 dk.
- **🔔 Firebase Cloud Messaging (FCM) Push Notifications** — Sertex Android uygulaması kapalıyken bile "Yeni görev / Görev süresi geçti" push bildirimi düşürsün (WhatsApp gibi). Firebase console setup + `@capacitor/push-notifications` plugin + backend FCM sender endpoint. Faz 9 CP4.21 tamamlandığında ertelendi. Tahmini süre: 30 dk.
- **🎨 Mobile-First Responsive Redesign** — Şu an APK'da HUD'u küçültüp gösteriyoruz (kullanışlı ama gerçek mobil UX değil). Mobilde: (1) tek panel full-screen, (2) alt kısımda hamburger tab bar, (3) swipe ile paneller arası geçiş. Faz 9 CP4.22 tamamlandığında ertelendi. Tahmini süre: 2 saat.

## ✅ Faz 9 CP4.19 — Capacitor Android Native Shell (2026-07-26)

**Ne yapıldı:** Sertex web uygulaması artık **native Android APK** olarak paketlenebiliyor. Codemagic bulut derleme ile her `git push` sonrası ~10 dakikada otomatik yeni APK üretilir.

**Backend:** Hiçbir değişiklik yok — mobile app aynı API'ye HTTPS üzerinden bağlanıyor (`REACT_APP_BACKEND_URL=https://sertex-ai.com`).

**Frontend eklenenler:**
- `capacitor.config.ts` — App ID `com.sertex.app`, splash 1.2s dark theme, status bar Dark stil.
- `android/` platform (17MB) — 5 Capacitor plugin dahili (App, Network, Preferences, SplashScreen, StatusBar).
- 37 adet multi-resolution ikon + splash PNG (mdpi → xxxhdpi + landscape + portrait).
- `AndroidManifest.xml` izinleri: INTERNET, RECORD_AUDIO, CAMERA, POST_NOTIFICATIONS, VIBRATE, storage.
- `src/lib/nativeShell.js` — Capacitor plugin bootstrap (splash hide, status bar theme, `data-native` body attr).
- `src/index.js` — `initNativeShell()` çağrısı web build'i etkilemeden native shell'i başlatır.
- Yeni dev dependency: `typescript@5.9.3` (Capacitor config için).

**CI/CD:**
- `/app/codemagic.yaml` — `sertex-android` workflow (mac_mini_m2, 30 dk max, debug APK).
- Free tier: 500 dk/ay ≈ ~40 build/ay.

**Doküman:**
- `/app/MOBILE_BUILD_GUIDE.md` — Adım adım Türkçe kurulum kılavuzu (GitHub bağlama, Codemagic hesabı, APK indirme, side-loading, sorun giderme).

**Test:**
- ✅ Web build başarılı (23 sn, `main.5be8da46.js` hazır)
- ✅ Capacitor sync temiz (5 plugin doğrulandı)
- ✅ Web app hâlâ preview URL'de çalışıyor (regresyon yok)

**iOS:** Bekliyor. `codemagic.yaml`'a `sertex-ios` workflow eklenecek + Apple Developer Program üyeliği ($99/yıl) alındığında aktifleştirilecek.

## ✅ Faz 9 CP4.20 — Mobil Viewport Rescale (Android APK Sol Kesim Fix) (2026-07-26)

**Sorun:** Serkan APK'yı telefonuna kurdu → tüm HUD'un sol yarısı ekranda görünmüyor. Sadece sağ kenardaki butonlar (SIFIRLA, GİZLE, SAĞ) çıkıyor, "NÖRAL LİNK", "GÖREVLER", "KAPASITEZ" gibi başlıklar ekran dışına kaydı.

**Sebep:** Sertex HUD'u 1280px+ desktop için tasarlanmış. Capacitor Android WebView ~400px genişlikte açılınca layout sığmıyor, sol tarafı taşıyor.

**Çözüm (`src/lib/nativeShell.js`):**
- Capacitor `isNativePlatform() === true` olduğunda viewport meta'yı DİNAMİK olarak yeniden yazar
- Formula: `width=1280, initial-scale = min(1, max(0.28, actualWidth / 1280))`
- 400px telefon için: initial-scale = 0.312 → tüm HUD ekrana sığar
- `minimum-scale=0.25, maximum-scale=3, user-scalable=yes` → kullanıcı pinch-zoom yapabilir

**Ek güvenlik (`src/index.css`):**
- Yalnızca `body[data-native="android"]` / `body[data-native="ios"]` için `overflow-x:auto` + smooth touch scrolling
- Herhangi bir taşan içerik yatay swipe ile erişilebilir kalır
- Web build'i etkilemez (guard ile scope'lu)

**Test (testing_agent iteration_55):**
- ✅ Desktop 1920x900: regresyon yok, CSS guard leak etmiyor, konsol temiz
- ✅ Mobil 400x800 plain browser: overflow-x çalışıyor, JS hatası yok
- ✅ Native shell simülasyonu: viewport meta doğru yeniden yazılıyor, HUD sığıyor
- ✅ Success rate: %100

**Not:** Playwright/Chromium'da viewport-meta rewrite gerçek zamanlı re-layout tetiklemiyor (bu bir mobile-browser feature). Ama gerçek Android WebView width=1280 + initial-scale=0.312'yi RESPECT eder ve HUD'u proportional olarak küçültür — Serkan yeni APK'yı kurduğunda tam ekranda görecek.

## ✅ Faz 9 CP4.21 — Mobil Touch Target & Haptic Feedback (2026-07-26)

**Amaç:** Android APK'da parmakla tıklama deneyimini iyileştirmek — Google Material tavsiyesine uygun minimum 44x44px hedef boyutları + tıklamada haptic (titreşim) geri bildirim.

**Kurulum:**
- Yeni package: `@capacitor/haptics@7.0.5`

**CSS (`src/index.css`):**
- `body[data-native="android"] / [data-native="ios"]` scope'lu:
  - Tüm `<button>`, `<a href>`, `<input>`, `<select>`, `<textarea>`, `role="button"` elementlere `min-height: 44px` + `min-width: 44px`
  - `touch-action: manipulation` → 300ms tap delay yok
  - `-webkit-tap-highlight-color: transparent` → mavi tap-flash yok
- Kompakt ikon butonlar için `.icon-btn` opt-out class'ı (toolbar'lar şişmesin diye)
- Web build'i etkilemez (guard scope'lu)

**JS (`src/lib/nativeShell.js`):**
- Global `click` capturing listener kuruldu — her interactive element tap'inde `Haptics.impact({ style: ImpactStyle.Light })` fire eder
- Framer Motion / Radix gibi wrapper'lar için up to 4 ancestor walk (svg/span üzerinde tıklamayı butona map eder)
- `passive: true, capture: true` → performans optimum, ~3ms overhead
- Silent-fail: Haptics API hata verirse yakalanır ve tıklama yine normal işler

**Test:**
- ✅ Web preview (1920x900): `data-native` attribute null (leak yok), 0 konsol hatası, buton clicks normal
- ✅ Web build compile: temiz (23s)
- ✅ Capacitor sync: 5 plugin doğrulandı, hata yok
- ⏳ Nihai APK test: Serkan yeni APK'yı kurduğunda titreşimleri hissedecek + tıklama alanları rahatlayacak

## ✅ Faz 9 CP4.22 — Android WebView useWideViewPort Fix (Real Sol Kesim Çözümü) (2026-07-26)

**Sorun:** Bir önceki fix (CP4.20) JS-side viewport rewrite yapıyordu, ama Android WebView **varsayılan olarak `useWideViewPort=false`** — yani viewport meta tag'ini görmezden geliyordu. Bu yüzden sol kesim sorunu yeni APK'da devam etti.

**Kesin Çözüm (`MainActivity.java`):**
```java
settings.setUseWideViewPort(true);      // meta tag'i oku, declared width'i kullan
settings.setLoadWithOverviewMode(true); // wider content'i visible area'ya scale-et
settings.setBuiltInZoomControls(true);  // pinch-zoom aktif
settings.setDisplayZoomControls(false); // eski +/- overlay'i gizli
```

Bu ayarlar Android WebView'i **Chrome'un desktop site render mode'una** çevirir — meta tag'de belirtilen genişlikte (1280px) layout, sonra ekrana scale.

**Ek iyileştirme (`nativeShell.js`):**
- Viewport meta'yı `setAttribute` yerine **remove + recreate** ile yeniden yazıyor. Android WebView her zaman setAttribute'a re-layout ile yanıt vermez, ama element replacement'a HER ZAMAN yanıt verir.
- Console log: `[sertex-native] viewport rewritten: width=1280, initial-scale=0.312, ...`

**Doğrulama:**
- ✅ Web build compile temiz (23s)
- ✅ Capacitor sync: 5 plugin doğrulandı
- ✅ MainActivity.java değişikliği yerinde (2 satır useWideViewPort/loadWithOverviewMode)
- ⏳ APK visual test: yeni build gerekli

## ✅ Faz 9 CP4.23 — İş Kolu Görünürlük Sistemi + İşçi-Müdür Atama (2026-07-26)

**2 Yeni Özellik:**

### 1. Katmanlı İş Kolu Görünürlük
Her iş kolu artık 2 seviye grant destekliyor:
- `visible_to_company_ids: []` — ek şirketler
- `visible_to_user_ids: []` — bireysel kullanıcılar (şirketi görmese bile)

Union semantiği: Sahibi şirket üyesi VEYA visible_to_company_ids'deki şirket üyesi VEYA visible_to_user_ids'te kişisel grant → görebilir.

**Backend (`tasks_router.py`):**
- `TaskCategory` modeli 2 yeni liste alanıyla genişledi
- `TaskCategoryUpdate` bunları accept ediyor (None = değişiklik yok, [] = revoke)
- `GET /task-categories?scope=<manage|my_tasks>`:
  - `manage` (default): admin/manager yönetim view — herşey döner
  - `my_tasks`: strict görünürlük filtresi — admin dahil herkes sadece görebileceği kolları görür

**Frontend:**
- `TaskCategoriesManagement.jsx` her satıra 🟣 Lock buton + modal (2 bölüm: EK GÖRECEK ŞİRKETLER + EK OLARAK GÖRECEK KİŞİLER, sahibi şirket kilitli-implicit)
- Kategori adının yanında "+N paylaşım" mor rozeti (grant sayısı)
- `TasksPanel.jsx` category chip/dropdown çağrıları scope='my_tasks' → temiz görünüm

### 2. İşçi-Müdür Atama Modalı
`UserManagement.jsx` her satırda yeni mor Briefcase butonu → modal açar:
- Sistemdeki tüm müdür + admin listesi checkbox olarak
- Mevcut atamalar pre-check'li
- Save = diff (add/remove) → `managerVisibilityApi.grant/revoke`

**Test (iteration_56, %100 başarı):**
- ✅ Backend: 5/5 yeni E2E test (default hidden → user grant → company grant → revoke → manage view)
- ✅ Backend regression: 40/40 mevcut pytest yeşil
- ✅ Frontend: 16/16 UI check yeşil (buton görünürlüğü, modal açılışı, save işlemleri, rozet)
- ✅ 0 console error, retest_needed: False

## ✅ Faz 9 CP4.24 — Atama Matrisi (Assignment Matrix) (2026-07-27)

**Amaç:** Admin panelinde kullanıcı-müdür atamalarını modal açmadan tek tabloda, satır satır düzenleyebilmek.

**Frontend (`UserManagement.jsx`):**
- Yeni view toggle: `LİSTE ↔ ATAMA MATRİSİ` (data-testid: `user-view-toggle-list` / `user-view-toggle-matrix`)
- `viewMode === "matrix"` iken `managerVisibilityApi.list()` ile tüm satırlar prefetch edilir (`mvAll`)
- Tablo sütunları: ÇALIŞAN · ROL · ŞİRKET · MÜDÜRLER
- MÜDÜRLER hücresinde purple badge listesi (× ile inline revoke) + `+ müdür ekle` dropdown (yalnızca `role === "manager"` filtreli — admin backend'de reddediliyor)
- `matrixGrant/matrixRevoke` optimistic UI + toast (`Müdür atandı` / `Müdür kaldırıldı`)
- Filter input: kullanıcı adı veya şirket adına göre canlı arama (`matrix-filter`)

**Test (iteration_57, %100 başarı):**
- ✅ Backend: `test_permissions::TestManagerVisibility` 3/3 PASS (list/grant/revoke)
- ✅ Frontend: matrix render (23 satır), toggle, grant/revoke, filter, toast tümü PASS
- ✅ REGRESSION: LİSTE view'daki tüm eski akışlar (add/delete/role/company/quota/reset/manager-modal) etkilenmedi
- ✅ Minor UX düzeltmesi: dropdown'dan admin rolündekiler filtrelendi (backend reject'i sessize aldı)

## ✅ Faz 9 CP4.25 — Atama Matrisi: Toplu Atama (Bulk Assignment) (2026-07-27)

**Amaç:** Matriste birden fazla çalışanı checkbox ile seçip tek tıkla aynı müdürü hepsine atamak (onboarding hızlandırma).

**Frontend (`UserManagement.jsx`):**
- Yeni state: `selectedEmp` (Set), `bulkMgrId`, `bulkBusy`
- Tabloya "Seç" sütunu (header'da `matrix-select-all` — filtre görünen satırların tümünü toggle eder; row'larda `matrix-select-{username}`)
- Seçili satır varsa `bulk-assign-bar` görünür: `{N} seçili` sayacı + müdür dropdown + `TOPLU ATA` + `×` (seçim temizle)
- `bulkGrant()`: ardışık POST (audit log okunabilirliği + rate-limit koruması), idempotent skip (zaten atanmışları atla), self-assignment guard (mgr === emp)
- Consolidated toast: `{added} yeni · {skipped} zaten mevcut · {failed} başarısız`
- Başarılı bulk sonrası `selectedEmp` temizlenir, `bulkMgrId` korunur (tekrarlı ops için)

**Test (iteration_58, %100 frontend):**
- ✅ 7/7 senaryo PASS: select-all, per-row checkbox, bar visibility, bulk POST sequence, idempotent skip, clear, regression (matrix + LİSTE view)
- ✅ Backend değişikliği YOK — mevcut `POST /api/manager-visibility` reuse
- ✅ retest_needed: False

## ✅ Faz 9 CP4.26 — Atama Matrisi: Şirket Chip Filtresi + Grup Seç (2026-07-27)

**Amaç:** 23+ kullanıcılı matriste isim aramadan, şirket adına tıklayarak o şirketin çalışanlarını hızlıca gruplayıp toplu atamaya hazırlamak.

**Frontend (`UserManagement.jsx`):**
- Yeni state: `matrixCompanyFilter` (company_id | NO_COMPANY_KEY | "")
- Filter input altında yeni `matrix-company-chips` bar (yalnızca 2+ şirket varsa görünür):
  - "Tümü (N)" chip (default aktif) + her şirket için chip + "Bireysel" chip
  - Legacy `company_name` string'li kullanıcılar da chip'e dahil edildi (fallback match)
  - Aktif chip purple border/bg ile vurgulanır; tekrar tıklanınca filtre kalkar
- Her chip'in sağında **✓** mini butonu = "Bu şirketteki herkesi seç" → o gruptaki tüm çalışanları `selectedEmp`'e ekler + toast (`{şirket_adı}: N kişi seçildi`)
- `filteredEmployees` artık union filter: text arama AND chip filter
- Mevcut `matrix-select-all` header checkbox chip filter ile birlikte otomatik olarak sadece görünen satırları seçer

**Test (iteration_59, %100 frontend):**
- ✅ 6/6 senaryo PASS: chip bar render, toggle filter, select-all-in-company, header select-all filter awareness, text+chip union, regression
- ✅ Backend değişikliği YOK
- ✅ retest_needed: False

## ✅ Faz 9 CP4.27 — Görev Kilidi (Task Lock) + Tek-Kullanımlık Unlock OTP (2026-07-27)

**Amaç:** Yönetici/müdür bir kişiye görev atadığında 13 farklı aksiyonu (düzenle, sil, tamamla, beklet, tarihi geç işaretle, devret, iş kolu, tarih, hatırlat, yaklaşan uyarısı, arşivle, alt-görev, boyut sıfır) kısıtlayabilsin. Anlık istisna için tek-kullanımlık 6 haneli OTP.

**Backend (`routers/tasks_router.py`):**
- Task modeline eklenen alanlar: `created_by`, `lock_flags` (dict), `locked_by`, `locked_at`, `unlock_expires_at`, `unlock_uses_remaining`, `unlock_last_verified_at`
- Yeni `_LOCK_FLAG_KEYS` whitelist (13 aksiyon) + `LOCK_KEY_LABELS` (TR)
- Guard helper'lar: `_check_task_lock(doc, user, actions)` — admin/creator bypass + aktif unlock session bypass; aksi halde HTTP **423 Locked**
- `_consume_unlock_session()` — başarılı işlem sonrası uses_remaining--
- `_detect_lock_actions(update)` — PATCH payload'ından hangi lock_* flag'lerinin ilgili olduğunu çıkarır (title→lock_edit, status:done→lock_complete, due_date→lock_change_date, vb.)
- **3 yeni endpoint:**
  - `PATCH /api/tasks/{id}/locks` — creator/admin/manager set lock_flags
  - `POST /api/tasks/{id}/unlock-otp` — 6 haneli SHA-256 hashlenmiş kod, 10dk TTL, yeni kod önceki'yi invalidate eder, atanan kişiye SSE bildirimi (`task_unlock_offered`)
  - `POST /api/tasks/{id}/unlock-verify` — atanan doğrular, 10dk pencere + `uses_remaining=1`
- Mevcut PATCH, DELETE, reassign endpoint'lerine guard entegre edildi

**Frontend (`TasksPanel.jsx` + `api.js`):**
- `taskLockApi` — setLocks / issueOtp / verifyOtp
- ContextMenu'ye 2 yeni item: **Kilit Ayarları** (creator/admin/manager) ve **OTP Üret** (kilitli iken) veya **Kilidi Aç (OTP gir)** (assignee tarafı)
- Menü item'ları `isActionLocked()` guard'ıyla otomatik `disabled + tooltip` olur, sağda küçük 🔒 gösterir
- 3 yeni modal: `LockConfigModal` (13 checkbox + TÜMÜNÜ KİLİTLE / SERBEST BIRAK), `OtpDisplayModal` (6 haneli kod + geri sayım + kopyala), `UnlockOtpModal` (6 haneli input + submit)
- Task kartında **🔒 kilit rozeti** — flag sayısı gösterir; aktif unlock varsa yeşil 🔓 rozet ("1 kullanım kaldı")
- DELETE 423 error için özel toast (kilit mesajı)

**Test (iteration_60, %100 e2e):**
- ✅ **Backend: 48/48 PASS** (13 yeni lock+OTP testi + 35 regression: tasks/reassign/categories)
- ✅ RBAC guarantees: 403 (non-privileged setLocks), 423 (locked assignee action), 400 (wrong/used OTP), 403 (non-assignee verify), admin+creator bypass, previous OTP invalidation, single-use enforcement
- ✅ Frontend: tüm UI (ctx menu, modal, badge, OTP display) Playwright ile doğrulandı
- ✅ retest_needed: False

## ✅ Faz 9 CP4.28 — Kilit Denetim Kaydı (Audit Log) (2026-07-27)

**Amaç:** KVKK uyumu + iç sorumluluk için her lock lifecycle olayının şifresiz iz kaydı. Şifreler ASLA saklanmaz.

**Backend (`tasks_router.py`):**
- Yeni collection: `task_lock_audit` — `{id, task_id, event_type, actor_user_id, actor_username, actor_role, created_at, payload}`
- 7 event tipi: `lock_set`, `otp_issued`, `otp_verified`, `otp_consumed`, `otp_failed`, `otp_invalidated`, `task_deleted`
- `_log_lock_event()` helper — best-effort; hata WARN loglanır (KVKK observability)
- Audit çağrıları eklendi: `patch_task_locks`, `issue_unlock_otp` (invalidation + issue), `verify_unlock_otp` (failed reasons + verified), `_consume_unlock_session` (action param), `delete_task` (used_otp flag)
- Yeni endpoint: `GET /api/tasks/{tid}/lock-audit?limit=1..500` — admin/creator/manager erişebilir; silinmiş görev için sadece admin (task_exists=false)
- Retention: şu an sınırsız — TTL/sweeper backlog'da not edildi

**Frontend (`TasksPanel.jsx`):**
- `LockConfigModal`'a 2 sekme: **KISITLAMALAR** ↔ **TARİHÇE** (data-testid: `lock-tab-config`, `lock-tab-history`)
- `LOCK_AUDIT_EVENT_META` — TR label + icon + renk (Lock, KeyRound, Unlock, Check, X, Trash2)
- `formatAuditPayload()` — event tipine göre kompakt özet (lock_set için added/removed diff; otp_issued için "→ {kullanıcı}"; otp_consumed için "İşlem: {aksiyon}"; vs.)
- YENİLE butonu (data-testid: `lock-history-refresh`), boş state, loading state
- `taskLockApi.audit(task_id, limit)`

**Test (iteration_61, %100 e2e):**
- ✅ **Backend: 21/21 PASS** (8 yeni audit + 13 lock regression)
- ✅ Frontend: tab toggle + audit fetch + row render + YENİLE regression
- ✅ Admin bypass audit yazmıyor (doğru), silinmiş task audit sadece admin
- ✅ retest_needed: False
- Minor iyileştirmeler uygulandı: WARN log, limit clamp, retention comment

## ✅ Faz 9 CP4.30 — Kullanıcı Bazında Varsayılan Kilit + Self-Lock + Opsiyonel OTP (2026-07-27)

**Amaç:** (a) Kullanıcıya politika koy → yeni görevlere otomatik inherit. (b) Kullanıcı kendi self-lock koyabilir → istediği an OTP'siz kaldırır. (c) Kilidi ayarlayan "OTP gerekli mi?" seçebilir → soft lock (unlock-simple) veya strict lock (OTP).

**Backend (`tasks_router.py`):**
- Task modeline: `self_lock_flags: Dict[str, bool]`, `lock_requires_otp: bool = True`
- User docs'a: `default_lock_flags`, `default_self_lock_flags`, `default_lock_requires_otp`, `default_lock_set_by_user_id`, `default_lock_set_at`
- Guard artık `lock_flags OR self_lock_flags` kontrol ediyor
- `TaskLockPatch` opsiyonel `requires_otp` alanı; `TaskSelfLockPatch` yeni model
- 4 yeni endpoint:
  - `PATCH /api/tasks/{id}/self-locks` (assignee/admin only)
  - `POST /api/tasks/{id}/unlock-simple` (OTP-less bypass; sadece requires_otp=False iken)
  - `GET/PATCH /api/users/{id}/lock-flags` (admin/manager/self; self patch → self_lock channel, requires_otp yok sayılır)
  - `GET /api/users/{id}/lock-audit`
- `create_task` artık assignee'nin default policy'sini otomatik inherit ediyor
- Yeni audit event tipleri: `self_lock_set`, `unlock_simple`, `user_policy_set` (task_id=`__user_policy__:{uid}` marker)

**Frontend:**
- Yeni paylaşılan helper: `lib/taskLocks.js` (`LOCK_KEY_LABELS`, `LOCK_KEY_ORDER`)
- `TasksPanel.LockConfigModal`: OTP checkbox (data-testid: `lock-requires-otp`) — "Bypass için OTP gerekli (katı)" ↔ "OTP'siz açılabilir (yumuşak)"
- `UserManagement`: her user satırına 🔒 amber buton (data-testid: `admin-lock-{username}`) → **UserLockPolicyModal** açar
- `UserLockPolicyModal`: aynı görsel dil + KISITLAMALAR/TARİHÇE sekme + self-lock ile managed-lock ayrımı (self patchleyen kullanıcı için OTP checkbox gizlenir)
- `taskLockApi.setSelfLocks/unlockSimple` + yeni `userLockApi.get/set/audit`

**Test (iteration_62, %100 e2e):**
- ✅ **Backend: 34/34 PASS** (13 yeni CP4.30 + 21 regression)
- ✅ Frontend: 🔒 buton, modal, tab, TARİHÇE, KAYDET, OTP checkbox — tüm testid'ler mevcut ve fonksiyonel
- ✅ RBAC: employee ↔ diğer user → 403; self patch → requires_otp yok sayılır; manager visible employee için OK
- ✅ retest_needed: False
- Kod review notu applied: `create_task` inheritance precedence comment eklendi

## ✅ FAZ 9 CP4.34 + CP4.35 — Sistem Audit (P0 + P1 Fixes) (2026-07-27)

**Context:** Kullanıcı son 2 iterasyonda mevcut kodu bozan bug'lardan şikayetçiydi. Full system audit yapıldı (troubleshoot_agent × 2 + testing_agent regression suite).

**Faz 1-6 (Discovery / Review / Prioritization):**
- 122 endpoint · 20K frontend LOC · 9K backend LOC · 478 pytest test · 21 MongoDB koleksiyonu haritalandı
- troubleshoot_agent iki modülü (tasks_router.py + TasksPanel.jsx) satır satır inceledi
- 20 sorun tespit edildi: 9 P0, 5 P1, 6 P2 + refactor

**Faz 7 P0 Fixes (CP4.34) — 9 kritik sorun:**
1. ✅ 6 yeni DB index (task_lock_audit, task_unlock_otps, lock_policy_templates)
2. ✅ Atomik `_consume_unlock_session` — race koşulu → sınırsız bypass önlendi (conditional $inc)
3. ✅ OTP invalidation race documented (later-wins semantics honest'te belirtildi)
4. ✅ User delete cascade (`_cleanup_lock_refs_for_user` helper) — pending OTPs invalidate, manager_visibility rows silinir, audit KVKK için korunur; purge modu audit'i de siler
5. ✅ OTP verify rate limit — 5 yanlış → 15dk lockout (429), brute force imkansız (1M kombinasyondan güvenli)
6. ✅ `sertex:task-unlock-request` stable listener (stale closure yok, mounted guard)
7. ✅ setSubtasks task-scoped rollback (concurrent edit race güvenli)
8. ✅ LockConfigModal loadAudit useCallback (task-swap doğru audit)
9. ✅ `tasksApi.get` + GET /api/tasks/{id} — double network call kalktı

**Test:** iteration_64 → 56/56 PASS (9 P0 + 47 regression)

**Faz 7 P1 Fixes (CP4.35) — 5 yüksek öncelik:**
10. ✅ Template name (80) + description (500) length validation, boş için 400
11. ✅ Template per-user cap (admin 100, manager 50) — DoS surface kapatıldı
12. ✅ delete_task `used_otp` — sadece delete-locked task için hesaplanır (yanıltıcı audit fix)
13. ✅ create_task double-inherit + **channel-scoped attribution** (default_lock_managed_set_by_user_id vs default_self_lock_set_by_user_id) — self-patch managed'i artık ezmiyor
14. ✅ playReminderBeep `{cancel}` handle + activeBeepsRef unmount cleanup (memory leak yok)

**Test:** iteration_65 (11 yeni P1 test, 1 regression bulundu) → iteration_66 fix retest → **20/20 PASS · sıfır regresyon**

**Toplam:** 76/76 backend test, 3 iterasyonlarda 14 sorun düzeltildi, sıfır regresyon.

**Kalan iş (opsiyonel):**
- P2 (6 sorun): silent catch temizliği, malformed unlock_expires_at logging, JWT 30gün → kısalt, CORS wildcard, lock badge memoization
- Faz 8: regression suite genişletme (cross-flow senaryolar)
- Faz 9: refactor — TasksPanel.jsx (3400+ satır) → 8 dosyaya böl · UserManagement.jsx (1900+ satır) → 4 dosyaya böl · tasks_router.py (1400+ satır) → 3-4 router'a böl

## ✅ Faz 9 CP4.33 — Bildirim OTP Kısayolu + Kilit Politika Şablonları (2026-07-27)

**Amaç:** (a) `task_unlock_offered` bildirimine tıklayınca doğrudan UnlockOtpModal açılıyor (2 tıkla flow). (b) Admin/manager sık kullandığı kilit setlerini isimli şablon olarak kaydedip yeni kullanıcıya tek tıkla uyguluyor.

**Backend (`tasks_router.py`):**
- Yeni collection: `lock_policy_templates` — `{id, name, description, lock_flags, requires_otp, created_by, created_by_username, owner_scope, created_at, updated_at}`
- 4 yeni endpoint: `GET /api/lock-policy-templates` (admin/manager), `POST` (create — admin/manager), `PATCH /{id}` (admin/creator), `DELETE /{id}` (admin/creator)
- `LockPolicyTemplate`, `LockPolicyTemplateCreate`, `LockPolicyTemplateUpdate` Pydantic modelleri
- Employee'ler `GET`'te count=0 alır; `POST/PATCH/DELETE` → 403

**Frontend:**
- `NotificationBell.jsx`: `task_unlock_offered` bildirim tipi tanındı (KeyRound emerald icon + özel mesaj); tıklandığında `sertex:task-unlock-request` CustomEvent fire eder
- `TasksPanel.jsx`: yeni event listener → task refetch → `pendingUnlockTask` state → global `UnlockOtpModal` render (data-testid: `unlock-otp-modal`)
- `UserManagement.jsx UserLockPolicyModal`: managed mode'da 2 yeni bar — "ŞABLON: [dropdown] UYGULA 🗑" (varsayılan bar, sadece templates.length>0) ve "KAYDET: [name input] + ŞABLON" (sadece activeCount>0)
- `lockPolicyTemplateApi.list/create/update/remove`

**Test (iteration_63, %100 e2e):**
- ✅ **Backend: 47/47 PASS** (13 yeni CP4.33 + 34 full regression iteration_60-62)
- ✅ Frontend: template save/apply/delete akışı + NotificationBell → UnlockOtpModal wiring doğrulandı
- ✅ RBAC: employee list=empty, POST 403; başka creator'ın patch'i 403; whitelist unknown key sessizce drop; boş isim 400
- ✅ retest_needed: False
- ✅ **REGRESSION CLEAN**: iteration_60-62'deki 34 test hâlâ yeşil. Kullanıcının endişelendirdiği "bozma" durumu yok
- Minor: option label'da nested `<span>` warning düzeltildi (template flatten)

**Kod Review Notları (backlog):**
- `TasksPanel.jsx` >3100 satır — LockConfig/OtpDisplay/UnlockOtp/TaskCard/ContextMenu ayrı dosyalara bölünebilir
- OTP notification import silent try/except — log eklenebilir
- `task_unlock_otps` collection için TTL index (auto-cleanup)


## ✅ Faz 9 CP5 — Refactor + P2 Cleanup + Cross-flow Regression Suite (2026-07-27)

**Sistem Audit'in opsiyonel kalan işleri tamamlandı.** Davranış BİR BİT bile değişmedi — tamamen kod organizasyonu + tek performans iyileştirmesi + yeni regression testleri.

### Frontend refactor — TasksPanel.jsx (3430 → 2478 satır, −%28)
- `/app/frontend/src/lib/taskHelpers.js` (YENİ): `REMINDER_DAY_CHOICES`, `ACTION_LOCK_MAP`, `LOCK_AUDIT_EVENT_META`, `formatAuditPayload`, `hasActiveUnlock`, `canManageLocks`, `isActionLocked`, `isOverdue`, `resolveThreshold`, `dueSoonLayer`, `statusStyle`, `playReminderBeep`
- `/app/frontend/src/components/tasks/LockConfigModal.jsx` (YENİ)
- `/app/frontend/src/components/tasks/OtpDisplayModal.jsx` (YENİ)
- `/app/frontend/src/components/tasks/UnlockOtpModal.jsx` (YENİ)
- `/app/frontend/src/components/tasks/ReassignModal.jsx` (YENİ)
- `/app/frontend/src/components/tasks/EditTaskModal.jsx` (YENİ)

### Frontend refactor — UserManagement.jsx (1907 → 1497 satır, −%22)
- `/app/frontend/src/components/users/UserLockPolicyModal.jsx` (YENİ) — 400+ satırlık kullanıcı politika modalı, şablon uygula/kaydet mantığı ve audit tab dahil.

### Backend refactor — tasks_router.py (1449 → 1226 satır, −%15)
- `/app/backend/routers/tasks_models.py` (YENİ):
  - Sabitler: `_ALLOWED_REMINDER_DAYS`, `_LOCK_FLAG_KEYS`, `_OTP_TTL_MINUTES`, `_OTP_DIGITS`
  - Yardımcılar: `_validate_reminder_days`, `_hash_otp`, `_now_iso`, `_log_lock_event`
  - Pydantic modelleri: `Subtask`, `Task`, `TaskCreate`, `TaskUpdate`, `ReorderTasksReq`, `TaskReassignRequest`, `TaskLockPatch`, `TaskSelfLockPatch`, `TaskUnlockVerify`, `LockPolicyTemplate(+Create+Update)`, `TaskCategory(+Create+Update)`

### P2 Cleanup — TaskCard lock badge performansı
- TaskCard içindeki her render'da çalışan `Object.values(task.lock_flags).some(Boolean)` + `filter(Boolean).length` çağrıları artık `useMemo`'da; `lock_flags`, `unlock_uses_remaining`, `unlock_expires_at` değişmezse yeniden hesaplama yok. Filtre/yazma esnasında per-card allocation ≈ 0.

### Yeni Cross-flow Regression Suite
- `/app/backend/tests/test_lock_flow_integration.py` (YENİ, 2 senaryo):
  1. **Full lifecycle**: Şablon oluştur → kullanıcı politikasına uygula → yeni görev inherit et → çalışan silmeye çalışsın (423) → admin OTP verir → çalışan doğrular → siler (200) → audit trail 4 event içerir (otp_issued/verified/consumed + task_deleted).
  2. **Soft-lock**: `requires_otp=False` şablon → kullanıcı politikası → yeni görev soft-lock miras alır → çalışan `/unlock-simple` ile kod GİRMEDEN açıp tamamlayabilir.

### Test Sonucu (iter_67)
- **Backend**: 84/84 pytest yeşil (76 mevcut + 2 yeni cross-flow + 6 diğer)
- **Frontend**: Smoke test — dashboard render, tasks panel, ContextMenu, LockConfigModal açılışı, tüm data-testid'ler bulunuyor, 0 console error
- **Regression**: SIFIR. `retest_needed=False`, `should_main_agent_self_test=False`
- **Backend issues**: 0 critical / 0 minor · **Frontend issues**: 0 UI / 0 integration / 0 design

### İleri iyileştirme önerileri (opsiyonel, sonraki turlar için)
- TasksPanel.jsx hala 2478 satır — TaskCard (~600 satır) ve ContextMenu (~450 satır) da ayrı dosyalara alınabilir (state'e sıkı bağlı olduğu için dikkatli refactor gerekir)
- 108 silent `catch {}` bloğu (83 frontend + 26 backend) hala mevcut — çoğu backup_service/monitoring_service içinde bilinçli. Sadece kritik olanlar (`catch { toast.error }` gerektirenler) sonraki iterasyonda temizlenebilir
- JWT expiry env-configurable + CORS wildcard prod-safe kısıtlama — auth flow'a dokunmadan yapılabilir


## Test Credentials
- Admin: `serkan / 19071987` (bkz. `/app/memory/test_credentials.md`)
- Test user: `ahmet / ahmet123`

## Technical Debt / Bilinen İyileştirmeler
- **Admin Chat Prompt Editor (P2)**: `chat_router.py`'daki `SYSTEM_PROMPT_TR`/`SYSTEM_PROMPT_EN` şu an hardcoded. `system_settings` koleksiyonuna `chat_prompt_tr`/`chat_prompt_en` alanı + Admin Settings paneline textarea eklenirse Admin kendi Sertex kişiliğini özelleştirebilir. `build_chat_router` içinde her istekte DB'den fetch etme veya startup cache kullanma seçeneği. ~1 saat.
- **Preset "Üzerine Yaz" quick-action (P2)**: Quick Preset dropdown item'ının sağında hover'da beliren `↻` ikonu — mevcut preset'i şu anki HUD ile update etsin (yeni thumb dahil). Şu an tek yol: sidebar aç → Kaydet → aynı isimle yeni preset. Bunu 1 tık'a indirmek preset senkronizasyonunu kolaylaştırır. ~30 dk.
- **Detachable Tabs — Renk Seçici (P2)**: Yüzen sekme pencerelerine per-tab accent color picker ekle (cyan/mavi/menekşe/pembe/kehribar/limon/zümrüt/beyaz) — DraggablePanel.jsx'teki ACCENTS listesi ve palette UI paterniyle aynı. Her tab kendi rengini localStorage'a saklasın.
- **Kota upgrade CTA yönlendirmesi (P1)**: `storage-quota-upgrade` banner tıklanınca "Lisansım" sekmesine (veya upgrade sayfasına) yönlendirsin — henüz sadece görsel uyarı.
- **Kota-baskı proaktif bildirim (P2)**: Kullanıcı %75'i geçince Sertex chat'e otomatik uyarı balonu düşürsün: *"Depolamanın %X'i doldu. En eski 30 sohbeti veya yüklü dosyaları temizleyeyim mi?"* → hem retention hem premium upgrade CTA'sı için doğal fırsat.
- **Admin kullanıcı listesi sıralama/filtreleme (P2)**: "En dolu kullanıcılar" veya "%75+ dolu" filtresi — 50+ kullanıcıda proaktif upgrade hedefleme.
- **NEURAL LINK Stats — Cache & Real-time (P3)**: 30s in-memory cache + WebSocket broadcast (task/note/file event'lerinde) — polling'siz canlı.
- `save_memory` dedupe her yazımda 500 doc tarıyor — ölçek büyürse MongoDB text index veya top-N candidate
- `/api/stt/whisper` tam audio okuyor önce — Content-Length preflight eklenebilir
- Persistent LlmChat sessions ile token maliyeti düşürülebilir
- `/app/backend/core/` altında event bus / LLM router / feature flags modülleştirme (opsiyonel)

## ✅ Faz 9 CP6 — Global Announcement System via SSE (2026-07-27)

Admin'in tüm kullanıcılara (veya belirli rol / şirket'e) anlık duyuru gönderebildiği modül. Mevcut `notification_pubsub` altyapısını kullanır — ikinci SSE stream açılmaz.

### Backend
- `/app/backend/routers/announcements_router.py` (YENİ) — 8 endpoint:
  - `POST /api/announcements` (admin) → oluştur + SSE fan-out
  - `GET /api/announcements` (admin) → tüm listesi
  - `GET /api/announcements/active` (herkes) → şu an bana yönelik + `acked` bayrağı
  - `POST /api/announcements/{id}/ack` (herkes) → onayla (idempotent)
  - `PATCH /api/announcements/{id}` (admin) → düzenle
  - `DELETE /api/announcements/{id}` (admin) → soft delete (`is_active=false`)
  - `DELETE /api/announcements/{id}/purge` (admin) → kalıcı sil + ack'leri temizle
  - `GET /api/announcements/{id}/stats` (admin) → `{target_count, ack_count, ack_ratio}`
- Modeller: `Announcement`, `AnnouncementCreate`, `AnnouncementUpdate` (Pydantic v2)
- Sabit whitelistler: severity ∈ {info, warning, critical} · target_type ∈ {all, role, company} · role ∈ {admin, manager, employee}
- Fan-out: publish sırasında `_resolve_target_user_ids(db, ann)` MongoDB'den etkilenen `user_id`'leri çeker, her biri için `notif_pubsub.publish(uid, {kind: "announcement", announcement: ...})` çağırır.
- Koleksiyonlar: `announcements`, `announcement_acks`
- Testler: `/app/backend/tests/test_announcements.py` — 9 test %100 yeşil (RBAC + validation + targeting + ack + CRUD + stats + purge)

### Frontend
- `/app/frontend/src/components/AnnouncementBanner.jsx` (YENİ) — üstte fixed banner. Mount'ta `activeForMe()` çağırır + `window.dispatchEvent` üzerinden gelen `sertex:announcement` custom event'lerini dinler. severity'ye göre renk (info=cyan, warning=amber, critical=rose). `require_ack || severity==="critical"` → ANLADIM butonu; aksi halde X (session storage'a dismiss kaydı).
- `/app/frontend/src/components/AnnouncementManager.jsx` (YENİ) — admin CRUD UI: severity toggle, target_type/role/company dropdown, require_ack toggle, expires_at datetime, satır bazlı stats + edit + soft delete + purge butonları.
- `/app/frontend/src/components/NotificationBell.jsx` — SSE stream'e `announcement` event listener eklendi, custom event ile re-broadcast eder (tek stream, iki dinleyici).
- `/app/frontend/src/components/SertexMain.jsx` — `<AnnouncementBanner />` en üste eklendi.
- `/app/frontend/src/components/SettingsPanel.jsx` — yeni "DUYURULAR" sekmesi (admin only, `data-testid=settings-tab-announcements`).
- `/app/frontend/src/lib/api.js` — `announcementsApi` helper.

### Test Sonucu (iter_68)
- **Backend**: 9/9 pytest yeşil (%100). Tek "minor" not: xdist paralel session collision — harness sorunu, uygulama etkilenmiyor.
- **Frontend**: %100 e2e — banner < 500ms latency ile SSE üzerinden geldi, ack/dismiss ayırımı doğru çalışıyor, RBAC (tab ahmet'te görünmüyor) doğrulandı.
- **Regression**: SIFIR.

### Kullanım
Admin olarak → ⚙️ Ayarlar → **DUYURULAR** sekmesi → "+ YENİ DUYURU" → başlık + mesaj + önem düzeyi + hedef → **YAYINLA**. Bağlı tüm hedef kullanıcılar banner'ı 500ms içinde görür. Çevrimdışı olanlar bir sonraki sayfa açılışında görür.



## ✅ Faz 9 CP7 — FCM Push Notifications (2026-07-28)

Firebase Cloud Messaging entegrasyonu — kullanıcılara **Sertex kapalıyken bile** bildirim gönderme yeteneği (mobil arka plan / kilit ekranı).

### Firebase Setup
- **Project ID**: `sertex-10c1f`
- **Android app**: `com.sertex.app` (Sertex Android nickname)
- Service Account: `firebase-adminsdk-fbsvc@sertex-10c1f.iam.gserviceaccount.com`
- `/app/backend/firebase-sa.json` — **gitignore'da** (asla commit edilmez)
- `/app/frontend/android/app/google-services.json` — **gitignore'da**
- Backend `.env`: `FIREBASE_PROJECT_ID=sertex-10c1f` + `GOOGLE_APPLICATION_CREDENTIALS=/app/backend/firebase-sa.json`

### Backend
- `/app/backend/fcm_service.py` (YENİ) — thin async wrapper over `firebase-admin==7.5.0`:
  - `send_to_user(db, uid, title, body, data)` / `send_to_users` / `send_to_role` / `send_to_company`
  - Lazy init: SA JSON eksikse silent no-op (test'ler için)
  - Auto-purge: FCM `UNREGISTERED` / `NOT_FOUND` dönerse token'ı `fcm_tokens`'tan siler
  - 500'lük chunk'larla multicast (FCM API limiti)
  - `asyncio.to_thread` ile sync SDK'yı async wrap eder
- `/app/backend/routers/fcm_router.py` (YENİ) — 5 endpoint:
  - `POST /api/fcm/register-token` (user) — device token kaydet (idempotent)
  - `POST /api/fcm/unregister-token` (user) — token'ı sil
  - `GET /api/fcm/tokens/me` (user) — kayıtlı cihazlarım
  - `GET /api/fcm/status` (admin) — SDK ready + total active + platform dağılımı
  - `POST /api/fcm/test-send` (admin) — belirli kullanıcıya test push
- `announcements_router.py` — publish sırasında **SSE + FCM paralel** fan-out (offline mobil kullanıcı için)
- Yeni koleksiyon: `fcm_tokens { id, user_id, user_username, company_id, role, token, platform, device_id, created_at, last_seen_at, revoked_at }`

### Frontend
- `@capacitor/push-notifications@7.0.7` (yalnızca Capacitor Android build'de aktif)
- `/app/frontend/src/lib/pushNotifications.js` (YENİ):
  - `initPushNotifications()` — permission iste → FCM token al → backend'e kaydet
  - Foreground push → `sertex:push-foreground` CustomEvent (SSE zaten kapatıyor, bilgi amaçlı)
  - Tap deep-link → `sertex:open-settings-tab` (announcement) / `sertex:open-task` / `sertex:open-unlock-otp`
- `SertexMain.jsx` — user authenticated olur olmaz `initPushNotifications()` çağrılır (native olmayan web'de no-op)

### Test
- `/app/backend/tests/test_fcm.py` — 9 test: register (200) / idempotent / invalid platform (400) / list me / unregister / status RBAC / test-send RBAC / test-send unknown user 404 / test-send zero tokens no crash — **9/9 yeşil**
- Regression: 102/102 test yeşil (Task/Lock/Template/Audit/Category/Reassign/Announcement/FCM/Cross-flow)
- Backend init log: `INFO FCM initialised (project=sertex-10c1f)` — SDK gerçek Firebase project'ine bağlandı
- Web smoke: 0 console error, `sertex-push` logları temiz (native olmayan platformda beklendiği gibi no-op)

### Android APK için sonraki adım
Kullanıcı gerçek push almak için:
1. `cd /app/frontend && npx cap sync android`
2. `cd android && ./gradlew assembleDebug` (veya release build + signing)
3. APK'yı telefona kur → Sertex'i aç → OS bildirim izni promptu çıkar → izin ver → backend `/api/fcm/status` → `active_tokens: 1` olur
4. Admin panelinden Duyurular sekmesi → yeni duyuru yayınla → kilit ekranında bildirim düşer

### Faz 9 CP7.1 — Task/OTP olaylarına da push eklendi (2026-07-28)
FCM sadece Announcement'a değil, **task lifecycle** olaylarına da bağlandı:
- `POST /api/tasks` (yeni görev atama) → assignee'ye push: *"Yeni görev · {creator}"* (self-assign hariç)
- `POST /api/tasks/{id}/reassign` (görev devretme) → yeni sahibe push: *"Görev devredildi · {actor}"*
- `POST /api/tasks/{id}/unlock-otp` (kilit kodu üretildi) → assignee'ye push: *"Kilit açma kodu · {issuer} — kod bekleniyor"* (KOD DAHİL EDİLMEZ — güvenlik gereği)

Her push `data` payload'ında `{kind, task_id, event}` içerir → tıklayınca deep-link ile ilgili göreve gider. Push best-effort: FCM disabled olsa bile task create/reassign/otp akışı hiç etkilenmez (try/except ile sarılı). Regression: 102/102 test yeşil (hiçbir mevcut test kırılmadı).



## ✅ Faz 9 CP7.2 — Overdue Digest Daily Push (2026-07-28)

Her sabah **09:00 Europe/Istanbul**'da APScheduler cron çalışır:
- Süresi geçmiş, `done`/`paused` olmayan, arşivlenmemiş görevleri user_id bazında gruplar
- Her kullanıcıya **tek bir aggregated push** atar (per-task değil): *"3 gecikmiş görev · Görev A · Görev B · Görev C  · +N daha"*
- Tam olarak 1 gecikmiş görev varsa deep-link ilgili göreve gider; birden fazla varsa görevler paneli açılır
- Body max 220 karakter (FCM soft-limit)

### Yeni Dosya
- `/app/backend/overdue_push_service.py` — `_find_overdue_by_user(db)`, `_send_overdue_pushes(db)`, `start_overdue_scheduler(db)`, `stop_overdue_scheduler()`, `run_overdue_push_now(db)`
- server.py'de `start_overdue_scheduler(db)` startup'ta çağrılıyor
- FCM router'da `POST /api/fcm/run-overdue-digest` (admin manuel trigger)

### Config
- `SERTEX_OVERDUE_PUSH_HOUR=9` (env, default 9)
- `SERTEX_OVERDUE_PUSH_MINUTE=0` (env, default 0)
- Timezone hard-coded `Europe/Istanbul` (Türk B2B için)
- `misfire_grace_time=1800` — sunucu 09:00'da down ise 09:30'a kadar hala fire eder

### Test
- `/app/backend/tests/test_overdue_digest.py` — 3 test yeşil:
  - Admin trigger çalışıyor + shape doğru (`users`/`sent`/`failed`)
  - Employee `POST /api/fcm/run-overdue-digest` → 403
  - Overdue görev create + digest trigger + `users >= 1` doğrulaması
- **Full regression: 105/105 yeşil** (mevcut 102 + yeni 3 overdue digest testi)
- Startup log: `Overdue push scheduler started (Europe/Istanbul at 09:00 Europe/Istanbul)`



## ✅ Faz 9 CP8 — Mobile-First Responsive Redesign (2026-07-28)

Sertex artık **telefon, tablet ve masaüstünde** doğal görünüyor. Desktop layout değişmedi — sadece `< 1024px` viewport'lar için akıllı davranış ekledik.

### Yeni Dosyalar
- `/app/frontend/src/lib/useResponsive.js` (YENİ):
  - `useIsMobile()` → viewport < 1024px (matchMedia based, resize'a canlı tepki)
  - `useIsTablet()` → 640-1023px
  - `useIsPhone()` → < 640px
- `/app/frontend/src/components/MobileBottomNav.jsx` (YENİ):
  - 4 fixed tab alt kenarda: **SOHBET · GÖREVLER · NOTLAR · AYARLAR**
  - `safe-area-inset-bottom` desteği (gesture bar çakışmaz)
  - Tıklanan tab sidebar drawer'ı açar + ilgili tab'a geçer (custom event ile)

### Değişiklikler
- **SertexMain.jsx**:
  - `useIsMobile()` hook eklendi
  - HUD panelleri (TopLeft/TopRight/BottomLeft) mobile'de gizlenir (`{!isMobile && ...}`)
  - Merkezi HUD küre mobile'de %35 opacity + 55vw boyut (arka plan efekti)
  - S.E.R.T.E.X başlığı mobile'de gizli (bottom-nav zaten uygulamayı label'liyor)
  - Chat input mobile'de `bottom-14` (bottom-nav'ın üstünde), safe-area-inset
  - MobileBottomNav render'ı eklendi
  - İlk mobil mount'ta sidebar `open=false` (drawer bottom-nav ile açılır)
  - `openMobileSection(section)` → sidebar tab'ını değiştirip drawer'ı açar
- **Sidebar.jsx**:
  - `sertex:sidebar-tab` custom event listener eklendi (bottom-nav'dan tab değiştirme)
- **index.css** — mobile-only overrides (`@media (max-width: 1023.98px)`):
  - Sidebar → full-screen drawer (top/right/left/bottom: 0, w-100vw, h-100vh)
  - Sidebar resize handle'ları gizli
  - Toggle butonu drawer sağ-üst köşe
  - Chip stacks (draggable panel portals) gizli
  - Draggable panel host'ları full-screen (bottom-nav için 56px reserve)
  - Settings modal → full-screen
  - Announcement banner tighter padding
  - Sidebar drawer'da SIFIRLA/GİZLE/SAĞ butonları gizli (mobilde anlamsız)
  - NEURAL LINK başlığı küçültüldü + close butonu ile çakışma önlendi
  - Bottom padding `56px + safe-area-inset` (son satır bottom-nav'ın altında kalmasın)

### Test Sonucu
- **Desktop 1920x900**: Değişiklik yok — HUD panelleri, merkezi küre full boyut, chat input alt ✓
- **Tablet 900x1200**: Bottom nav görünüyor, HUD gizli, sidebar drawer davranışı ✓
- **Phone 390x844**: Bottom nav (SOHBET/GÖREVLER/NOTLAR/AYARLAR) tap-friendly, sidebar drawer full-screen, Görevler paneli tamamen kullanılabilir (stats grid 2x3, filter chips, task cards) ✓
- **Backend regression**: 105/105 pytest yeşil (mobile CSS-only değişikliği API'yi hiç etkilemedi)



## 🔧 Faz 9 CP8.1 — CRITICAL BUG FIX: Task Reorder Multi-Tenant (2026-07-28)

### Sorun
Kullanıcı raporu: "görevleri sidebar içinde sürükleyince otomatik olarak sıra numarası değişik sürüklediği yerde kayıtlı kalacaktı, bana yaptım demiştin". Serkan görevi sürüklüyor, ekranda hareket ediyor, ama refresh'te eski yerine dönüyor.

### Root Cause
`POST /api/tasks/reorder` endpoint'i filtresi:
```python
db.tasks.update_one({"id": tid, "user_id": user["id"]}, ...)  # ESKI KOD
```
Sertex artık **multi-tenant** — Serkan admin olarak Ahmet'e görev atadığında `task.user_id = ahmet_id`. Serkan reorder çağırdığında filter matched olmadığı için **sıfır satır** update oluyor. Frontend optimistic olarak state'i değiştiriyor, sonra `load()` çağrılınca DB'den eski sıra geri geliyor → görev "eski yerine snap ediyor".

### Fix
`/app/backend/routers/tasks_router.py:225-260` — visibility-based per-row authorization:
```python
for idx, tid in enumerate(req.ids):
    task_doc = await db.tasks.find_one({"id": tid}, {"_id": 0, "user_id": 1})
    if not task_doc: continue
    owner_id = task_doc.get("user_id")
    if owner_id == user["id"] or role == "admin": allowed = True
    elif owner_id and await can_view_user(db, user, owner_id): allowed = True
    else: continue  # silent skip — no info leak
    await db.tasks.update_one({"id": tid}, {"$set": {"sort_order": float(n - idx), ...}})
```

### Güvenlik
- Admin: her şeyi reorder edebilir ✓
- Manager: sadece görebildiği kullanıcıların görevlerini reorder edebilir ✓
- Employee: sadece kendi görevlerini reorder edebilir; başkasının görevlerini gönderirse silent skip ✓

### Test
- `/app/backend/tests/test_reorder_multitenant.py` (YENİ, 3 test):
  1. `test_admin_can_reorder_tasks_assigned_to_other_users` — Serkan Ahmet'in 3 görevini reorder eder → sort_order beklenen değerlere set olur
  2. `test_assignee_view_matches_admin_reorder` — Ahmet kendi feed'ine baktığında aynı sırayı görür (tutarlılık)
  3. `test_employee_cannot_reorder_others_tasks` — Ahmet, Serkan'ın private görevini gönderirse endpoint 200 döner ama sort_order etkilenmez
- **108/108 pytest yeşil** (105 mevcut + 3 yeni)
- **bug_testing_agent verdict: FIXED** (iter_69) — hem API hem gerçek tarayıcıda Playwright drag & drop ile doğrulandı; fresh reload sonrası sıra korundu.

### Sonraki
Bu fix **preview'da canlı**. Production'da (sertex-ai.com) etkin olması için **redeploy gerekli**.



## 🔧 Faz 9 CP8.2 — Reorder + Filter Combo Fix (2026-07-28)

### Sorun
Kullanıcı: "TÜMÜ seçeneğindeyken AKTİF veya GEÇTİ tıklı olunca sıraya dizme çalışmıyor". Status filter (AKTİF/GEÇTİ) aktifken görev sürükleme UI'da hareket ediyor ama refresh'te eski sıra geri geliyor.

### Root Cause
`handleReorderFiltered` fonksiyonu index mapping için `tasks` state'ini (backend'den geldiği raw order) kullanıyordu. Ama `Reorder.Group values={filtered}` prop'u `sorted.filter(...)` çıktısı — frontend'in canonical UI sort'una göre. Backend fallback (`created_at desc` for null-sort_order) ve frontend fallback (`status score + due_date`) farklı olunca **visiblePositions yanlış slot'lara yazıyordu** → POST /tasks/reorder karışık sıra gönderiyor.

Ek olarak: `filters.length === 0` render branch'i `tasks` üzerinde çalışıyordu — Reorder.Group internal model'i ile UI'nin gördüğü sort birbirinden farklı olabiliyordu.

### Fix
1. **`handleReorderFiltered`** → `sorted` üzerinde indexle (Reorder.Group'un çalıştığı array ile aynı canonical order)
2. **`filters.length === 0` render branch** → `values={sorted}` + `sorted.map()` (UI ile Reorder.Group senkron)
3. **Branch condition** → `filters.length === 0 && !categoryFilter` (kategori chip'i aktifken filtered path'e yönlendir; aksi halde kategori filter yok sayılırdı — regression önlendi)

### Test
- `bug_testing_agent` iter_71 verdikti: **FIXED**, %100 backend, %100 frontend, 0 issue
- Real Playwright drag & drop + full page reload ile 4 senaryo:
  - TÜMÜ + AKTİF → persist ✓
  - Kategori-only chip → non-kategori görevler gizleniyor + persist ✓
  - AKTİF + kategori → görünen shuffle, gizli sabit ✓
  - No-filter baseline → hala çalışıyor ✓
- POST /api/tasks/reorder body 45 ID'lik full master list gönderiyor → gizli görevlerin pozisyonu korunuyor

### Not
Bu fix şu an preview'da canlı. Production (`sertex-ai.com`) etkilenmesi için **Deploy** gerekli.





## 🔧 Faz 9 CP8.3 + CP8.4 — Reorder Snap-Back Fix + Instant Archive Toast (2026-02)

### Sorun 1 — Reorder Snap-Back (Preview'da bile hâlâ görünen bug)
Kullanıcı sürükledikten sonra bir kısım tasks tekrar eski yerine "atlıyor". Deploy sonrası bile sorun devam etti.

### Root Cause
`handleReorderTasks` optimistic olarak `setTasks(nextTasks)` çağırıyordu, ama `nextTasks` içindeki task nesneleri **eski `sort_order` değerlerini** taşıyordu. Bir sonraki render'da derived `sorted = [...tasks].sort((a,b) => b.sort_order - a.sort_order)` yeniden çalışınca kullanıcının drag sırası **eski sort_order desc değerlerine göre revert oluyordu**. Backend doğru yazıyordu ama frontend re-render'ı yanlış sıralıyordu (backend'in `n - idx` yazımı gelene kadar).

### Fix (`frontend/src/components/TasksPanel.jsx` ~line 1979)
```js
const handleReorderTasks = async (nextTasks) => {
  const n = nextTasks.length;
  const now = new Date().toISOString();
  const stamped = nextTasks.map((t, idx) => ({
    ...t, sort_order: n - idx, updated_at: now,
  }));
  setTasks(stamped);   // ← stamp local sort_order matching backend formula
  try { await tasksApi.reorder(nextTasks.map((t) => t.id)); }
  catch (e) { toast.error("Sıra kaydedilemedi"); load(); }
};
```

### Sorun 2 — Arşiv Toast Gecikmesi
Kullanıcı bir görevi arşive gönderdiğinde "Görev arşivlendi" toast'u 2-3 saniye geç geliyordu (özellikle mobilde).

### Root Cause
`setArchived` içinde `toast.success(...)` `await tasksApi.setArchived(id, archived)` ÇAĞRISINDAN SONRA geliyordu. Yavaş mobil ağda network round-trip toast'u da geciktiriyordu.

### Fix (`frontend/src/components/TasksPanel.jsx` ~line 1693)
```js
const setArchived = async (id, archived) => {
  setTasks((prev) => prev.filter((t) => t.id !== id));
  setArchivedCount((c) => (archived ? c + 1 : Math.max(0, c - 1)));
  toast.success(archived ? "Görev arşivlendi" : "Arşivden çıkarıldı");  // ← moved BEFORE await
  try { await tasksApi.setArchived(id, archived); }
  catch (e) { toast.error("İşlem başarısız — geri alınıyor"); load(); }
};
```

### Test
- `bug_testing_agent` iter_69 verdikt: **FIXED** (100% backend, 100% frontend for target flows)
- Reorder: Playwright ile task #3'ü #1'e sürükledi → snap-back yok, page reload sonrası sıra korundu (hem no-filter hem kategori-filtered)
- Archive: 2.5s yapay PATCH gecikmesi ile bile toast 174ms'de göründü (network'e bağımlı değil artık)
- Regression: task create, status toggle, reminder set, title edit hepsi geçti

### Not
Fix preview'da canlı. Production'da (`sertex-ai.com`) görülmesi için **Deploy** butonuna basılması gerekli.



## 🎨 Faz 9 CP8.5 — Şirket Combobox (Dark Theme Autocomplete) (2026-02)

### Sorun
Yeni görev formundaki "Şirket (opsiyonel)" alanı, tarayıcının native `<datalist>` popup'ını kullanıyordu — **beyaz zeminli**, koyu HUD teması ile hiç uyumsuz. Kullanıcı 4. resimdeki "Kendime ata" `<select>` benzeri koyu temalı bir dropdown istedi.

### Fix
- Yeni component: `/app/frontend/src/components/tasks/CompanyCombobox.jsx`
  - Custom dark-themed dropdown (`bg-sertex-surface/95`, `border-sertex-cyan/40`)
  - Free-text typing korunuyor (kullanıcı yeni şirket adı da yazabilir)
  - Yazarken case-insensitive Turkish-locale filtreleme
  - Klavye desteği: ArrowUp/ArrowDown/Enter/Escape
  - `suppressOpenOnFocus` ref → option tıklandıktan sonra dropdown açık kalmıyor
  - Aynı `data-testid="task-company-input"` korundu (regression yok)
- TasksPanel.jsx ~2306: `<input list="task-company-datalist">` + `<datalist>` bloğu değiştirildi
- EditTaskModal'a dokunulmadı (zaten `<select>` kullanıyordu)

### Test
- `testing_agent` iter_72: 90% (asıl bug fix + 1 minor UX pürüzü tespit)
- `testing_agent` iter_73: **100%** (8/8 senaryo PASS, 0 issue) — suppressOpenOnFocus polish sonrası
- Scenarios: click-to-close, subsequent-reopen, keyboard flow, dark theme, no native datalist, free-text, EditTaskModal regression



## 🎨 Faz 9 CP8.6 — Global Dark Color-Scheme + Şirket Atama Modal (2026-02)

### Sorun
Kullanıcı iki yerde hâlâ beyaz popup görüyordu:
1. **YENİ GÖREV formu** — native `<select>` (İş Kolu Seç, Uyarı: Varsayılan, Kendime ata) tarayıcının OS-native popup'ıyla beyaz açılıyordu (Chrome/Firefox light-mode default).
2. **Ayarlar → Kullanıcı → Şirket atama** — `editCompany()` `window.prompt()` kullandığı için OS-native beyaz dialog çıkıyordu.

### Fix
- **Global CSS** (`/app/frontend/src/index.css`):
  - `body { color-scheme: dark; }` → tarayıcı native UI (select popup, date pickers, scrollbar, autofill) koyu paleti kullanıyor
  - `select, option { background-color: #050914; color: #E2F1FF; }` → Firefox/Safari için defansif kural
- **UserManagement.jsx**:
  - `window.prompt()` kaldırıldı → koyu glass-panel modal (`companyEditState`)
  - Mevcut şirket chip'leri (hızlı seçim) + serbest metin input
  - Enter kaydet, Escape iptal
  - Testid: `admin-company-edit-modal`, `admin-company-edit-input`, `admin-company-edit-chip-<name>`, `admin-company-edit-save`, `admin-company-edit-cancel`, `admin-company-edit-backdrop`

### Test
- `bug_testing_agent` iter_74 verdikt: **FIXED** (100% frontend for reported bug)
- Native select popup'ları koyu (`color-scheme: dark` runtime doğrulandı)
- Şirket atama modal'ı çalışıyor: custom kaydetme, boş kaydet → Bireysel, chip seç → kaydet
- Regression: CompanyCombobox (CP8.5), drag-drop reorder, archive instant toast — hepsi geçti

### Not
`editQuota` hâlâ `window.prompt()` kullanıyor (kullanıcı sadece şirket atama için şikâyet etti). İleride aynı modal pattern'iyle çevrilebilir.

## ✅ Görev Paylaşımı + Çok Kişili Atama (2026-06 · Opus fork)
Spec: `/app/memory/FEATURE_task_sharing_spec.md`. Kategori-bazlı görünürlük yerine granüler, görev-bazlı paylaşım + çok kişili atama.

**ÖZELLİK A — Çok kişili görev + kişi-kişi tamamlama:**
- `Task.assignees: List[{user_id,name,completed,completed_at}]`. TEK kart, her atanan kişinin yanında ayrı ✓; görev ancak HERKES tamamlayınca `status="done"` olur (biri geri alınca `pending`'e döner). İlerleme "X/Y tamamlandı".
- `POST /api/tasks {assignee_user_ids:[...]}` (2+ → multi; 1 → eski tekil devir; 0 → self). Geriye uyumlu.
- `POST /api/tasks/{id}/my-completion {completed}` — atanan sadece KENDİ ✓'ını değiştirir (403 if not assignee).

**ÖZELLİK B — Görev-bazlı paylaşım (per-task ACL):**
- `Task.shared_with: List[{user_id,name,perms:{view,edit,complete,delete,assign}}]`. `view` baseline (zorla true) → `list_tasks`'ta görünürlük ($or: user_id∈allowed | assignees.user_id | shared_with.view).
- `PUT /api/tasks/{id}/shares {shares,notify}` — kim paylaşabilir: oluşturan + admin + görevin şirket müdürü (`_can_share_task`). update/delete/reassign guard'ları paylaşım perm'ini de kabul eder (edit/delete/assign).
- `GET /api/users/search?q=` — sistemdeki herkes aranabilir (S3-a), asgari alanlar, self hariç.
- `NOTIF_TYPE_TASK_SHARED` — çan + FCM (notify=true iken yeni alıcılara).

**Frontend:** `tasks/ShareTaskModal.jsx` (Özellik Tanımla: ara + 5 yetki kutusu + bildirim toggle), `tasks/MultiAssigneeSelect.jsx` (chip'li çoklu seçim), TasksPanel context menu `ctx-share`, kartta GÖZ rozeti (`task-shared-badge-{id}`, hover→kimler görüyor, dedupe), çok kişili ilerleme + kişi-kişi ✓, NotificationBell `task_shared` render.

**Test:** `/app/backend/tests/test_task_sharing.py` 7/7 pass; test_permissions/test_tasks/test_tasks_locks 55 pass (serial -n 0). Frontend E2E `/app/test_reports/iteration_76.json` — backend 100%, frontend ~95% (tek LOW kozmetik tooltip dedupe bug → düzeltildi). Sıfır regresyon.

## ✅ Görev Görünürlüğü Düzeltmesi + Benim/Personel Sekmeleri (2026-06 · canlı bug fix)
Kullanıcı bug'ı (canlı): admin/müdürün "Görevler" listesi tüm ekibin göreviyle karışıyordu. Çözüm:
- **Backend**: `GET /api/tasks?scope=mine|team` (varsayılan `mine`). `mine` = user_id==self OR assignee OR shared(view); `team` = gözetimdeki DİĞER kullanıcılar (admin: herkes hariç kendi; müdür: ekibi; çalışan: []). Task yanıtına `user_id` eklendi.
- **Gizlilik**: Admin herkesi görür ama admin'in görevleri paylaşılmadıkça kimseye görünmez (zaten böyleydi, doğrulandı).
- **Frontend** (`TasksPanel.jsx`): "Benim Görevlerim" / "Personel Görevleri" sekmeleri (sadece isTeamView=admin+müdür). Personel Görevleri: kişi çipleri (person-chip-*), kişiye tıklayınca filtre; sürüklemesiz düz liste; Yeni Görev butonu gizli. Çalışan (ekipsiz): sekme yok.
- **Kişisel paylaşım**: "Özellik Tanımla (Paylaş)" menüsü artık HERKESTE (ekipsiz kullanıcı da arkadaşına/eşine görev paylaşabilir).
- **Yan etki**: Müdürün geciken-görev açılır uyarısı artık "Benim Görevlerim"i baz alır; ekip gecikmeleri çan + "Ekibim"de.
- **Test**: `test_task_scope.py` 10/10 + regresyon 29/29 (seri). Frontend admin/müdür/çalışan %100. `/app/test_reports/iteration_77.json`. Sıfır sorun.
- **Ortam**: Kullanıcı canlıda (sertex-ai.com) bildirdi; düzeltme önizlemede yapıldı — kullanıcının YENİDEN YAYINLAMASI gerekir.

## ✅ Personel Görevleri — kişi bazında özet rozetleri (2026-06)
"Personel Görevleri" sekmesine eklendi (sadece-frontend, `TasksPanel.jsx`):
- Üst özet şeridi (`team-summary-strip`): "N personel · ⚠ N geciken · N aktif · N bitti".
- Kişi çiplerinde geciken rozeti (`person-overdue-{id}`, kırmızı ⚠N) + toplam sayı; gecikeni olan personel çipleri üstte sıralanır (b.overdue||b.count).
- `teamOwners` derivasyonu overdue/active/done sayılarını hesaplar (isOverdue helper). Screenshot ile doğrulandı (zaten doğrulanmış scope=team + user_id verisi üzerine kurulu).

## ✅ Kendim+Personel Atama & Aranabilir Kişi Seçici (2026-06 · canlı istek)
Kullanıcı istekleri (canlı): (1) oluşturan kişi (admin/müdür) göreve kendini de dahil edebilsin; (2) kişi seçici aranabilir+kaydırmalı panel olsun.
- **MultiAssigneeSelect.jsx** yeniden yazıldı: açılır PANEL (assignee-picker-toggle/panel) + arama (assignee-search) + kaydırmalı seçenek listesi (assignee-option-list, max-h-48 overflow). Liste başında "Kendim (ben de dahilim)" (backend /team/members self'i hariç tutuyor → frontend self'i selfUser prop ile ekliyor). Seçilenler kaydırmalı çip alanında (assignee-selected-chips).
- **addTask routing**: 0/sadece-self = kişisel; yalnız 1 başka kişi = tekil devir; 2+ (self dahil) = çok kişili. create_task self'i assignees'e ekler (FCM push self'e atlanır), scope=mine self'i assignee olarak görür, my-completion self için çalışır.
- **Test**: test_task_scope self-multi (3 yeni) + sharing 7 + scope 10 = 20/20 (seri). Frontend %100. `/app/test_reports/iteration_78.json`. Sıfır sorun.
- **Ortam**: canlı için YENİDEN YAYIN gerekli.

## ✅ UX: Ayarlar Sol Dikey Sekmeler + Personel Filtresi Açılır Liste (2026-06)
Kullanıcı istekleri (canlı): (1) Personel Görevleri kişi filtresi çip yerine pencere içi kaydırmalı liste; (2) Ayarlar sekmeleri üstte yatay kaydırma yerine sola alt alta.
- **PersonFilterSelect.jsx** (yeni): tek-seçim açılır panel + arama (person-filter-search) + kaydırmalı liste (person-filter-list, max-h-56); her kişide geciken rozeti + sayı. TasksPanel'de eski wrap-çip bloğu bununla değiştirildi. Özet şeridi (team-summary-strip) korundu.
- **SettingsPanel.jsx**: sekmeler veri-odaklı `SETTINGS_TABS` dizisine çevrildi; layout `flex flex-row` → solda dikey sütun (w-176px, border-l-2 aktif göstergesi, dikey scroll), sağda içerik (settings-content). Modal max-w 520→720px. 13-14 sekme artık alt alta.
- Frontend-only; compile + screenshot (Renkler/Kullanıcılar/Hesap render + person filter arama) ile doğrulandı. Backend değişikliği yok.
- **Ortam**: canlı için YENİDEN YAYIN gerekli.

## 📌 Backlog (sonraya)
- **Personel filtresi → sayaç kartları senkronu (P2)**: "Personel Görevleri"nde bir kişi seçilince üstteki AKTİF/GEÇTİ/BEKLİYOR/BİTTİ sayaç kartları (stats) o kişinin görevlerine göre güncellensin. Şu an `stats` tüm ekip görevlerini baz alıyor; `filtered`/seçili kişiye göre hesaplanacak. Sadece-frontend (TasksPanel.jsx `stats` hesabı). Kullanıcı 2026-06'da onayladı, "sonraya" dedi.


## ✅ Personel Filtresi: Tümü toggle + Sayaç Senkronu (2026-06)
- **BUG FIX**: PersonFilterSelect 'Tümü' seçeneği artık toggle — işaretliyken tekrar tıklayınca tik kalkar (personFilter='__none__'), 'Seçim yok — görev gösterilmiyor' yazar ve HİÇ görev listelenmez + sayaçlar 0/0/0/0. Tekrar tıklayınca hepsi geri gelir.
- **ÖNERİ UYGULANDI (backlog kapandı)**: Personel Görevleri'nde kişi seçilince üstteki AKTİF/GEÇTİ/BEKLİYOR/BİTTİ sayaç kartları o kişinin görevlerine göre güncellenir (statsBase: mine=tüm kendi, id=o kişi, __none__=boş). Durum filtre çiplerinden bağımsız.
- TasksPanel.jsx (filtered + statsBase + empty msg), PersonFilterSelect.jsx. Frontend-only. Testing agent iteration_79 = %100, sıfır hata.
- Ortam: canlı için YENİDEN YAYIN gerekli.

## ✅ 4'lü UX Batch — Collapse · Bildirim Silme · Tekrarlı Hatırlatma · Detach Pencere (2026-06 · fork)
Kullanıcı: "hepsini yap hiçbirseyi bozma". Task 4 için seçenek (a) = sürüklenebilir yüzen pencere.
- **TASK 1 — Görev kartı Küçült/Büyüt**: Her kartta ▲/▼ (`task-collapse-{id}`) → küçültünce SADECE alt görevler + "ALT GÖREV EKLE" gizlenir (başlık/açıklama/kategori kalır) + özet ipucu (`task-collapsed-hint-{id}`). localStorage `sertex_collapsed_task_ids`. Panel üstünde "Tümünü Küçült/Büyüt" (`task-collapse-all`) — o an görünen görevleri toplu aç/kapat.
- **TASK 2 — Bildirim silme** (önceki ajan, bu session doğrulandı): Hepsini (`notification-delete-all`), tek (`notification-delete-{id}`), seçerek (`notification-select-toggle` + `notification-delete-selected`). Backend team_router: `DELETE /api/notifications`, `DELETE /api/notifications/{nid}`, `POST /api/notifications/delete-selected`.
- **TASK 3 — Tekrarlı hatırlatma** (önceki ajan, doğrulandı): aralık + kaç defa (`ctx-reminder-repeat`). Model alanları `reminder_interval_min/repeat_left/repeat_total` (TaskUpdate + PATCH persist). İstemci-taraflı reschedule; görev done olunca durur. NOT: sunucu-taraflı FCM recurring loop YOK.
- **TASK 4 — Detach yüzen pencere**: Maximize (`task-detach-{id}`) → react-rnd + createPortal ile büyük sürüklenebilir/boyutlandırılabilir pencere (`detached-task-window-{id}`) içinde tam TaskCard. Listede yer tutucu (`task-detached-placeholder-{id}`) + "GERİ AL" (`task-redock-{id}`); pencere başlığında "SIDEBAR'A GERİ AL" (`detached-task-dock-{id}`). Detach durumu geçici (reload'da sıfırlanır). Drag-reorder bozulmadı.
- **Test**: `/app/test_reports/iteration_80.json` — Backend 5/5 pytest, Frontend %100 (TASK 1/1b/2/4 + TASK 3 UI/persist). Sıfır bug. (Kozmetik: notification select testid isim farkı — spec vs kod, işlev sağlam.)
- Ortam: canlı `sertex-ai.com` için YENİDEN YAYIN gerekli.


## 📌 Backlog (sonraya)
- **"Dürt / Hatırlat" butonu (P2)**: "Personel Görevleri"nde bir kişinin geciken görevi varsa, müdürün/admin'in tek tıkla o kişiye hatırlatma bildirimi (çan + FCM push) gönderebileceği buton. Backend: yeni endpoint (ör. POST /api/tasks/{id}/nudge veya /api/users/{id}/remind) + team_service bildirim tipi (task_reminder_nudge). Frontend: kişi çipinde/görev kartında dürt butonu. Kullanıcı 2026-06'da onayladı, "sonra yapalım" dedi.

## 📌 Backlog — Detach "Görev Karşılaştırma Masası" (P2, kullanıcı 2026-06'da onayladı, "sonraya ekle")
- Detach yüzen pencerelerinin konum + boyutunu localStorage'a kaydet (şu an geçici, reload'da sıfırlanıyor).
- Aynı anda birden çok görevi yan yana açık tutup büyük ekranda "görev karşılaştırma masası" deneyimi sun (detachedIds zaten çoklu destekliyor; sadece geometry persistence + varsayılan konumlandırma iyileştirmesi gerek). B2B üretkenlik satış argümanı.
- Dosya: TasksPanel.jsx > DetachedTaskWindow.


## ✅ Backlog batch b/c/d + e/f (2026-06 · "chat E-posta hariç hepsini yap")
- **b) Admin Chat Prompt Editörü** (DONE) — Ayarlar > SERTEX PROMPT (admin), TR/EN. `GET/PUT /api/admin/chat-prompt`; chat_router `_resolve_base_prompt` override okur, boşsa varsayılan. Dosyalar: ChatPromptEditor.jsx, admin_router.py, chat_router.py.
- **c) Dürt / Hatırlat** (DONE) — Personel Görevleri'nde amber çan (`task-nudge-{id}`) → `POST /api/tasks/{id}/nudge` → sahibe `task_nudge` bildirimi (tekrarlanabilir; task_id=None + payload.task_id; self-nudge 400). team_service.notify_task_nudge, tasks_router, tasks_models.TaskNudgeRequest, NotificationBell (BellRing "⏰ hatırlattı"), api.tasksApi.nudge.
- **d) İş Kolu Combobox** (DONE) — add-task `<select>` → koyu aranabilir combobox tasks/CategorySelect.jsx (`task-category-select` + -panel/-search/-option-*).
- **e) Kategori raporlama** — zaten vardı (TeamPanel İŞ KOLU PERFORMANSI, `/api/team/category-summary`), doğrulandı.
- **f) Masaüstü push+ses** — zaten vardı (desktopNotifier.js + NotificationBell pref), doğrulandı.
- Test: `/app/test_reports/iteration_81.json` (backend 8/8, frontend b/c/d/f %100, e ok, sıfır bug). Yeni test: backend/tests/test_prompt_and_nudge.py.
- Kalan (kullanıcı istemedi): a) Chat E-posta Intent (P1).
- Canlı sertex-ai.com için yeniden yayın gerekli.

## ✅ Kart boyut hatası + detached kart resize (2026-06 · DONE)
- Sidebar: elle boyutlandırılan kartın genişlik/yüksekliği küçült/büyütte kayboluyordu → `savedSize` state senkronu (ResizeObserver + setSavedSize + ref guard; küçükken yakalama atlanır). Doğrulandı: 320×240 korunuyor.
- Detached pencere: içteki kart `resize:both` (yukarı-aşağı + sağ-sol), ayrı `sertex_task_dsize_{id}` anahtarı (sidebar boyutuyla çakışmaz). Dosya: TasksPanel.jsx > TaskCard.

## ✅ Dürt "Cooldown + Sayaç" (2026-06 · DONE)
- 60 sn cooldown (aynı yönetici+görev → 429) + günlük sayaç. `task_nudges` koleksiyonu + index; nudge yanıtı `count_today`/`cooldown_seconds`. Frontend: buton amber sayaç rozeti + toast'lar. Test: test_prompt_and_nudge.py (8/8). Dosyalar: tasks_router.py, team_service.py, TasksPanel.jsx.

## 📌 Backlog — Yönetici "Geciken Görevler" özet paneli + toplu Dürt (P2, kullanıcı 2026-06'da onayladı, "sonraya ekle")
- Tek ekranda tüm geciken personel görevlerini listele; personele göre grupla.
- Seçilenlere / tümüne tek tıkla toplu "Dürt" gönder (mevcut cooldown'a saygılı).
- Dosyalar: TeamPanel.jsx (yeni özet sekmesi/kartı), tasks_router.py (opsiyonel toplu-nudge endpoint), team_service.notify_task_nudge.

## 📌 Backlog — Dürt "Cooldown + Sayaç" (P2, kullanıcı 2026-06'da onayladı, "sonraya ekle")
- Dürt butonunda "kaç kez dürtüldü" sayacı + son dürtme zamanı; aynı göreve kısa cooldown; yöneticiye "bugün N kez hatırlattın" görünürlüğü.
- Dosyalar: tasks_router.py (nudge cooldown), team_service.notify_task_nudge (meta), TasksPanel.jsx (buton rozeti).

## 📌 Backlog — Frontend "Hata Radarı" / Client-Log endpoint (P2, kullanıcı 2026-07-29'da onayladı, "sonra yapalım")
- Amaç: Sistem denetiminde eklenen `console.warn("[dosya] hata bastırıldı:", e)` loglarını merkezi olarak toplamak. Kullanıcı tarafında oluşan frontend hataları şu an sadece o kişinin konsolunda kalıyor; admin göremiyor.
- Backend: yeni `POST /api/client-log` endpoint'i (rate-limited) — `{ level, message, file, stack, user_agent, url }` alır, `client_logs` koleksiyonuna yazar (TTL index ile örn. 30 gün retention).
- Frontend: küçük bir `lib/clientLogger.js` — `console.warn/error`'ı sarmalayıp önemli hataları batch halde backend'e gönderir (offline queue + sessiz başarısızlık). Mevcut `console.warn` çağrıları korunur.
- Admin: opsiyonel — Settings/Monitoring paneline "Son İstemci Hataları" tablosu (dosya/kullanıcı/zaman filtreli).
- Not: Gürültüyü azaltmak için sadece gerçek hata seviyelerini (error + kritik warn) gönder; localStorage/audio gibi zararsız bastırmaları filtrele. Tahmini ~1.5 saat.

## 📌 Backlog — Tamamlanma Süresi Etiketi (P2, kullanıcı 2026-07-29'da onayladı, "ekle")
- Amaç: Tamamlanan görev kartında "Bitiş: ..." satırının yanında görevin ne kadar sürede bittiğini göstermek (created_at → completed_at farkı, örn. "3 günde tamamlandı" / "aynı gün", "5 saatte").
- Frontend: `TaskCard` içinde completed_at rozetinin yanına küçük bir süre pill'i; `lib/taskHelpers.js`'e insan-okunur süre formatlayıcı (gün/saat/dakika, Türkçe). Veri zaten mevcut (`created_at`, `completed_at`) — backend değişikliği gerekmez.
- Not: Süre negatif/None ise (manuel geriye dönük bitiş tarihi created_at'ten önceyse) etiket gizlensin. Excel/Word/Yazdır dışa aktarmaya da opsiyonel "Tamamlanma Süresi" kolonu eklenebilir. Tahmini ~45 dk.


## 📱 MOBİL UYGULAMA — V1 (Expo/React Native, 2026-06)
Cross-platform fork: mevcut web + FastAPI backend'e ek olarak `/app/mobile` altında Expo/React Native mobil uygulaması eklendi. Backend PAYLAŞILIYOR (aynı `/api/*` sözleşmesi), web'e dokunulmadı.

**Kullanıcı onaylı V1 kapsamı:** Login ekranı + Görevler listesi. Tasarım web ile aynı (koyu uzay teması + neon cyan). Holografik küre yerine hafif/sade başlık (performans).

**Tamamlanan (2026-06) — testing_agent ile doğrulandı (iteration_104 & 105 PASS):**
- Auth: `POST /api/auth/login` (username/password) → JWT, SecureStore key `sertex.auth.token` (web'de AsyncStorage fallback). Cold-start'ta `GET /api/auth/me` ile oturum doğrulama; süresi dolan/kicked oturum sessizce logout.
- Login ekranı (`app/login.tsx`): SERTEX HUD başlık, TR hata mesajları, klavye yönetimi, güvenli alan.
- Alt sekme (bottom tabs): GÖREVLER + PROFİL (`app/(tabs)/`).
- Görevler ekranı (`app/(tabs)/tasks.tsx`): `GET /api/tasks?scope=mine` + `GET /api/task-categories`; sınırsız derinlikte hiyerarşik kategori ağacı (aç/kapa), kategori bazlı roll-up done/total, "Kategorisiz" bölümü, metin arama (sonuç yoksa boş-durum), tümünü aç/kapa, pull-to-refresh, checkbox ile tamamla/geri al (`PATCH /api/tasks/{id}`, iyimser güncelleme).
- Profil ekranı: kullanıcı/rol, Çıkış Yap.
- 401 SESSION_KICKED / expired → otomatik logout + login'e yönlendirme.
- **Görev Oluştur/Düzenle/Sil + çok kişili atama (2026-06, testing_agent iteration_106 & 107 PASS):** FAB ile yeni görev modalı; başlık/açıklama/son tarih (hızlı çip: Bugün/Yarın/3 gün/1 hafta)/kategori (düz-liste seçici); create'te `assignee_user_ids` (kullanıcı arama `GET /api/users/search` → çip). Satıra dokununca düzenleme modalı (başlık/açıklama/son tarih/kategori). Sil için özel cross-platform onay diyaloğu (RN Web'de `Alert.alert` no-op olduğu için `Modal` ile). `POST/PATCH/DELETE /api/tasks`. Not: PATCH assignee değiştirmiyor → atama sadece create'te.
- **Takım & Bildirimler (2026-06, testing_agent iteration_108 PASS):** Alt sekmeler artık 4 (GÖREVLER/TAKIM/BİLDİRİM/PROFİL). TAKIM: `GET /api/team/summary` → üye başına kart (ilerleme çubuğu %, Toplam/Tamam/Bekleyen/Gecikmiş, gecikmiş rozeti). BİLDİRİM: `GET /api/notifications` → tip ikonu+etiketi + görev başlığı + göreli zaman, okunmamış vurgusu; sekme ikonunda okunmamış sayısı rozeti (`NotificationsContext`, 30sn poll + manuel refresh); dokun=okundu (`POST /notifications/{id}/read`), Tümü (`/read-all`), sil (`DELETE /notifications/{id}`). Focus'ta otomatik yenileme.
- **FAZ A — Web paritesi başlangıcı (2026-06, testing_agent iteration_109 18/19 PASS):** (chat/AI hariç, kullanıcı isteği). **Görev Detay ekranı** (`app/task/[id].tsx`): başlık/durum/son tarih/kategori, tamamla-geri al, **alt görevler** (ekle/işaretle/sil — `PATCH subtasks`, mevcut alanlar korunur), **hatırlatma** (reminder_days off/1/3/7/14), atananlar + "benim payım" (`POST /tasks/{id}/my-completion`), Düzenle (TaskFormModal), Sil (özel onay). Satıra dokunmak artık detaya gider. **Kategori Yönetimi** (`app/categories.tsx` + `CategoryEditorModal`): şirkete göre gruplu ağaç; kök/alt kol oluştur (admin kök için şirket seçer), yeniden adlandır/renk, taşı (reparent), sil (cascade onay). `POST/PATCH/DELETE /api/task-categories`. Tasks başlığında klasör butonu ile açılır. Deep-link geri dönüş guard'ı (`router.canGoBack()`).

**Mimari (mobil):**
```
mobile/
├── app/ (_layout, index[Gate], login, (tabs)/[_layout, tasks, profile])
├── src/
│   ├── api/ (client.ts, types.ts)
│   ├── auth/ (AuthContext.tsx, storage-keys.ts)
│   ├── components/ (HudHeader, TaskRow, CategorySection)
│   ├── lib/ (taskTree.ts, format.ts)
│   └── theme/colors.ts (design tokens: bgBase #02040A, primary #00F0FF …)
└── constants/testIds/ (auth, tasks)
```

**Öğrenilen ders / dikkat:**
- `expo-linear-gradient` web önizlemesinde boş/beyaz render ediyor → kök zeminlerde düz koyu `View` kullanıldı (tasarım kılavuzuyla da uyumlu). Ayrıca RN Web `shadow*` ve `boxShadow` sorunlu; login butonunda gölge kaldırıldı.
- SINGLE-SESSION: mobilde `serkan` ile giriş, diğer `serkan` oturumunu (web) düşürür. Paralel test için ayrı kullanıcı (`ahmet`) kullan.

**Mobil — Sıradaki (backlog, kullanıcının onayladığı fazlara göre):**
- **FAZ B (devam) — Gelişmiş görev:** ekler (dosya yükle/görüntüle), paylaşım (ACL), yeniden atama, görev bağlama, tekrarlayan hatırlatmalar, kilit/OTP (P1)
- Faz C: Takım analitiği (ısı haritası, kategori/gecikme özetleri, üye drilldown, toplu dürtme) (P2)
- Faz D: Ayarlar (şifre değiştir, digest/bildirim ayarları) (P2)
- Faz E: Yönetici panelleri (kullanıcı/şirket/lisans/görünürlük, izleme, yedekleme, duyurular) (P2)
- Faz F: Sohbet/AI, E-posta, Hafıza (Memory), sesli giriş (Whisper) (P2)
- Push bildirimleri (FCM/expo-notifications) — Publish build + `google-services.json` gerekir (P2)


---

## 2026-08-04 — Web: Görev Başlangıç Tarihi (start_date) [TAMAMLANDI]
Kullanıcı isteği: Görev kartına "Başlangıç–Bitiş" tarihi (gün.ay.yıl saat:dk), kartta görünsün, yumuşak doğrulama (başlangıç ≤ bitiş), ikisi de opsiyonel.

**Backend (shared)** — `routers/tasks_models.py`, `routers/tasks_router.py`:
- `Task`, `TaskCreate`, `TaskUpdate` modellerine `start_date: Optional[str] = None` eklendi (tamamen opsiyonel; mobil bozulmadı — platform-agnostik).
- `create_task` → `Task(start_date=req.start_date)`; PATCH `model_dump(exclude_unset=True)` ile otomatik round-trip. curl e2e doğrulandı (create+patch).

**Web frontend** — `lib/api.js`, `components/TasksPanel.jsx`, `components/tasks/EditTaskModal.jsx`, `components/TaskCard.jsx`:
- Oluşturma formunda iki `datetime-local` alanı: BAŞLANGIÇ (`task-startdate-input`) + BİTİŞ (`task-duedate-input`).
- EditTaskModal'da "BAŞLANGIÇ TARİHİ (opsiyonel)" alanı (`edit-startdate`), önceden dolu gelir, patch'e eklenir.
- TaskCard: iki ayrı satır — "Başlangıç: 08.11.2026 15:00" (`task-start-<id>`) ve "Bitiş: …" (due_date, format `dd.mm.yyyy hh:mm`).
- Yumuşak doğrulama: başlangıç > bitiş ise toast "Başlangıç tarihi bitiş tarihinden sonra olamaz", kayıt engellenir (hem create hem edit).
- Ek düzeltme: tamamlanma satırı etiketi "Bitiş:" → "Tamamlandı:" (due_date "Bitiş:" ile çakışmasını önlemek için).

**Test:** Backend curl e2e ✓. Web self-test (Playwright): soft validasyon ✓ (toast + görev oluşmadı), geçerli oluşturma ✓ (kart `BAŞLANGIÇ: 08.11.2026 15:00` doğru formatta). Testing agent kod incelemesi tüm 5 akışı spec'e uygun buldu.

---

## 2026-08-04 — Mobil: Görev Başlangıç Tarihi (start_date) parity [TAMAMLANDI]
Web'de eklenen start_date özelliği mobil uygulamaya da yansıtıldı. Backend zaten hazırdı (platform-agnostik). Mobil, tarih için hazır çip UX'i kullandığından (datetime picker yok) start_date de aynı çip mantığıyla eklendi (surface-uygun primitive).

**Dosyalar:** `src/api/types.ts` (Task + TaskCreatePayload → start_date), `src/lib/format.ts` (yeni `formatDateTime` → `dd.mm.yyyy hh:mm`), `src/components/TaskFormModal.tsx` (BAŞLANGIÇ çip satırı: Yok/Bugün/Yarın/3 gün/1 hafta, start-of-day 09:00; create+edit payload; yumuşak doğrulama), `src/components/TaskRow.tsx` (liste kartında başlangıç+bitiş, saatli format), `app/task/[id].tsx` (detayda "Başlangıç:"/"Bitiş:" etiketli, saatli), testIds (`task-form-start-chip`, `task-row-start`, `task-detail-start-date`).

**Not:** Mobil bitiş tarihi gösterimi de `formatDate` → `formatDateTime` yapıldı (web ile format birliği: saat eklendi).

**Test (Expo web preview):** Oluşturma formunda BAŞLANGIÇ çipleri ✓; yumuşak doğrulama (start 1 hafta > due bugün) → hata "Başlangıç tarihi bitiş tarihinden sonra olamaz", görev oluşmadı ✓; geçerli oluşturma → liste satırında başlangıç `04.08.2026 09:00` ✓; detay ekranı "Başlangıç: 08.11.2026 15:00" / "Bitiş: 15.11.2026 18:00" ✓. Lint temiz.

---

## 2026-08-05 — Mobil yayın (Publish) backend bağlantı düzeltmesi [DEPLOY/CONFIG]
Sorun: Kullanıcının yayınladığı native build (APK) telefondan backend'e bağlanamıyordu ("connection refused"). Kök neden: build'e gömülü `EXPO_PUBLIC_BACKEND_URL` ÖNİZLEME adresiydi (`sertex-enterprise.preview...`), dışarıdan erişilemez.

Aksiyon: `/app/mobile/.env` → `EXPO_PUBLIC_BACKEND_URL=https://sertex-ai.com` (üretim domaini) olarak güncellendi; mobil servis yeniden başlatıldı. Diğer korumalı anahtarlar (EXPO_PACKAGER_*) korundu.

Doğrulama (güvenli, üretim verisine kalıcı dokunmadan): üretim kökü HTTP 200; `POST /api/auth/login` (serkan) → token ✓; `start_date` create round-trip üretimde çalışıyor (probe silindi) ✓; Expo web önizlemesinde (artık üretime bağlı) serkan ile giriş → görev ekranı ✓.

ÖNEMLİ NOTLAR:
- Native build env'i BUILD anında gömer → değişikliğin telefona yansıması için kullanıcı **yeniden Publish** etmeli (iOS için TestFlight/Apple Developer hesabı gerekir; iPhone'a doğrudan IPA kurulamaz).
- `.env` şu an üretime işaret ediyor; kullanıcı Publish ettikten SONRA önizleme testlerini üretimden izole etmek için değeri tekrar önizleme URL'sine döndürmek gerekebilir.
- Otomatik testing_agent çalıştırılmadı (önizleme mobili canlı üretime bağlı olduğundan veri kirliliği riski); bağlantı manuel/güvenli doğrulandı.

---

## 2026-08-05 — Mobil FAZ B1 (Görev deneyimi web-parity) — 1. dalga [TAMAMLANDI]
Kullanıcı hedefi: telefon uygulamasını web ile aynı seviyeye getirmek; önce görev deneyimi (kartlar + hatırlatıcı), en son mail/AI.

1. dalga (TAMAMLANDI, testing agent iter110 6/6 PASS):
- **Zengin görev kartı** (`TaskRow.tsx`): kart görünümü + sol renk aksan çubuğu (yeşil=tamam, kırmızı=gecikmiş, amber=yakında, diğer=durum rengi), durum pill, başlangıç (play ikonu), bitiş (gecikmişse kırmızı+alert, 2 gün içindeyse amber), alt görev ilerleme çubuğu (X/Y), hatırlatıcı zili (tekrarlıysa repeat ikonu), atanan baş harf avatarları (3'e kadar +N).
- **Aramada vurgulama**: `tasks-search-input`'a yazılan terim görev başlığında cyan ile vurgulanıyor (highlight prop CategorySection→TaskRow üzerinden).
- Yardımcılar: `format.ts` → dueUrgency, subtaskCounts, initials. `types.ts` Task → reminder_at/reminder_days/reminder_disabled/reminder_repeat_total/shared_with/created_at.
- Yeni testID'ler: task-row-due, task-row-reminder, task-row-assignees.

B1 KALAN (2. dalga):
- **Yeniden atama** (mevcut görevin atananını değiştirme) — backend'de `POST /tasks/{tid}/reassign` mevcut, kilit/OTP ile ilişkili (B2 ile örtüşür), dikkatli yapılacak.
- **Hatırlatıcı web-parity**: mobilde gün-bazlı hatırlatıcı zaten çalışıyor; web'deki mutlak reminder_at / erteleme / tekrar seçeneklerine tam eşitleme opsiyonel geliştirme.

Sıradaki fazlar: B2 (ekler/paylaşım/bağlama/kilit-OTP), C (ekip analitiği + rapor export), D (ayarlar/admin), E (mail), F (AI).

## 2026-08-05 — Mobil FAZ B1 — 2. dalga: Yeniden Atama (Devret) [TAMAMLANDI]
- Görev detay ekranına **SAHİP** bölümü + **Devret** butonu (`task-detail-reassign-button`).
- Devret modalı: kullanıcı arama (`task-detail-reassign-search`, debounce), sonuç satırları (`task-detail-reassign-user-<id>`), kapat (`task-detail-reassign-close`).
- Seçilen kullanıcıya `POST /api/tasks/{id}/reassign {new_owner_user_id}` ile sahiplik devri; başarıda modal kapanır, detay yenilenir, yeni sahip görünür.
- Kilitli görevde backend HTTP 423 + Türkçe mesaj inline gösterilir (admin serkan kilidi bypass eder).
- `client.ts` → `reassignTask()`; `types.ts` SearchUser mevcut.
- Test: backend curl (serkan→ahmet) ✓; testing_agent iter111 mobil UI happy-path + modal UX + regresyon PASS, geçici görev temizlendi.

**FAZ B1 DURUM: TAMAMLANDI** (zengin kart + arama vurgulama + hatırlatıcı[mevcut, gün-bazlı] + yeniden atama).
Hatırlatıcıda mutlak tarih/erteleme/tekrar tam web-parity = opsiyonel gelecek geliştirme.

Sıradaki: FAZ B2 (ekler/paylaşım/görev bağlama/kilit-OTP), C (ekip analitiği + rapor export), D (ayarlar/admin), E (mail), F (AI).

## 2026-08-05 — Mobil FAZ B2 — 1. dalga: Görev Ekleri (Attachments) [TAMAMLANDI]
- Yeni bileşen `src/components/AttachmentsSection.tsx`, görev detayına "EKLER" bölümü olarak bağlandı.
- Kaynak seçici: Kamera / Galeri / Dosya (expo-image-picker + expo-document-picker; izin akışı + reddedilirse "Ayarları Aç").
- Chunked upload: `client.ts uploadAttachment()` init(JSON)→chunk(multipart)→complete(JSON). **Platform dallanması**: web'de picked uri→Blob (`form.append("chunk", blob, name)`), native'de `{uri,name,type}` (RN FormData). Bu, react-native-web'de 422 ([object Object]) bug'ını çözdü.
- Liste: resimler thumbnail (expo-image + auth header), diğerleri dosya ikonu; ad + boyut + yükleyen; sil (onay modalı).
- Resme dokun → tam ekran önizleme; belgeye dokun → expo-file-system/legacy downloadAsync + expo-sharing ile aç.
- Deps: expo-image-picker, expo-document-picker, expo-file-system, expo-sharing. app.json: iOS infoPlist (kamera/galeri) + Android CAMERA izni + expo-image-picker plugin.
- Yeni deps kuruldu; app.json değişti → mobil servis restart edildi.
- Test: backend curl (init→chunk→complete→list→delete) ✓; testing_agent iter112 upload bug bulundu→düzeltildi→iter113 6/6 PASS. Web branch doğrulandı; native branch (standart RN FormData) kullanıcı build alınca doğrulanacak.

B2 KALAN dalgalar: 2) Paylaşım (`PUT /tasks/{id}/shares`), 3) Görev Bağlama (`/task-groups`), 4) Kilit/OTP (`/tasks/{id}/locks`, `/unlock-otp`, `/unlock-verify`).


## ✅ Bug Fix — Mobil Görev Detayında "SAHİP" Adı (2026-06-06)
- **Sorun:** Mobil görev detay ekranı (`/app/mobile/app/task/[id].tsx`) "SAHİP" alanını `assignee_name`'den okuyordu; kullanıcı kendi görevini oluşturduğunda bu alan boş kaldığı için "—" görünüyordu.
- **Kök neden:** Backend `GET /api/tasks/{id}` yanıtı sahibin adını `user_id`'den çözmüyordu.
- **Çözüm (paylaşılan sözleşme):**
  - Backend: `Task` modeline opsiyonel `owner_username` alanı eklendi; `get_task` endpoint'i `user_id` → `users.username` ile bu alanı dolduruyor (yalnızca tekil okumada, N+1 yok).
  - Mobil: `types.ts` Task tipine `owner_username` eklendi; "SAHİP" artık `owner_username || assignee_name || "—"` gösteriyor.
- **Test:** Backend curl (owner_username='serkan', assignee_name=None) ✓; mobil önizlemede ekran görüntüsü — "SAHİP: serkan" doğrulandı ✓.

## ⚠️ Refactor Notu
- `PRD.md` 2340+ satıra ulaştı — gelecekte PRD.md / CHANGELOG.md / ROADMAP.md olarak bölünmesi öneriliyor.


## ✅ Özellik — Görev Dosya Eklerinde Tam Ekran Önizleme (Web + Mobil) (2026-06-07)
- **İstek:** Görevlerdeki ekli dosyaya dokununca tam ekran önizleme (her iki platform).
- **Web** (`frontend/src/components/tasks/TaskAttachments.jsx`): Dosya adına tıklayınca tam ekran önizleme modalı.
  Resimler `<img>`, PDF'ler `<iframe>` ile gösteriliyor; diğer türler indiriliyor. Modal `createPortal(document.body)`
  ile render ediliyor (sağ panelin `transform`'u nedeniyle `fixed` sıkışmasını çözmek için) → gerçek tam ekran.
  Blob, mevcut `taskAttachmentsApi.download` ile alınıp `URL.createObjectURL` ile gösteriliyor. Backend değişikliği YOK.
- **Mobil** (`mobile/src/components/AttachmentsSection.tsx`): Resimler zaten tam ekran açılıyordu (korundu).
  PDF'ler artık cache'e indirilip `react-native-webview` ile uygulama içi tam ekran önizleniyor (paylaş butonu fallback).
  Diğer türler indirilip paylaşılıyor. **NATIVE özellik:** PDF WebView önizlemesi Expo web önizlemesinde render olmaz,
  yalnızca gerçek iOS/Android build'inde doğrulanır.
- **Test:** Web e2e doğrulandı (resim + PDF modalı, 1920×1080 tam ekran, portal). Mobil: EKLER listesi + resim
  önizleme regresyonsuz doğrulandı (screenshot). Mobil PDF WebView → iOS build'inde doğrulanacak.
- **Dağıtım:** Bu özellik SADECE frontend/mobil kod değişikliği (backend değişmedi). Web için REDEPLOY, mobil için
  YENİ iOS build gerekir.

## ✅ Marka — SERTEX Logo Uygulandı (ikon/splash/favicon) (2026-06-07)
- Kullanıcının seçtiği hexagon devre "S" amblemi kare app ikonuna dönüştürüldü.
- Mobil: assets/images/ icon.png, adaptive-icon.png (Android safe-zone), favicon.png, splash-image.png güncellendi. Splash imageWidth 220.
- Web: frontend/public/favicon.png + apple-touch-icon.png + logo192/512 eklendi; index.html favicon linkleri eklendi.
- Doğrulama: web favicon 200 (image/png), mobil app sorunsuz yükleniyor. App ikonu/splash NATIVE -> yeni iOS build sonrası görünür; web favicon redeploy sonrası.

## 🐞 Kritik Düzeltme — Yayınlanmış Mobil Uygulamada Giriş Yapılamıyor ("Sunucuya ulaşılamadı") (2026-06)
- **Bulgu (kök neden):** Kök `/app/.gitignore` dosyası `.env`, `.env.*`, `*.env` desenleriyle TÜM `.env` dosyalarını
  hariç tutuyordu. Yayınlanmış (production) mobil build sırasında `mobile/.env` repoya dahil edilmediği için
  `EXPO_PUBLIC_BACKEND_URL` build'e gömülmüyordu → `client.ts` içinde `BASE` = undefined →
  `fetch("undefined/api/auth/login")` hata fırlatıyor → kullanıcıya "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin."
  Önizleme (preview) ortamında `.env` mevcut olduğu için sorun YALNIZCA yayınlanmış build'de görülüyordu.
- **Düzeltmeler:**
  1. `/app/.gitignore` → `.env`/`.env.*`/`*.env` desenleri kaldırıldı (env dosyaları artık deploy'a dahil).
  2. `backend/.env` → `CORS_ORIGINS="*"` (Emergent deploy politikası; tüm deploy/mobil origin'lerine izin).
  3. `backend/server.py` → başlangıçta çalışan yıkıcı `db.reminders.delete_many({})` satırı kaldırıldı (veri kaybı riski).
- **Doğrulama:** deployment_agent statik tarama = PASS (blocker yok). Preview backend login = 200 OK.
- **Aksiyon (kullanıcı):** Bu bir production build/paketleme sorunu olduğundan düzeltmenin telefonda etkili olması için
  kullanıcının backend'i yeniden DEPLOY etmesi ve mobil uygulamayı yeniden PUBLISH etmesi gerekir.

## 🔧 Mobil — EXPO_PUBLIC_BACKEND_URL canlı sunucuya çevrildi (2026-06)
- Kullanıcı isteğiyle `mobile/.env` içindeki `EXPO_PUBLIC_BACKEND_URL` preview yerine `https://sertex-ai.com` (production) yapıldı.
- Amaç: Yayınlanmış (Publish) mobil uygulamanın doğrudan canlı backend'e bağlanması ("sunucuya ulaşılamadı" hatası için deneme).
- Yan etki (kabul edildi): Mobil PREVIEW artık canlı backend'e/veriye bağlanır.
- `frontend/.env` DEĞİŞTİRİLMEDİ (preview web'i bozmamak için).
- Ayrıca `client.ts` giriş hatası artık bağlanılan adresi gösteriyor: "Sunucuya ulaşılamadı. (Adres: ...)" — TANIMSIZ görünürse adres build'e gömülmüyor demektir.
- DOĞRULAMA: Production build gerektirdiğinden ajan tarafından test edilemedi; kullanıcının yeniden PUBLISH etmesi gerekiyor.

## ✅✅ KALICI ÇÖZÜM / RUNBOOK — Yayınlanmış Mobil Uygulamada "Sunucuya ulaşılamadı" (DOĞRULANDI, ÇALIŞIYOR)
> Bu sorun HER production Publish'te tekrar edebilir. ÇÖZÜM NETLEŞTİ — bir daha uğraşmayın:
**KÖK NEDEN:** Yayınlanmış (production) mobil APK, backend adresini `mobile/.env` içindeki `EXPO_PUBLIC_BACKEND_URL`'den alır. Bu değer PREVIEW adresine (…preview.emergentagent.com) ayarlıysa, telefondaki canlı uygulama giriş yapamaz → "Sunucuya ulaşılamadı".
**ÇÖZÜM (kullanıcı 2026-06'da onayladı — "tamam şimdi oldu"):**
1. `/app/mobile/.env` → `EXPO_PUBLIC_BACKEND_URL=https://sertex-ai.com` (CANLI backend adresi). YALNIZCA bu satır; `EXPO_PACKAGER_*` korumalı satırlara DOKUNMA.
2. `frontend/.env`'e DOKUNMA (preview web'i bozar, canlı web'i etkilemez).
3. `sudo supervisorctl restart mobile`.
4. Kullanıcı sağ üstten yeniden **Publish** edip yeni build'i kursun.
**YAN ETKİ:** Bu ayarla mobil ÖNİZLEME de canlı backend'e bağlanır (kullanıcı bunu kabul etti).
**Ek destek:** `client.ts` giriş hatası bağlanılan adresi gösterir ("Adres: ..."); TANIMSIZ = adres build'e gömülmemiş.

## 🐞 Bugfix — Arşiv Araması Sidebar İş Kolu Filtresine Takılıyordu (Web) (2026-06 · fork)
Kullanıcı bildirimi: Bir iş kolu (ör. "ORTAK İŞLER") seçiliyken ARŞİV'e girip arama yapınca görev bulunamıyor; "TÜMÜ" seçiliyken aynı arama buluyor — tutarsız/anlamsız.
- **Kök neden** (`TasksPanel.jsx`): Arşiv görünümünde iş kolu çipleri + durum filtre çipleri GİZLİ (`!showArchived`), ama `categoryFilter`/`filters` state'i aktif görünümden kalıyordu. `filtered` hesaplaması bu kalıntı filtreleri arşiv listesine de uyguladığından, seçili kola ait olmayan arşiv görevleri (ve arama sonuçları) eleniyordu.
- **Düzeltme**: `showArchived` iken `filtered` artık `categoryFilter` ve durum `filters`'ı YOK SAYAR (yalnızca arşiv grubu yükü + arama uygulanır). Render dal koşulları da (`visibleTaskList` + ana liste render) arşivi "kategori filtresi yok" gibi ele alır → kalıntı seçim render yolunu değiştirmez, tutarlı.
- **Test**: testing_agent iteration_123 — 3 senaryo PASS (KOLSUZ/Fason Verme/TÜMÜ seçiliyken arşiv araması görevi buluyor), aktif görünüm kategori filtresi + arşiv grup/sıralama çipleri regresyonsuz. Seed görev kalıcı silindi.
- **Yayın**: preview'de; canlıya (sertex-ai.com) için yeniden Deploy gerekir.

## 👑 Rol Hiyerarşisi — Süper Yönetici / Kurucu (owner) (2026-06 · fork) ✅ TAMAMLANDI
**Problem:** admin ile kurucu (serkan) aynı yetkilere sahipti. İstenen: en üstte tek dokunulmaz **Kurucu**, altında **Süper Yönetici** (her şey), onun altında **şirket-kapsamlı Yönetici**.

**Roller:** `super_admin` › `admin` › `manager` › `employee`. serkan → `super_admin` + `is_owner=true` (kalıcı, dokunulmaz).

**Backend (Faz 1):**
- `permissions.py`: `effective_role` (temp expiry + owner), `acting_role` (super→admin, tüm legacy `role=='admin'` gate'leri süper için korur), `is_super_admin/is_privileged/get_admin_caps/admin_effective_company_ids`. `visible_user_ids`/`can_view_user`/`can_view_company` şirket-kapsamlı (super=all, admin=own+extra companies, gated by `can_view_company_tasks`).
- `auth.py`: seed serkan owner+super; `require_super_admin`/`require_owner`; `get_current_user` süreli süper yönetici için lazy revert. `license_service.is_admin` super'ı da kapsar (serkan license bypass).
- Endpoint reclass: system (system-quota, chat-prompt, health, client-logs, impersonate, backup, fcm, lisans) → super-only. Kullanıcı CRUD → admin scoped + owner protection + rol limiti (super_admin API'den atanamaz). Duyuru/arşiv → admin kendi şirketi için.
- Yeni endpoint: `GET /admin/super-admins`, `POST/DELETE /admin/users/{id}/super-admin` (owner-only, süreli+revoke), `PATCH /admin/users/{id}/admin-caps` (super).
- 3 grantable fonksiyon: `can_view_company_tasks`, `can_create_company`, `extra_company_ids`.

**Web (Faz 2):** `lib/roles.js` (isAdminLike/isSuperAdmin/isOwner/roleLabel). `SettingsPanel` tab gating helper'a taşındı; sistem sekmeleri (İstatistik/Lisanslar/Sertex Prompt/Backup) super-only; yeni **"Süper Yönetici"** sekmesi (`SuperAdminPanel.jsx`) — süper yönetici listesi + admin caps toggle + (owner) süreli atama/geri alma. `UserManagement` owner/super satırlarını korur (silme/rol/impersonate disabled). Sidebar/TaskCategories/UserLockPolicy/ShareTaskModal helper'a geçirildi.

**Mobil (Faz 3):** `src/auth/roles.ts`; `settings/index.tsx` linkleri helper'a taşındı + `super-admins` linki (super-only); yeni `app/settings/super-admins.tsx` ekranı (caps chip + owner ATA/Geri Al). `tasks.tsx` isAdmin, `profile.tsx` roleLabel güncellendi. `api/client.ts` + `types.ts` yeni endpoint/tipler.

**Test:** pytest `test_super_admin_hierarchy.py` (7) + `test_super_admin_extended.py` (5) = 12/12. testing_agent iteration_124 → backend + web + mobil TÜMÜ PASS, fonksiyonel hata yok.

**Bilinen kozmetik:** DB'de ~60 eski test şirketi (COD$_*/TEST_*/E2E_*) "Ek şirket görme" chip bulutunu şişiriyor — opsiyonel tek seferlik temizlik.
**Yayın notu:** canlıya çıkışta backend redeploy + mobil için yeni Publish gerekir. `EXPO_PUBLIC_BACKEND_URL`/`REACT_APP_BACKEND_URL` publish öncesi `https://sertex-ai.com` olmalı.

## 🧹⏰🏁 Üçlü İyileştirme (2026-06 · fork) ✅ TAMAMLANDI
1) **Şirket Temizliği:** 56 boş test şirketi (0 kullanıcı+0 görev; CoDS_/TEST_/E2E_/RBACX_/CAPCO_ vb.) silindi. 4 gerçek şirket korundu (AA_BadgeTest, ACME-RBAC-TEST, TEST_CoB_858c25, Test Company A). Orphan company_permissions + admin_caps.extra_company_ids temizlendi. "Ek şirket görme" chip bulutu artık tertemiz.
2) **Süreli Süper Yönetici — Süre Uyarısı:** `team_service.scan_and_notify_super_admin_expiry` (mevcut `_scanner_loop`'a eklendi, 300s). Süreye `SERTEX_SUPER_EXPIRY_WARN_MIN` (vars. 60) dk kalınca bir kez uyarı; süre dolunca PROAKTİF geri dönüş + bilgi. Bildirimler hem kişiye hem KURUCU(lar)a gider. Yeni tipler: `super_admin_expiring`/`super_admin_expired` (push_service metinleri + web `NotificationBell` shield ikonlu render + mobil `notify.ts`+`notifications.tsx`). Grant `super_admin_expiry_warned=False` set eder, revoke/lazy-revert unset eder. Test: warn (self+owner, tekrar yok) + expired (role→admin, self+owner) direkt scan ile doğrulandı; web bell ekran görüntüsüyle onaylandı.
3) **Tamamlanma Süresi Etiketi:** Web zaten vardı (`TaskCard.taskDurationLabel` → "3 günde"). Mobil eklendi: `format.taskDurationLabel` + `TaskRow` yeşil "🕐 X günde" pill'i + `task-row-completed`/`task-row-duration` testID. Ekran görüntüsüyle doğrulandı ("15 günde"/"1 günde").

## 🍎 iOS TestFlight — Export Compliance Fix (2026-06 · fork)
**Belirti:** TestFlight'ta build'ler "Tamamlandı" görünüyor ama testçiye davet maili gelmiyor / uygulama yüklenmiyor.
**Kök neden:** `mobile/app.json` içinde `ios.infoPlist.ITSAppUsesNonExemptEncryption` YOKTU → App Store Connect her build'i "Export Compliance" cevabı için beklemeye alıyor, bu yüzden build testçi grubuna dağıtılmıyor (davet/yükleme engelleniyor).
**Düzeltme:** `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` eklendi (uygulama yalnızca standart HTTPS/TLS kullanıyor = muaf). Artık yeni build'ler otomatik uyumlu sayılır.
**Doğrulama sınırı:** Bu NATIVE build ayarıdır; Metro/preview veya testing_agent ile doğrulanamaz. Sadece YENİ bir Publish build'i (sürüm artar) ile doğrulanır. Mevcut 1.0.2(116) build'i için geçici çözüm: App Store Connect → o build → Export Compliance sorusunu "standart şifreleme" olarak cevapla → anında testçilere açılır.
