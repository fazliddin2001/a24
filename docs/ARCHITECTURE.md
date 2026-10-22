# Texnik Arxitektura va Model Tanlovi (Technical Architecture)

Ushbu hujjat **Andijon davlat chet tillari instituti (ADCHTI)** uchun ishlab chiqilgan raqamli ayol yordamchisi (avatar) loyihasining model tanlovi, AI Gateway, autentifikatsiya va animatsiya arxitekturasini batafsil yoritadi.

---

## 1. Model Tanlovi (Model Selection)

Loyiha talablariga muvofiq, eshitish (audio tahlil), fikrlash (mulohaza) va javobni ovozga aylantirish (TTS) uchun **Gemini oilasi** modellari tanlandi.

| Vazifa | Tavsiya etilgan Model | Parametrlar / Xususiyatlar | Nega aynan shu model? |
| :--- | :--- | :--- | :--- |
| **Eshitish va Fikrlash** *(Listening & Thinking)* | **`gemini-2.0-flash`** | Multimodal Audio Ingest (`audio/webm`, `audio/wav`), Thinking Tokens, System Prompt (1k-5k token) | O'zbek tilidagi og'zaki nutqni tashqi STT (Whisper) xatolarisiz to'g'ridan-to'g'ri akustik tahlil qiladi; tezkor fikrlaydi. |
| **Nutqqa aylantirish** *(TTS / Audio Generation)* | **`gemini-2.0-flash` (Audio Modality)** | `responseModalities: ["AUDIO"]`, `voiceConfig: "Aoede"` (yoki `"Kore"`) | Alohida qimmat TTS serverlarsiz Gemini oilasi doirasida o'zbekcha ifodali ayol ovozida nutq sintez qiladi. |

### 1.1. Eshitish va O'zbek Tili Muammosi Yechimi
- **Muammo:** Ko'plab standart STT (Speech-to-Text) vositalari o'zbek tilidagi sheva so'zlar, qisqartmalar ("kontraktim", "perevod", "dekanatga", "hemis ochmayapti") va noaniq mikrofonda xato qiladi.
- **Yechim (Direct Multimodal Audio Ingest):** Foydalanuvchi ovozi matnga aylantirilmasdan, to'g'ridan-to'g'ri `audio/webm` (base64) ko'rinishida `gemini-2.0-flash`ga yuboriladi. Gemini akustik signallarni to'g'ridan-to'g'ri o'zining ichki tokenlarida tahlil qiladi.
- **Prompt strategiyasi:** Tizim yo'riqnomasida (`data/system-prompt.js`) foydalanuvchilar o'zbek tilida so'zlashishi, fonetik noaniqliklar universitet kontekstida talqin qilinishi qat'iy belgilangan.

### 1.2. Fikrlash (Thinking Tokens) va Ularni Qirqib Tashlash (Stripping)
- Gemini modeliga savol yuborilganda, u institut nizomi va statistikasini tahlil qilish uchun ichki mulohaza olib borishi mumkin (`<thought>...</thought>`).
- **Serverless Worker darajasida qirqish:**
  ```javascript
  const thoughtMatch = rawAnswer.match(/<thought>([\s\S]*?)<\/thought>/i);
  const thoughtText = thoughtMatch ? thoughtMatch[1].trim() : '';
  const cleanText = rawAnswer.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
  ```
- **Natija:**
  1. `<thought>` mulohazasi TTS modeliga **hech qachon yuborilmaydi**, avatar faqat toza, odobli og'zaki matnni o'qiydi.
  2. Mulohaza matni frontendda xohishga ko'ra shaffoflik uchun *"✦ Fikrlash jarayoni"* tugmasi ostida ko'rsatilishi mumkin.

---

## 2. Cloudflare AI Gateway Arxitekturasi

Barcha AI so'rovlari Cloudflare AI Gateway orqali proksi qilinadi:

