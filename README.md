# ADCHTI University AI Assistant — Raqamli Ovozli Yordamchi

Andijon davlat chet tillari instituti (ADCHTI) uchun maxsus ishlab chiqilgan, animatsiyalangan ayol avatari, ovozli muloqot va Gemini modellari bilan ishlovchi sun'iy intellekt assistenti.

## Asosiy Imkoniyatlar

- **Ovozli Muloqot (Audio-in / Audio-out):** Foydalanuvchi ovozi bevosita `gemini-2.0-flash` multimodal modeli tomonidan tahlil qilinadi. Tashqi STT (Whisper) xatolarisiz o'zbek tili fonetikasi tabiiy qabul qilinadi.
- **Interaktiv Avatar Animatsiyalari:**
  - `idle`: Tinch holat, yengil nafas olish.
  - `listening`: Mikrofon faollashganda yashil aura va to'lqin vizualizatsiyasi.
  - `thinking`: AI fikrlayotganda binafsha nurlanish va pulsatsiya.
  - `speaking`: TTS audio yangraganda Web Audio API amplitudasiga asoslangan lab harakati (lip-sync).
- **Fikrlash (Thinking Tokens) Qirqilishi:** Gemini'ning ichki fikrlash jarayoni serverless darajasida ajratib olinadi va ovozli o'qishga yuborilmaydi.
- **Kontekst Limiti Boshqaruvi:** 1k-5k tokenlik universitet ma'lumotlari hisobga olingan holda, har 3-4 savol-javobdan so'ng kontekst avtomatik yangilanadi.
- **Serverless Xavfsizlik va Autentifikatsiya:**
  - Bir dona maxfiy parol (`APP_PASSWORD`).
  - Ma'lumotlar bazasisiz HMAC-SHA256 xavfsiz sessiya cookie tizimi.
  - `GEMINI_API_KEY` Cloudflare Edge darajasida to'liq yashiringan.
- **Cloudflare AI Gateway Integratsiyasi:** Keshlashtirish, tezkorlik, monitoring va limitlar boshqaruvi.

## Loyiha Tuzilishi

```
d:\a24/
├── public/                 # Cloudflare Pages statik frontend
│   ├── index.html          # Asosiy UI (Avatar, chat, audio boshqaruv)
│   ├── css/
│   │   └── style.css       # Responsive dizayn va animatsiyalar
│   ├── js/
│   │   ├── app.js          # Asosiy dastur boshqaruvchisi
│   │   ├── avatar.js       # Avatar holatlari (idle, listening, thinking, speaking)
│   │   ├── audio.js        # Mikrofon yozish va real-vaqt lab sinxronizatsiyasi
│   │   └── auth.js         # Yagona parol bilan kirish boshqaruvi
│   └── assets/             # Avatar rasmlari va portretlar
├── functions/              # Cloudflare Pages Functions (Edge serverless API)
│   ├── _middleware.js      # Barcha /api/ so'rovlarini himoyalovchi autentifikatsiya
│   ├── api/
│   │   ├── auth/           # Login, sessiya tekshirish va chiqish
│   │   ├── chat.js         # Gemini 2.0 Flash tahlili, fikrlashni qirqish va TTS
│   │   └── tts.js          # Alohida matnni ovozga aylantirish (Aoede/Kore)
│   └── utils/
│       └── crypto.js       # HMAC-SHA256 Web Crypto token vositasi
├── data/
│   ├── university-context.json # ADCHTI statistikasi, fakultetlar va ma'lumotlari
│   └── system-prompt.js        # O'zbek tili va qoidalari bilan boyitilgan tizim prompti
├── docs/
│   ├── ARCHITECTURE.md     # Batafsil texnik arxitektura va model tanlovi
│   └── DEPLOYMENT.md       # GitHub, Cloudflare va A24.uz sozlash qo'llanmasi
└── wrangler.toml           # Cloudflare konfiguratsiyasi
```

Batafsil arxitektura uchun [docs/ARCHITECTURE.md](file:///d:/a24/docs/ARCHITECTURE.md) va o'rnatish uchun [docs/DEPLOYMENT.md](file:///d:/a24/docs/DEPLOYMENT.md) fayllariga qarang.
