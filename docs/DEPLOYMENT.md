# O'rnatish va Joylashtirish Qo'llanmasi (Deployment Guide)

Ushbu qo'llanma loyihani **GitHub** orqali **Cloudflare Pages**ga ulash, **Cloudflare AI Gateway**ni sozlash va **A24.uz** domeniga bog'lash qadamlarini tushuntiradi.

---

## 1-qadam: GitHub Repozitoriyani Yaratish va Kodni Yuklash

Loyiha papkasida (`d:\a24`):

```bash
# Git-ni initsializatsiya qilish
git init
git add .
git commit -m "feat: ADCHTI University AI assistant with animated avatar"

# GitHub-dagi repozitoriyangizga ulash (masalan: a24-assistant)
git branch -M main
git remote add origin https://github.com/SIZNING_PROFILINGIZ/a24-assistant.git
git push -u origin main
```

---

## 2-qadam: Cloudflare AI Gateway Sozlash

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)ga kiring.
2. Chap menyudan **AI** > **AI Gateway** bo'limiga o'ting.
3. **Create Gateway** tugmasini bosing:
   - **Gateway Name:** `adchti-gemini-gateway`
   - Provayder: **Google AI Studio**
4. Yaratilgandan so'ng, sizga quyidagi ma'lumotlar beriladi:
   - `CLOUDFLARE_ACCOUNT_ID` (Dashboard o'ng tomonida yoki URL-da)
   - `AI_GATEWAY_NAME`: `adchti-gemini-gateway`

---

## 3-qadam: Cloudflare Pages-ga Ulash

1. Cloudflare Dashboard-da **Compute (Workers & Pages)** > **Pages** bo'limiga o'ting.
2. **Connect to Git** tugmasini bosing va GitHub-dagi `a24-assistant` repozitoriyasini tanlang.
3. Sozlamalar:
   - **Project Name:** `adchti-assistant` (yoki xohlagan nomingiz)
   - **Production branch:** `main`
   - **Framework preset:** `None`
   - **Build command:** *(bo'sh qoldiring yoki `echo 'Ready'`)*
   - **Build output directory:** `public`
4. **Save and Deploy** tugmasini bosing.

---

## 4-qadam: Maxfiy Kalitlar (Secrets & Environment Variables)

Cloudflare Pages boshqaruv panelida:
**Settings** > **Environment Variables** bo'limiga kiring va quyidagi kalitlarni qo'shing:

| O'zgaruvchi Nomi | Turi | Tavsif / Qiymat |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | **Secret** (Encrypt) | Google AI Studio dan olingan Gemini API kaliti |
| `APP_PASSWORD` | **Secret** (Encrypt) | Tizimga kirish uchun yagona maxfiy parol (masalan: `Adchti#2026!`) |
| `SESSION_SECRET` | **Secret** (Encrypt) | Sessiya tokenlarini imzolash uchun tasodifiy satr (masalan: `c89f2a4e...`) |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Cloudflare hisob raqamingiz (Account ID) |
| `AI_GATEWAY_NAME` | Variable | `adchti-gemini-gateway` |
| `GEMINI_MODEL` | Variable | `gemini-2.0-flash` |
| `GEMINI_VOICE` | Variable | `Aoede` (yoki `Kore`) |

*Eslatma:* Agar `CLOUDFLARE_ACCOUNT_ID` yoki `AI_GATEWAY_NAME` kiritilmasa, tizim avtomatik ravishda to'g'ridan-to'g'ri Google AI Studio API-ga ulanib ishlayveradi (fallback).

---

## 5-qadam: A24.uz Domenini Bog'lash

1. Cloudflare Pages loyihangizda **Custom domains** bo'limiga o'ting.
2. **Set up a custom domain** tugmasini bosing.
3. Domenni kiriting:
   - Asosiy domen: `a24.uz` yoki
   - Subdomen: `assistant.a24.uz` (tavsiya etiladi)
4. Cloudflare avtomatik ravishda DNS CNAME yozuvini qo'shadi va bepul SSL/TLS sertifikatini ulaydi.

---

## 6-qadam: Mahalliy Sinov (Local Testing via Wrangler)

Kodni o'z kompyuteringizda sinab ko'rish uchun:

```bash
# Wrangler bilan Pages Functions-ni ishga tushirish
npx wrangler pages dev public --binding APP_PASSWORD=SIZNING_MAXFIY_PAROLINGIZ GEMINI_API_KEY=SIZNING_GEMINI_KALITINGIZ
```

Brauzerda `http://localhost:8788` manzilini ochasiz, parolni kiritasiz va mikrofon orqali o'zbek tilida savol berib sinab ko'rishingiz mumkin!