```
[Browser Client]
       │
       ▼ (HTTPS, a24.uz)
[Cloudflare Pages Functions / Middleware]
   - Cookie / Token autentifikatsiyasini tekshirish
   - Tizim prompti (1k-5k token)ni biriktirish
   - 3-4 turn kontekstini nazorat qilish
       │
       ▼ (Edge Proxy)
[Cloudflare AI Gateway]
   Endpoint: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/google-ai-studio/v1beta/...
   - Caching: Takroriy savollarga (masalan: "Fakultetlar qaysilar?") keshdan tezkor javob
   - Rate Limiting: Hujumlardan himoya
   - Observability: Token sarfi va kechikish monitoringi
       │
       ▼
[Google AI Studio: gemini-2.0-flash]
```

---

## 3. Autentifikatsiya (Serverless Single-Password Auth)

Foydalanuvchilar soni kam bo'lgani sababli murakkab ma'lumotlar bazasisiz (Postgres/MySQLsiz) xavfsiz autentifikatsiya yo'lga qo'yildi:

1. **Maxfiy Parol:** Cloudflare Pages muhitida `APP_PASSWORD` maxfiy kalit sifatida saqlanadi.
2. **Kirish Jarayoni (`POST /api/auth/login`):**
   - Foydalanuvchi parolni kiritadi.
   - Edge Worker parolni tekshiradi va Web Crypto API (`crypto.subtle`) yordamida **HMAC-SHA256** bilan imzolangan xavfsiz `a24_session` tokenini generatsiya qiladi.
   - Brauzerga `HttpOnly; Secure; SameSite=Strict; Max-Age=2592000` (30 kunlik) cookie o'rnatiladi.
3. **Edge Middleware Himoyasi (`functions/_middleware.js`):**
   - Barcha `/api/*` so'rovlari avtomatik ravishda tekshiriladi.
   - Noto'g'ri yoki yo'q token darhol `401 Unauthorized` bilan to'xtatiladi.
   - **Natija:** `GEMINI_API_KEY` foydalanuvchiga hech qachon ko'rinmaydi va begona shaxslar sizning API hisobingizdan foydalana olmaydi.

---

## 4. Kontekst Limiti (3-4 Turns Cache Management)

Institut bo'yicha 1k-5k tokenlik ma'lumot tizim promptida doimiy mavjud bo'lgani sababli, suhbat cho'zilishi xotirani to'ldirishi va javob tezligini sekinlashtirishi mumkin.
- Tizim har bir savol-javob siklini hisoblab boradi (`turnCount`).
- **4-navbatdan so'ng:** Suhbat tarixi tozalanadi (`resetConversation`), ammo universitet ma'lumotlari yangi toza kontekstda qayta boshlanadi.
- Frontendda navbat ko'rsatkichi (`1 / 4`) mavjud bo'lib, xohlagan paytda *"Yangi suhbat"* tugmasi orqali kontekstni yangilash mumkin.

---

## 5. Avatar Animatsiyasi va Holatlari

Avatar 4 ta aniq holatda ishlaydi:

1. **`idle` (Kutish):** Boshlang'ich holat, yengil nafas olish ritmi, og'iz yopiq (`--mouth-open: 0.16`), ko'rsatkich yashil.
2. **`listening` (Tinglash):** Foydalanuvchi mikrofon tugmasini bosganda faollashadi. Avatar atrofida yashil aura pulsatsiyasi va audio to'lqin vizualizatori ishga tushadi.
3. **`thinking` (Fikrlash):** Ovoz serverga yuborilganda va Gemini javob qaytarguncha binafsha rangli nurlanish va pulsatsiya.
4. **`speaking` (Gapirish):** TTS audio fayli o'ynalayotganda Web Audio API `AnalyserNode` ovoz amplitudasini real vaqt rejimida o'lchab, SVG og'iz shaklini ovoz ritmiga mos ravishda ochib-yopadi (`--mouth-open`).
