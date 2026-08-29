# 📱 Sertex Android — Kurulum Kılavuzu

Bu doküman, Sertex web uygulamasını **Android telefonuna kurulabilir APK'ya** çevirmek için gereken tüm adımları anlatır. Adımların çoğu **tek seferlik**; ilk kurulumdan sonra her `git push` ile yeni APK otomatik üretilir.

---

## 🎯 Genel Akış

```
[Sen kod yaz]
     ↓
[Emergent → "Save to GitHub"]
     ↓
[Codemagic otomatik algılar]
     ↓
[Bulutta APK derler] (~8-12 dk)
     ↓
[E-mail ile "hazır" bildirimi gelir]
     ↓
[APK'yı indir, telefona kur, kullan 🎉]
```

---

## 🛠️ Ön Hazırlık (Tek Seferlik — ~30 dakika)

### 1️⃣ Kod Deposu (GitHub) — 2 dakika
1. Emergent chat kutusunda **"Save to GitHub"** butonuna tıkla
2. Repository'yi **public** ya da **private** olarak yayınla (private ücretsiz, önerilen)
3. Repository URL'ini not al: `https://github.com/<kullanıcı>/<repo>`

### 2️⃣ Codemagic Hesabı — 5 dakika
1. https://codemagic.io/signup adresine git
2. **GitHub ile giriş yap** (en pratik yol)
3. E-mail doğrulaması yap
4. **"Add application"** → GitHub deposunu bağla
5. Codemagic otomatik `/app/codemagic.yaml` dosyasını algılar

### 3️⃣ Ortam Değişkenleri (Environment Variables) — 3 dakika
Codemagic panelinde: **Application → Environment variables → Add group** ile bir grup oluştur (adı: `keystore_credentials`) ve şu değişkenleri ekle (opsiyonel, sadece **signed release** APK için gerekli):

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `SERTEX_KEYSTORE_PATH` | Keystore dosyasının yolu | `keystore.jks` |
| `SERTEX_KEYSTORE_PASSWORD` | Keystore şifresi | `••••••••` |
| `SERTEX_KEY_ALIAS` | Anahtar adı | `sertex` |
| `SERTEX_KEY_PASSWORD` | Anahtar şifresi | `••••••••` |

> ⚠️ **Not:** İlk aşamada bu adımı **ATLA**. `codemagic.yaml`'daki `assembleDebug` komutu **imzasız APK** üretir → telefonuna kurulur, sadece Play Store'a yüklenemez.

### 4️⃣ Backend URL Kontrolü — 1 dakika
`codemagic.yaml` içindeki `REACT_APP_BACKEND_URL` değişkeninin **production adresini** işaret ettiğini doğrula:

```yaml
REACT_APP_BACKEND_URL: "https://sertex-ai.com"
```

Bu değer değişecekse Codemagic panelinden **override edebilirsin** — dosyaya dokunma.

---

## 🚀 İlk APK Üretimi

### 1️⃣ Codemagic Panelinde
- **"Start new build"** butonuna tıkla
- Workflow: `sertex-android`
- Branch: `main`
- **"Start build"** → derleme başlar

### 2️⃣ Derleme Süresi
- İlk build (bağımlılıklar cache'siz): **~10-14 dakika**
- Sonraki build'ler (cache ile): **~5-8 dakika**

### 3️⃣ APK'yı İndirme
Build bittiğinde:
- ✉️ E-mail'ine "Build succeeded" mesajı gelir
- 📎 E-mail'de doğrudan **"Download artifacts"** linki var
- Ya da: Codemagic panel → "Build history" → son build → **"app-debug.apk"** indir

---

## 📱 Telefona Kurulum (Side-loading)

### Yöntem A — Doğrudan İndir (En Kolay)
1. Telefonundan Codemagic e-mail'ine gir
2. **"Download artifacts"** linkine tıkla
3. `app-debug.apk` dosyasını indir
4. İndirilenler klasöründen tıkla → **"Kur"** → onay ver
5. İlk kurulumda **"Bilinmeyen kaynak"** izni sorabilir → **"Ayarlara git"** → izin ver → geri dön

### Yöntem B — USB Kablosuyla (İsteyen için)
```bash
# Bilgisayarında ADB kuruluysa:
adb install app-debug.apk
```

---

## 🔄 Kod Güncelleyince Ne Oluyor?

1. Emergent'te değişiklik yap
2. **"Save to GitHub"** → push
3. Codemagic **otomatik** yeni build başlatır
4. ~8-12 dk sonra e-mail ile yeni APK gelir
5. APK'yı telefonuna kur — üstüne yazar (verilerin kaybolmaz)

---

## 🐛 Sorun Giderme

### ❌ "Uygulama internet'e bağlanmıyor"
- `codemagic.yaml`'daki `REACT_APP_BACKEND_URL` doğru mu kontrol et
- Backend `https://` ile başlamalı (Android cleartext HTTP'yi bloklar)
- Telefonun Wi-Fi/mobile veri açık mı?

### ❌ "Kurulum sırasında 'kurulum engellendi' hatası"
- **Ayarlar → Uygulamalar → Özel uygulamalar üzerinden erişim → Chrome (veya indirdiğin uygulama) → Bu kaynaktan yüklemeye izin ver**

### ❌ "Codemagic build fail — Node version mismatch"
- `codemagic.yaml`'daki `NODE_VERSION: 20` doğru mu?
- Yerelde farklı bir Node sürümüyle çalışıyorsan `frontend/package.json`'a `"engines": {"node": ">=20"}` ekle

### ❌ "SSE bağlantısı kesiliyor" (Android arka planda)
Bu **normal Android davranışı**. Uygulama arka plana atılınca WebView'daki uzun-süreli HTTP bağlantıları kesilir. Uygulamayı öne aldığında SSE otomatik yeniden bağlanır (EventSource'un native davranışı).

Kalıcı arka plan push için ileride **Firebase Cloud Messaging (FCM)** entegrasyonu ekleyebiliriz — o zaman uygulama kapalı olsa bile bildirim düşer.

---

## 🍎 iOS Ne Zaman Gelecek?

Bu doküman **Android only**. iOS build için:
1. Apple Developer Program üyeliği ($99/yıl) — https://developer.apple.com/programs
2. Codemagic'te iOS için ek workflow (mac_mini_m2 kullanır — ücretsiz kotayla ~25 build/ay)
3. Bize haber ver, iOS workflow'unu `codemagic.yaml`'a ekleyelim

---

## 📞 Sık Sorulanlar

**S: Play Store'a yükleyecek miyim?**
C: Sadece kendin kullanacaksan **hayır**. `assembleDebug` çıktısı side-load ile yeterli.

**S: APK ne kadar yer kaplar?**
C: Sertex için ~8-12 MB.

**S: Uygulama offline çalışır mı?**
C: **Şu an hayır** — backend'e canlı bağlantı gerektiriyor. İleride Service Worker + IndexedDB ile offline cache eklenebilir.

**S: APK'yı arkadaşıma verebilir miyim?**
C: Teknik olarak evet, ama backend account gerekiyor (kullanıcı adı+şifre) — sen admin'sin, yeni kullanıcıyı oluşturursun.

---

**Kurulum tamamlandığında beni haberdar et — sıradaki iOS build'ine geçelim! 🚀**
