# SPEC — Görev Paylaşımı + Çok Kişili Atama (Task Sharing & Multi-Assignee)
> Bu dosya, kullanıcı ile NETLEŞTİRİLMİŞ gereksinimlerdir. Opus fork'u bu spec'i
> birebir uygulamalıdır. Kullanıcı dili: TÜRKÇE. Tüm iletişim Türkçe olacak.
> Durum: ONAYLANDI, KODLAMA HENÜZ BAŞLAMADI (kullanıcı Opus'a fork'ladı).
> Tarih: 2026-06 (E1 fork öncesi hazırlık).

## 0) ORİJİNAL SORUN (kök neden)
- Kullanıcı (yazılım sahibi/ADMIN) bir "iş kolu" (= **görev kategorisi / TaskCategory**)
  oluşturdu: "Ortak İşler". Müdür **Pınar**'ı bu ortak iş koluna çekti
  (kategori `visible_to_user_ids` / `visible_to_company_ids`'e eklendi).
- Admin ortak iş koluna görev açtı → **Pınar GÖREMİYOR**. Pınar açınca → admin görüyor.
- **Kök neden:** `list_tasks` (routers/tasks_router.py ~satır 192-200) görevleri SADECE
  `visible_user_ids(db, user)` (kimi görebiliyorsun) ile filtreliyor; kategorinin
  paylaşımını (`visible_to_user_ids`/`visible_to_company_ids`) HİÇ dikkate almıyor.
  Admin herkesi görür (allowed_ids=None), müdür sadece kendi ekibini görür → asimetri.

## 1) ÇÖZÜM YÖNÜ (kullanıcı kararı)
Kategori-bazlı otomatik görünürlük EKLENMEYECEK (S5-a). Bunun yerine iki özellik:

### ÖZELLİK A — Çok kişili görev + kişi-kişi tamamlama (seçenek "c")
- Yeni görev açarken **birden fazla çalışan** seçilebilecek (tek assignee yerine liste).
  Örn: Hasan, Hüseyin, Serkan, Burcu → görev hepsine gider.
- **TEK görev kartı**, ama her atanan kişinin YANINDA ayrı **"tamamladı ✓"** işareti.
- Görev ancak **HERKES** kendi tarafını işaretleyince "tamamlandı" (done) sayılır.
- İlerleme göstergesi: "2/4 tamamlandı" gibi.
- Tüm atananlar görevi kendi görev listesinde görür.
- GERİYE UYUMLULUK: mevcut tek-atanan görevler (assignee_user_id/user_id) çalışmaya
  devam etmeli. Yeni çoklu-atama alanı ek olacak; eski alanlar bozulmayacak.

### ÖZELLİK B — Görev-bazlı paylaşım + yetkilendirme (per-task ACL)
- Görev kartında **⋮ (3 nokta) → "Özellik Tanımla"** menü öğesi.
- Açılan pencerede:
  - **İsimle kullanıcı ara-seç** → sistemdeki HERKES seçilebilir (şirket fark etmez;
    C firması müdürü örneğin). (S3-a)
  - Her eklenen kişi için **ayrıntılı yetki kutuları** (S1-b):
    **Görüntüle · Düzenle · Tamamla (durum değiştir) · Sil · Başkasına ata**
  - **"Bildirim gönder" aç/kapa** düğmesi: açıksa karşı tarafa bildirim (çan + FCM
    push) gider, kapalıysa sessiz paylaşım. (S4 = çift seçenekli / opsiyonel)
- **Kim paylaşabilir / yetki verebilir** (S2-b):
  görevi **oluşturan + admin + görevin iş kolunun/şirketinin müdürü**.
- Paylaşılan kişi görevi kendi listesinde görür; ne yapabileceği verilen yetkilerle
  KISITLI olacak (mutation endpoint'lerinde yetki kontrolü).

## 2) VERİ MODELİ ÖNERİSİ (uygulayıcı netleştirebilir)
`Task` modeline (routers/tasks_models.py, ~satır 130-175) eklenecek alanlar:
```
assignees: List[{ user_id: str, name: str, completed: bool, completed_at: Optional[str] }]
   # Özellik A. Boşsa eski tek-atanan davranışı (user_id/assignee_user_id) geçerli.
   # done koşulu: assignees doluysa → hepsi completed=True olunca task.status="done".
shared_with: List[{ user_id: str, name: str,
                    perms: { view: bool, edit: bool, complete: bool,
                             delete: bool, assign: bool } }]
   # Özellik B. ACL. view=True olan bu görevi list_tasks'ta görebilir.
```
- MongoDB ObjectId kurallarına uy (PyObjectId, from_mongo/to_mongo). datetime =
  datetime.now(timezone.utc), ISO string olarak sakla.

## 3) DOKUNULACAK BACKEND NOKTALARI
Dosya: `backend/routers/tasks_router.py`
- `list_tasks` (~192): görünürlük sorgusunu genişlet →
  `q["$or"] = [ {user_id in allowed_ids}, {assignees.user_id == uid},
                {shared_with.user_id == uid} ]` (admin hâlâ hepsini görür).
  DİKKAT: mevcut archived/orphaned filtreleriyle çakışmasın; RBAC testlerini bozma.
- `create_task` (~280-300): çoklu assignee kabul et; `assignees` listesi kur.
- Görev güncelleme/tamamlama/silme/reassign endpoint'leri (~178-460 civarı):
  yetki kontrolüne `shared_with[uid].perms` ve `assignees` durumunu ekle.
  Kişi-kişi tamamlama için yeni davranış (bir atanan sadece KENDİ completed'ını değiştirir).
- Yetki yardımcıları: `backend/permissions.py` (visible_user_ids, can_view/can_edit
  benzeri helperlar burada/`team_service.py`'de). Yeni "task-level perm" helper'ı ekle.

Dosya: `backend/team_service.py`
- Yeni bildirim tipi ekle: örn `NOTIF_TYPE_TASK_SHARED = "task_shared"` (Faz 10'da
  eklenen `NOTIF_TYPE_TASKS_ORPHANED` desenini izle). `_insert_notification` kullan.
  task_id dolu olacağından (user_id, task_id, type) unique index dedup'ına dikkat.
- FCM: `fcm_service.send_to_user(db, uid, title, body, data)` (best-effort).

## 4) DOKUNULACAK FRONTEND NOKTALARI
Dosya: `frontend/src/components/TasksPanel.jsx` (~2500 satır — büyük; parça çıkarılabilir)
- Yeni görev formu: tek "atanan" yerine **çok seçmeli kullanıcı seçici** (chip'li).
  Mevcut `CompanyCombobox.jsx` (frontend/src/components/tasks/) deseni referans alınabilir;
  benzer koyu-tema çoklu seçim bileşeni yap.
- Görev kartı ⋮ menüsü: yeni **"Özellik Tanımla"** öğesi → koyu-tema modal:
  - Kullanıcı ara (debounce, `/team/members` veya admin user listesi; "herkes" için
    uygun bir arama endpoint'i gerekebilir — bkz. Not).
  - Her kişi satırında 5 yetki kutusu (Görüntüle/Düzenle/Tamamla/Sil/Başkasına ata).
  - "Bildirim gönder" toggle.
  - Kaydet/İptal. data-testid'leri EKLE (paylaşım-modal, kullanıcı-arama, yetki-kutuları,
    kaydet vb.).
- Kart üstünde çoklu-atama ilerlemesi ("2/4 ✓") ve her kişinin tamamlama durumu.
- Bildirim çanı: `frontend/src/components/NotificationBell.jsx` → yeni `task_shared`
  tipini render et (Faz 10'daki `tasks_orphaned` deseni gibi; ikon + mesaj + tıkla→görev).

## 5) ONAYLANMIŞ KARARLAR (özet — kullanıcı cevapları)
- S1 = **b** (ayrıntılı yetki kutuları: Görüntüle/Düzenle/Tamamla/Sil/Başkasına ata)
- S2 = **b** (oluşturan + admin + iş kolu/şirket müdürü paylaşabilir)
- S3 = **a** (isimle ara, sistemdeki herkes seçilebilir)
- S4 = **opsiyonel bildirim** (paylaşırken "Bildirim gönder" aç/kapa)
- S5 = **a** (sadece elle görev-bazlı paylaşım; ortak iş koluna OTOMATİK görünürlük YOK)
- Çok kişili tamamlama = **c** (tek kart, kişi-kişi ✓, herkes işaretleyince done)

## 6) NOTLAR / TUZAKLAR
- RBAC çok katmanlı: cross-company perms (Faz 9 CP1), kategoriler, kilitler (locks),
  orphan görevler (Faz 8 CP6 + Faz 10). Yeni paylaşımı bunlarla ÇAKIŞMADAN entegre et.
- Mevcut 108+ pytest (tests/): `test_tasks`, `test_task_reassign`, `test_task_categories`,
  `test_multi_company`, `test_permissions`, `test_category_visibility`, `test_multiuser`.
  Değişiklikten sonra bunları ÇALIŞTIR (seri: `-n 0`, ve `REACT_APP_BACKEND_URL` export et).
  NOT: bu forked ortamda kalıcı test kullanıcısı "ahmet"in lisansı olmadığından
  bazı `test_multiuser` testleri 402 ile düşüyor — DEĞİŞİKLİKLERLE İLGİSİZ (git stash ile
  doğrulanabilir). Lisanslı test kullanıcısı için admin `POST /api/admin/users` gövdesine
  `with_license: "lifetime"` ekle (bkz. tests/e2e_offboard_check.py örneği).
- "Herkesle paylaşım" için kullanıcı arama endpoint'i: mevcut `/team/members` sadece ekip
  döndürebilir. Admin için `/admin/users` var. Cross-company "herkes" araması için
  uygun bir arama endpoint'i gerekebilir (ör. `/users/search?q=`), RBAC'e dikkat.
- Test: iş bitince **bug_testing_agent** ile kullanıcının senaryosunu doğrula:
  "Admin ortak/paylaşılan bir görev açar → Pınar (müdür) görür; yetkilere göre
  düzenler/tamamlar; çok kişili görevde her kişi kendi ✓'ını işaretler, hepsi bitince done."

## 7) KİMLİK BİLGİLERİ (test)
- Admin: `serkan` / `19071987`
- Test kullanıcısı: `ahmet` / `ahmet123` (lisanssız olabilir — bkz. Notlar)
- Preview: `REACT_APP_BACKEND_URL` (frontend/.env). Production: https://sertex-ai.com (deploy edilmiş).

## 8) İLGİLİ DOSYALAR
- backend/routers/tasks_router.py (list_tasks, create_task, update/complete/delete/reassign, categories)
- backend/routers/tasks_models.py (Task, TaskCategory modelleri)
- backend/permissions.py, backend/permissions_router.py (visible_user_ids, RBAC, company members)
- backend/team_service.py (Notification, _insert_notification, offboard helper, NOTIF_TYPE_*)
- backend/fcm_service.py (send_to_user)
- frontend/src/components/TasksPanel.jsx (ana görev arayüzü)
- frontend/src/components/tasks/CompanyCombobox.jsx (koyu-tema seçici deseni)
- frontend/src/components/NotificationBell.jsx (bildirim render)
- frontend/src/components/UserManagement.jsx (kullanıcı/şirket yönetimi referansı)
