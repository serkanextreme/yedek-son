"""
Sertex Feature List PDF Generator
Generates a beautifully formatted Turkish PDF of all 48 features.
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register Turkish-supporting fonts
pdfmetrics.registerFont(TTFont('LibSans', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('LibSans-Bold', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('LibSans-Italic', '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf'))
pdfmetrics.registerFont(TTFont('LibSerif-Bold', '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf'))

# Colors — futuristic dark theme accents
CYAN = HexColor("#00E5FF")
DARK_BG = HexColor("#0A1929")
LIGHT_TEXT = HexColor("#E3F2FD")
GOLD = HexColor("#FFD700")
RED = HexColor("#EF4444")
ORANGE = HexColor("#F59E0B")
YELLOW = HexColor("#EAB308")
GREEN = HexColor("#22C55E")
PURPLE = HexColor("#A855F7")
BLUE = HexColor("#3B82F6")
GRAY_LIGHT = HexColor("#F1F5F9")
GRAY_MID = HexColor("#64748B")
GRAY_DARK = HexColor("#1E293B")

styles = getSampleStyleSheet()

# Custom styles
title_style = ParagraphStyle(
    'Title', parent=styles['Title'],
    fontName='LibSerif-Bold', fontSize=32, textColor=CYAN,
    alignment=TA_CENTER, spaceAfter=6, leading=38
)

subtitle_style = ParagraphStyle(
    'Subtitle', parent=styles['Normal'],
    fontName='LibSans-Italic', fontSize=14, textColor=GRAY_MID,
    alignment=TA_CENTER, spaceAfter=20
)

section_style = ParagraphStyle(
    'Section', parent=styles['Heading1'],
    fontName='LibSans-Bold', fontSize=18, textColor=CYAN,
    spaceBefore=16, spaceAfter=10, leading=22,
    borderPadding=6, leftIndent=0
)

category_style = ParagraphStyle(
    'Category', parent=styles['Heading2'],
    fontName='LibSans-Bold', fontSize=14, textColor=GOLD,
    spaceBefore=12, spaceAfter=6, leading=18
)

feature_num_style = ParagraphStyle(
    'FeatureNum', parent=styles['Normal'],
    fontName='LibSans-Bold', fontSize=11, textColor=CYAN,
    leading=15
)

feature_title_style = ParagraphStyle(
    'FeatureTitle', parent=styles['Normal'],
    fontName='LibSans-Bold', fontSize=11, textColor=black,
    leading=15
)

feature_desc_style = ParagraphStyle(
    'FeatureDesc', parent=styles['Normal'],
    fontName='LibSans', fontSize=10, textColor=GRAY_DARK,
    leading=13, spaceAfter=8, leftIndent=18
)

body_style = ParagraphStyle(
    'Body', parent=styles['Normal'],
    fontName='LibSans', fontSize=10, textColor=black,
    leading=14, alignment=TA_JUSTIFY, spaceAfter=6
)

quote_style = ParagraphStyle(
    'Quote', parent=styles['Normal'],
    fontName='LibSans-Italic', fontSize=11, textColor=GRAY_MID,
    leading=16, alignment=TA_CENTER, spaceAfter=12
)


def priority_badge(label, color):
    """Small colored priority badge"""
    return f'<font name="LibSans-Bold" color="{color.hexval()[2:]}" size="10">{label}</font>'


# ============================================================
# BUILD THE PDF
# ============================================================
def build_pdf(output_path):
    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        rightMargin=1.8*cm, leftMargin=1.8*cm,
        topMargin=2*cm, bottomMargin=2*cm,
        title="Sertex - Tam Feature Listesi",
        author="Serkan & Sertex AI"
    )

    story = []

    # ===== COVER =====
    story.append(Spacer(1, 3*cm))
    story.append(Paragraph("SERTEX", ParagraphStyle(
        'Cover', fontName='LibSerif-Bold', fontSize=64,
        textColor=CYAN, alignment=TA_CENTER, leading=70
    )))
    story.append(Paragraph("Kişisel Yapay Zeka Asistanı", ParagraphStyle(
        'CoverSub', fontName='LibSans-Italic', fontSize=18,
        textColor=GOLD, alignment=TA_CENTER, spaceAfter=30
    )))
    story.append(Spacer(1, 1*cm))
    story.append(Paragraph("Tam Fonksiyon &amp; Özellik Listesi", ParagraphStyle(
        'CoverTitle', fontName='LibSans-Bold', fontSize=22,
        textColor=black, alignment=TA_CENTER, spaceAfter=12
    )))
    story.append(Paragraph("47 Feature — Yol Haritası &amp; Vizyon Belgesi", ParagraphStyle(
        'CoverDesc', fontName='LibSans', fontSize=13,
        textColor=GRAY_MID, alignment=TA_CENTER, spaceAfter=40
    )))
    story.append(Spacer(1, 2*cm))

    # Owner card
    owner_data = [
        ['SAHİP', 'Serkan'],
        ['PROJE ADI', 'Sertex AI'],
        ['DOMAIN', 'sertex-ai.com'],
        ['VİZYON', 'Türkiye\'nin en gelişmiş kişisel AI asistanı'],
        ['MODEL', 'Kişisel + Ticari SaaS'],
    ]
    owner_table = Table(owner_data, colWidths=[4*cm, 10*cm])
    owner_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (0,-1), DARK_BG),
        ('BACKGROUND', (1,0), (1,-1), GRAY_LIGHT),
        ('TEXTCOLOR', (0,0), (0,-1), CYAN),
        ('TEXTCOLOR', (1,0), (1,-1), black),
        ('FONTNAME', (0,0), (0,-1), 'LibSans-Bold'),
        ('FONTNAME', (1,0), (1,-1), 'LibSans'),
        ('FONTSIZE', (0,0), (-1,-1), 11),
        ('ALIGN', (0,0), (0,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('TOPPADDING', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ]))
    story.append(owner_table)
    story.append(PageBreak())

    # ===== INTRO =====
    story.append(Paragraph("Sertex Nedir?", section_style))
    story.append(Paragraph(
        "Sertex, Serkan için özel olarak inşa edilmiş, "
        "yapay zeka destekli kişisel asistan platformudur. Sohbet, sesli komut, görev yönetimi, "
        "dosya analizi, akıllı ev kontrolü, mail yönetimi, CAD-CAM otomasyonu ve daha fazlasını "
        "tek bir arayüzde birleştirir. Web, Windows kurulum dosyası ve mobil uygulama olarak çalışır. "
        "Kendi kendine öğrenir, seni hatırlar, tanır ve zaman geçtikçe daha akıllı hale gelir.",
        body_style
    ))
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph(
        '<i>"Sertex sadece bir yazılım değil — bir dost, süper bilgisayar ve süper görev bitiricidir."</i>',
        quote_style
    ))
    story.append(Spacer(1, 0.3*cm))

    # ===== ALREADY DONE =====
    story.append(Paragraph("HALİHAZIRDA TAMAMLANMIŞ ÖZELLİKLER", section_style))
    story.append(Paragraph("Mevcut Sertex Sürümü — Aktif ve Çalışır Durumda", 
                          ParagraphStyle('done_sub', parent=body_style, fontName='LibSans-Italic',
                                       textColor=GREEN, spaceAfter=10)))

    done_features = [
        ("3D Holografik Küre", "Iron Man tarzı animasyonlu ana arayüz (Three.js)"),
        ("Çoklu Kullanıcı Auth (JWT)", "Admin ve normal kullanıcı rolleri, güvenli oturum yönetimi"),
        ("GPT-5.2 Sohbet", "Emergent LLM Key ile OpenAI GPT-5.2 entegrasyonu"),
        ("Web Speech STT", "Chrome tarayıcıda mikrofon ile ses tanıma"),
        ("OpenAI TTS", "Sertex'in sesli cevap vermesi"),
        ("Sürüklenebilir HUD Panelleri", "Yeniden boyutlandırılabilir, konumlandırılabilir arayüz"),
        ("Not Sistemi", "Kişisel notlar oluşturma, düzenleme, silme"),
        ("Takvim & Hatırlatıcılar", "Etkinlik yönetimi ve otomatik bildirim"),
        ("Sohbet Geçmişi", "Tüm konuşmaların kalıcı kaydı ve arama"),
        ("Gelişmiş Görev Sistemi", "Alt görevler, sürükle-bırak, otomatik numaralandırma, arşiv, tarih, hatırlatıcı"),
    ]
    for name, desc in done_features:
        story.append(Paragraph(
            f'<font color="#22C55E">■</font> <b>{name}</b> — <font color="#64748B">{desc}</font>',
            ParagraphStyle('done_item', parent=body_style, leftIndent=10, spaceAfter=4)
        ))

    story.append(PageBreak())

    # ===== FEATURE ROADMAP =====
    story.append(Paragraph("YOL HARİTASI &amp; YENİ ÖZELLİKLER", section_style))
    story.append(Paragraph(
        "Aşağıdaki 47 özellik, öncelik seviyelerine göre gruplanmıştır. "
        "P0 = Hemen yapılacak, P1 = MVP için kritik, P2 = Premium özellikler.",
        body_style
    ))
    story.append(Spacer(1, 0.3*cm))

    # ---- P0 ----
    story.append(Paragraph("🔴 P0 — HEMEN YAPILACAKLAR (Sıradaki İş)", category_style))

    p0_features = [
        ("1", "Uzun Süreli Hafıza", 
         "Sertex seni tanır ve sohbetler arası bilgileri hatırlar. Otomatik çıkarım (LLM konuşmadan önemli bilgileri kaydeder), manuel komut ('Bunu hatırla: X') ve hafıza yönetim paneli. MongoDB'de kalıcı depolama."),
        ("2", "Whisper STT (Hibrit Ses Tanıma)", 
         "OpenAI Whisper entegrasyonu ile Firefox ve mobil mikrofon sorunu çözülür. Chrome'da native Web Speech, diğer tarayıcılarda Whisper fallback."),
        ("3", "Tüm Dosya Formatları Okuma & Özet", 
         "PDF, Word, Excel, PowerPoint, TXT, CSV, JSON, XML, MD dosyaları oku. Resimleri GPT-5.2 Vision ile analiz et. Ses dosyalarını Whisper ile transkript. Video için ses çıkar + kare analizi. Yüklenen dosya için özet, soru-cevap ve analiz."),
    ]
    for num, name, desc in p0_features:
        story.append(Paragraph(f'<font color="#EF4444"><b>[{num}]</b></font> <b>{name}</b>', feature_title_style))
        story.append(Paragraph(desc, feature_desc_style))

    # ---- P1 ----
    story.append(Paragraph("🟠 P1 — ÖNEMLİ (Ticari MVP)", category_style))

    p1_features = [
        ("4", "RAG - Sana Özel Bilgi Bankası",
         "Sertex'i kitaplar ve belgelerle 'eğit'. Örnek: Java programlama kitabı yükle, Sertex Java bilgisiyle kod yazsın. Her kullanıcının kendi vektör veritabanı, izole ve şifreli."),
        ("5", "Excel Otomasyonu",
         "Formül yazma (SUMIF, VLOOKUP, INDEX-MATCH), pivot table oluşturma, veri analizi, grafik ekleme. openpyxl + pandas + GPT-5.2 ile."),
        ("6", "Cloud Server + Otomatik Yedekleme",
         "Sertex kendi cloud sunucusuna otomatik ve şifreli yedek alır. Günlük/haftalık/aylık versiyonlu yedekler. Tek tıkla geri yükleme. MongoDB, dosyalar, RAG bilgi bankası — hepsi dahil."),
        ("7", "License Sistemi (CD-Key + Hardware Lock)",
         "Ticari satış için: kullanıcı adı + şifre + CD-Key + hardware fingerprint 4 katmanlı doğrulama. Admin panelden key üretme, iptal etme, süre yönetimi. 1 key = 1 PC kuralı."),
        ("8", "Windows Setup (.exe)",
         "Electron ile React + FastAPI paketleme. Kullanıcı Sertex-Setup.exe indirir, Next-Next-Finish kurulum. Düşük donanımlı PC'lerde bile çalışır."),
        ("9", "Offline Mode + Auto-Update + Sync",
         "İnternet yokken local SQLite ile çalışır. İnternet gelince cloud ile otomatik senkron. Electron auto-updater ile arka planda güncelleme (Chrome gibi)."),
        ("10", "Gmail / Outlook Entegrasyonu",
         "Kritik mailleri özetle, otomatik cevap taslağı oluştur, faturaları oku ve tutarları çıkart. Google Gmail API + Microsoft Graph API."),
        ("11", "Tam PC Kontrolü",
         "Dosya taşıma, klasör yedekleme, program açma/kapama, sistem komutları. Kritik komutlarda onay penceresi. CPU/RAM/disk analizi."),
        ("12", "Akıllı Ev (Home Assistant + Tapo)",
         "3000+ akıllı cihaz desteği. TP-Link Tapo, Philips Hue, kahve makinesi, klima, robot süpürge, TV, kilit, kamera, jaluzi, garaj kapısı. Sesli komutla kontrol."),
        ("13", "PWA (Progressive Web App)",
         "Telefonda 'Ana ekrana ekle' → uygulama gibi çalışır. iOS ve Android'de yüklenebilir, offline destekli."),
    ]
    for num, name, desc in p1_features:
        story.append(Paragraph(f'<font color="#F59E0B"><b>[{num}]</b></font> <b>{name}</b>', feature_title_style))
        story.append(Paragraph(desc, feature_desc_style))

    story.append(PageBreak())

    # ---- P2 ----
    story.append(Paragraph("🟡 P2 — DEĞERLİ (Premium Özellikler)", category_style))

    p2_features = [
        ("14", "LM Studio Hibrit AI (Cloud + Local)",
         "İki mod destekli: (1) Kullanıcı kendi PC'sine LM Studio kurar ve yerel LLM çalıştırır (tam gizlilik, offline), (2) Kurmak istemeyenler için BİZİM cloud sunucumuzda barındırılan LM Studio'ya internet üzerinden bağlanır (SaaS gibi). Sertex duruma göre bulut LLM (GPT-5.2) ile yerel/cloud LM Studio arasında otomatik seçim yapar."),
        ("15", "Multi-Tenant Global SaaS",
         "10.000+ kullanıcıya hazır izole altyapı. Her kullanıcının kendi DB'si, hafızası, RAG'ı."),
        ("16", "Süper Bilgisayar Altyapısı",
         "Kendi GPU cluster'ın ile yerel LLM'ler çalıştırma (ileri seviye, dedicated server)."),
        ("17", "Kullanıcı Aktivite DB (Sadece Admin)",
         "Her kullanıcının şifreli, izole aktivite kaydı. Sadece sen (admin) master key ile erişebilirsin. Analytics dashboard."),
        ("18", "Otonom Öğrenme",
         "Sertex bilmediği bir konuda web'de araştırma yapar, cevabı bulur ve kendi bilgi bankasına kaydeder. Continuous learning + Self-RAG."),
        ("19", "Sertex'in Kendi Sesi & Kişiliği",
         "ElevenLabs ile özel ses klonu. Ruh hali sistemi, espri anlayışı, konuşma stiline uyum."),
        ("20", "Sinematik Uyanma Sekansı",
         "Iron Man tarzı boot animasyonu. Sabah brief'i (mailler, hava, toplantılar) ve gece özeti."),
        ("21", "Takvim + Toplantı AI",
         "Google Calendar / Outlook. Zoom / Meet canlı transkript + otomatik özet + action items."),
        ("22", "Finans Takibi",
         "Banka SMS okuma, harcama analizi, fatura hatırlatıcıları, kripto/borsa portföy takibi."),
        ("23", "Web Otomasyonu (RPA)",
         "Playwright ile otomatik sipariş, form doldurma, veri toplama. 'Trendyol'da şu ürünü sipariş et' → yapar."),
        ("24", "React Native Mobile App",
         "iOS ve Android için gerçek yerel uygulama. App Store ve Google Play üzerinden dağıtım."),
        ("25", "Sağlık Asistanı",
         "Apple Watch, Fitbit, Xiaomi Mi Band entegrasyonu. Adım, uyku, kalp ritmi, ilaç takibi."),
        ("26", "Yemek & Beslenme",
         "Buzdolabı görüntü analizi ile tarif önerisi. Kalori takibi. Yemeksepeti / Getir siparişi."),
        ("27", "Görsel Üretim & Düzenleme",
         "Gemini Nano Banana, GPT Image 1, Sora 2 video. Logo tasarımı, arka plan silme, video oluşturma."),
        ("28", "Müzik & Ses",
         "Spotify kontrolü + AI DJ. Ruh haline göre çalma listesi. ElevenLabs ile podcast seslendirme."),
        ("29", "İçerik Yazarı",
         "SEO uyumlu blog yazısı, YouTube script, sosyal medya postu. Otomatik Twitter/LinkedIn paylaşımı."),
        ("30", "Enterprise Security",
         "AES-256 end-to-end şifreleme, 2FA / Biometric giriş, panik butonu, şüpheli aktivite alarmı."),
        ("31", "Kişisel Siber Güvenlik",
         "Şifre yöneticisi, HaveIBeenPwned breach kontrolü, phishing tespiti."),
        ("32", "Uzman Modu",
         "'Bugün avukat gibi davran' / 'doktor gibi konuş' / 'muhasebeci ol'. Rolüne göre uzman bilgi bankası yükler."),
        ("33", "Hedef Takibi & Koçluk",
         "Hayat koçu + iş koçu + fitness koçu hepsi bir arada. Kilo verme, dil öğrenme, kariyer hedefleri için günlük plan."),
        ("34", "Aile / Ekip Modu",
         "Ev üyeleri için ortak profiller (baba/anne/çocuk). Ortak takvim, alışveriş, ödev takibi. Şirket için ekip modu."),
        ("35", "Proaktif Zeka",
         "Sen sormadan Sertex konuşur: 'Serkan, saat 23:00, yarın toplantın var, uyusan?' Gerçek asistanı sıradan bir chatbottan ayıran özellik."),
    ]
    for num, name, desc in p2_features:
        story.append(Paragraph(f'<font color="#EAB308"><b>[{num}]</b></font> <b>{name}</b>', feature_title_style))
        story.append(Paragraph(desc, feature_desc_style))

    story.append(PageBreak())

    # ---- COMMERCIAL ----
    story.append(Paragraph("💰 TİCARİ (SaaS Modeli)", category_style))
    commercial = [
        ("36", "SaaS Abonelik Modeli",
         "Free tier (günde 20 mesaj), Basic ($9/ay), Pro ($29/ay), Enterprise ($99/ay), Lifetime ($499). Stripe ile otomatik ödeme."),
        ("37", "Admin Dashboard",
         "Kullanıcı sayısı, aylık gelir, aktif kullanıcı, feature kullanımı, churn analizi, key yönetimi."),
        ("38", "Çoklu Dil Desteği",
         "Türkçe + İngilizce + Almanca + İspanyolca + Arapça. Otomatik çeviri ile global pazar."),
        ("39", "Referral / Affiliate Sistemi",
         "Davet ile %30 komisyon veya 1 ay bedava. Viral büyüme motoru."),
    ]
    for num, name, desc in commercial:
        story.append(Paragraph(f'<font color="#A855F7"><b>[{num}]</b></font> <b>{name}</b>', feature_title_style))
        story.append(Paragraph(desc, feature_desc_style))

    # ---- FUN ----
    story.append(Paragraph("🎨 DELİ &amp; EĞLENCELİ (Farklılaşma)", category_style))
    fun = [
        ("40", "Rüya Günlüğü",
         "Rüya yorumu ve zaman içindeki desen analizi."),
        ("41", "Duygu Analizi",
         "Ses tonundan stres tespiti. Stresli olduğunda meditasyon önerisi."),
        ("42", "Karar Verici",
         "İki seçenek arasında veri odaklı öneride bulunur."),
        ("43", "Anonymous Mode",
         "Bir tuşla tüm kayıtları siler, iz bırakmaz. Gizli görüşmeler için."),
    ]
    for num, name, desc in fun:
        story.append(Paragraph(f'<font color="#3B82F6"><b>[{num}]</b></font> <b>{name}</b>', feature_title_style))
        story.append(Paragraph(desc, feature_desc_style))

    # ---- INDUSTRIAL ----
    story.append(Paragraph("⚙️ MESLEKİ / ENDÜSTRİYEL (Senin Alanın!)", category_style))
    industrial = [
        ("44", "CAD-CAM Otomasyonu (Siemens NX)",
         "3D çizimi ver, Sertex Siemens NX'te otomatik CAM yapsın. NX Open API ile takım seçimi, tool path, feed/speed hesaplama, simülasyon, G-Code üretim, post-process, setup sheet. Fusion 360, SolidWorks CAM, Mastercam desteği de eklenebilir. B2B milyonluk potansiyel — Türkiye'deki fabrikalara $500-2000/ay satılabilir."),
    ]
    for num, name, desc in industrial:
        story.append(Paragraph(f'<font color="#EF4444"><b>[{num}]</b></font> <b>{name}</b> ⭐ PREMIUM ENTERPRISE — <font color="#EF4444"><b>EN SON YAPILACAK</b></font>', feature_title_style))
        story.append(Paragraph(desc, feature_desc_style))

    # ---- VOICE ----
    story.append(Paragraph("🔊 SES", category_style))
    story.append(Paragraph(f'<font color="#22C55E"><b>[45]</b></font> <b>Wake Word ("Hey Sertex")</b>', feature_title_style))
    story.append(Paragraph("Elleri kirli / uzaktan konuşma. Sürekli arka plan dinleme ile 'Hey Sertex' dediğinde aktifleşir.", feature_desc_style))

    # ---- ANIMATION ----
    story.append(Paragraph("🎉 GÖRSEL / ANİMASYON", category_style))
    story.append(Paragraph(f'<font color="#22C55E"><b>[46]</b></font> <b>Görev Tamamlama Animasyonu</b>', feature_title_style))
    story.append(Paragraph("Bir görev tamamlandığında neon parıltı efekti + memnun edici ses.", feature_desc_style))

    # ---- REMOTE ----
    story.append(Paragraph("🖥️ UZAK KONTROL (Yasal)", category_style))
    story.append(Paragraph(f'<font color="#22C55E"><b>[47]</b></font> <b>Remote Command Center</b>', feature_title_style))
    story.append(Paragraph(
        "Kendi cihazlarına uzak masaüstü bağlantısı (TeamViewer alternatifi). Multi-device senkronizasyon. "
        "Kişisel siber güvenlik (mail, şifre, 2FA yönetimi). Kendi sistemlerin için ethical security scanning. "
        "Ağ yönetimi. Sadece sana ait cihazlar üzerinde — tamamen yasal.",
        feature_desc_style
    ))

    story.append(PageBreak())

    # ===== TIMELINE =====
    story.append(Paragraph("TAHMİNİ ZAMAN ÇİZELGESİ", section_style))
    timeline_data = [
        ['Aşama', 'Süre', 'Sonuç'],
        ['MVP (Satılabilir Sürüm)', '6-8 hafta', 'Sertex\'i ticari olarak satabilirsin'],
        ['Full Premium', '4-6 ay', 'Rakiplerin çok gerisinde kalır'],
        ['Enterprise (CAD-CAM dahil)', '8-12 ay', 'Fabrikalara ve şirketlere satış'],
    ]
    timeline_table = Table(timeline_data, colWidths=[6*cm, 3*cm, 8*cm])
    timeline_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), DARK_BG),
        ('TEXTCOLOR', (0,0), (-1,0), CYAN),
        ('FONTNAME', (0,0), (-1,0), 'LibSans-Bold'),
        ('FONTNAME', (0,1), (-1,-1), 'LibSans'),
        ('FONTSIZE', (0,0), (-1,-1), 10),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [GRAY_LIGHT, white]),
        ('GRID', (0,0), (-1,-1), 0.5, GRAY_MID),
    ]))
    story.append(timeline_table)

    story.append(Spacer(1, 0.5*cm))

    # ===== ROADMAP ORDER =====
    story.append(Paragraph("ÖNERİLEN GELİŞTİRME SIRASI", section_style))
    roadmap_steps = [
        ("1", "ÖNCE BEYİN", "Hafıza (1) + Whisper (2) + Dosya (3) + RAG (4) — Sertex 'gerçek zeki' olur"),
        ("2", "SONRA TİCARET", "Cloud (6) + License (7) + Setup (8) + Offline (9) — Satışa hazır"),
        ("3", "SÜPER GÜÇLER", "Mail (10) + PC (11) + Ev (12) + Proaktif (35) — WOW efekti"),
        ("4", "FARK YARATANLAR", "Uzman modu (32) + Koçluk (33) + Aile modu (34) — Premium fiyat"),
        ("5", "MOBİL &amp; GLOBAL", "React Native (24) + Multi-tenant (15) — Global ölçek"),
        ("6", "EN SON: CAD-CAM", "Siemens NX otomasyonu (44) — B2B endüstriyel gelir kapısı"),
    ]
    for step, title, desc in roadmap_steps:
        story.append(Paragraph(
            f'<font color="#00E5FF" size="16"><b>{step}.</b></font> <font size="12"><b>{title}</b></font><br/><font color="#64748B" size="10">{desc}</font>',
            ParagraphStyle('road', parent=body_style, leading=18, spaceAfter=10, leftIndent=10)
        ))

    story.append(Spacer(1, 1*cm))

    # ===== TECH STACK =====
    story.append(Paragraph("TEKNOLOJİ YIĞINI", section_style))
    tech_data = [
        ['Katman', 'Teknoloji'],
        ['Frontend', 'React 18, TailwindCSS, Three.js, Framer Motion, React-RND'],
        ['Backend', 'FastAPI (Python), Motor (async MongoDB), PyJWT'],
        ['Database', 'MongoDB (primary), SQLite (local/offline)'],
        ['AI / LLM', 'OpenAI GPT-5.2, Whisper STT, TTS (Emergent LLM Key)'],
        ['Görsel/Video', 'Gemini Nano Banana, GPT Image 1, Sora 2'],
        ['Ses', 'OpenAI TTS, ElevenLabs (özel ses)'],
        ['Ödeme', 'Stripe (SaaS abonelik)'],
        ['Deployment', 'Emergent Platform → Kendi VPS (opsiyonel)'],
        ['Mobile', 'PWA (P1) → React Native (P2)'],
        ['Desktop', 'Electron (Windows .exe)'],
        ['Akıllı Ev', 'Home Assistant + PyP100 (Tapo)'],
        ['CAD-CAM', 'Siemens NX Open API (Python)'],
    ]
    tech_table = Table(tech_data, colWidths=[4*cm, 13*cm])
    tech_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), DARK_BG),
        ('TEXTCOLOR', (0,0), (-1,0), CYAN),
        ('FONTNAME', (0,0), (-1,0), 'LibSans-Bold'),
        ('FONTNAME', (0,1), (-1,-1), 'LibSans'),
        ('FONTNAME', (0,1), (0,-1), 'LibSans-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [GRAY_LIGHT, white]),
        ('GRID', (0,0), (-1,-1), 0.3, GRAY_MID),
    ]))
    story.append(tech_table)

    story.append(PageBreak())

    # ===== ARCHITECTURE ====
    story.append(Paragraph("ÇEKİRDEK MİMARİ (Lego Prensibi)", section_style))
    story.append(Paragraph(
        "Sertex, modüler bir mimariyle kurulur. Her feature ayrı bir 'Lego bloğu' modülüdür. "
        "Yeni feature eklerken çekirdek asla değişmez — sadece yeni bir modül eklenir. "
        "Bu sayede projede asla 'başa dönüş' yaşanmaz. Her yeni özellik önceki üzerine kurulur.",
        body_style
    ))
    story.append(Spacer(1, 0.3*cm))

    arch_items = [
        ("Event Bus", "Modüller birbirleriyle direkt konuşmaz — merkezi mesaj sistemi üzerinden konuşur. Bir modül değişse diğerleri etkilenmez."),
        ("LLM Router", "GPT-5.2, Claude, Gemini, LM Studio arasında otomatik geçiş. Yeni LLM çıkarsa 5 satır ekleme yeter."),
        ("Database Abstraction", "MongoDB → PostgreSQL → SQLite geçişi 1 dosya değişikliği ile yapılır."),
        ("Feature Flags", "Her feature aç/kapat switch'i ile. Aynı Sertex farklı kullanıcılarda farklı özellik seti gösterir (premium paketleri)."),
        ("Otomatik Testler", "Her modülün pytest testi var. Yeni feature eklerken eskiler bozulmaz."),
        ("Migration Sistemi", "DB şeması değişse eski veriler otomatik güncellenir, kayıp olmaz."),
        ("Multi-Tenant Ready", "Baştan 10.000 kullanıcıya hazır izole altyapı."),
        ("Micro-Frontend", "Frontend'de her modülün kendi klasörü. Manifest.json ile menüye otomatik eklenir."),
    ]
    for name, desc in arch_items:
        story.append(Paragraph(
            f'<font color="#00E5FF">◆</font> <b>{name}</b> — <font color="#64748B">{desc}</font>',
            ParagraphStyle('arch_item', parent=body_style, leftIndent=10, spaceAfter=5)
        ))

    story.append(Spacer(1, 0.5*cm))

    # ===== FINAL WORDS =====
    story.append(Paragraph("KAPANIŞ NOTU", section_style))
    story.append(Paragraph(
        "<i>\"Sertex, sıradan bir yazılım değildir. Serkan\'ın en gelişmiş kişisel AI asistanını "
        "inşa etme vizyonunun somutlaşmış halidir. Bu belgede yazan 47 özellik, aylara yayılarak ama sistematik olarak "
        "hayata geçirilecektir. Sertex bir dost, süper bilgisayar ve süper görev bitiricidir. Ve o SANA aittir.\"</i>",
        quote_style
    ))
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph(
        '<font color="#00E5FF" size="14"><b>— Sertex AI Ekibi</b></font>',
        ParagraphStyle('sig', parent=body_style, alignment=TA_CENTER, spaceAfter=6)
    ))
    story.append(Paragraph(
        '<font color="#64748B" size="10"><i>Bu belge Sertex projesinin resmi feature listesidir.</i></font>',
        ParagraphStyle('sig2', parent=body_style, alignment=TA_CENTER)
    ))

    # Build
    doc.build(story)
    print(f"✅ PDF created: {output_path}")


if __name__ == "__main__":
    import os
    output_dir = "/app/frontend/public"
    os.makedirs(output_dir, exist_ok=True)
    build_pdf(f"{output_dir}/Sertex-Feature-Listesi.pdf")
