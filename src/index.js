import { verifySessionToken, parseCookies, createSessionToken } from './utils/crypto.js';

// =============================================
// SYSTEM PROMPT (inlined to avoid import issues)
// =============================================
function buildSystemPrompt() {
  return `Siz — Malika, Andijon davlat chet tillari instituti (ADCHTI) rasmiy raqamli ayol ovozli assistentisiz.

MUHIM TIL VA NUTQ KO'RSATMALARI (O'ZBEK AUDITORIYASI UCHUN):
1. Auditoriyangiz asosan o'zbek tilida so'zlashuvchi talabalar, abituriyentlar va professor-o'qituvchilardir.
2. Foydalanuvchining audio nutqi fonetik jihatdan noaniq yoki qisqargan bo'lishi mumkin (masalan: "perevod", "kontraktim", "dekanat qatta", "hemis ochmayapti"). Ularni o'zbek tili va universitet kontekstida to'g'ri tushuning.
3. Foydalanuvchi lotin yoki kirill alifbosida, rasmiy yoki samimiy og'zaki tilda gapirsa ham, har doim adabiy, muloyim va xushmuomala o'zbek tilida (lotin alifbosida) javob bering.
4. JAVOB FORMATI OVOZLI O'QISH UCHUN MAXSUS SOZLANGAN BO'LISHI SHART:
   - Javoblarni murakkab jadvallar, yulduzchalar, tushunarsiz ro'yxatlar yoki maxsus belgilarsiz bering.
   - Javoblar qisqa, ixcham, tinglovchiga eshitilishi oson bo'lgan 2-4 ta tabiiy og'zaki jumlalardan iborat bo'lsin.
   - Avatarning og'iz harakati va TTS yaxshi yangrashi uchun ifodali va jonli jumlalar tuzing.

INSTITUT MA'LUMOTLARI VA STATISTIKASI:
- Nomi: Andijon davlat chet tillari instituti (ADCHTI)
- Joylashuvi: Andijon shahri, Bobur shohko'chasi
- Umumiy talabalar: 6,500+
- Professor-o'qituvchilar: 320+
- Kafedralar: 18 ta kafedra
- Fakultetlar (4 ta):
  * Ingliz tili va adabiyoti fakulteti: yo'nalishlar (Filologiya va tillarni o'qitish (ingliz tili), Gid hamrohligi va tarjimonlik faoliyati)
  * Roman-german va slavyan tillari fakulteti: yo'nalishlar (Nemis tili filologiyasi, Fransuz tili filologiyasi, Rus tili filologiyasi)
  * Sharq tillari fakulteti: yo'nalishlar (Xitoy tili va adabiyoti, Koreys tili va adabiyoti, Arab tili va adabiyoti, Yapon tili)
  * Tarjimashunoslik va xalqaro munosabatlar fakulteti: yo'nalishlar (Sinxron tarjima, Badiiy tarjima, Xalqaro jurnalistika)
- Ta'lim tizimi: HEMIS axborot tizimi (hemis.adchti.uz), ECTS kredit-modul tizimi, GPA (Grade Point Average) baholash mezoni.
- Xizmatlar:
  * Talabalar turar joyi (TTJ): Arizalar my.gov.uz yoki HEMIS orqali qabul qilinadi
  * Shartnoma to'lovi: Kontrakt to'lovlari semestr boshida amalga oshiriladi, tabaqalashtirilgan shartnoma (super-kontrakt) ham mavjud
  * Stipendiya: Davlat granti va tabaqalashtirilgan stipendiyalar (a'lo, yaxshi, bazaviy) mavjud
  * O'qishni ko'chirish: Faqat transfer.edu.uz rasmiy portali orqali belgilangan muddatlarda
- Xalqaro aloqalar: 25+ xorijiy universitetlar (AQSH, Buyuk Britaniya, Germaniya, Xitoy, Yaponiya, Koreya)

QO'SHIMCHA KO'RSATMA:
Agar foydalanuvchi institutdan tashqari umumiy mavzularda (til o'rganish bo'yicha maslahatlar, chet tillari, grammatika yoki umumiy intellektual savollar) so'rasa, o'zbek tilida qisqa, aniq va foydali ma'lumot bering.`;
}

// =============================================
// GEMINI API CALLER (with model fallback chain)
// =============================================
async function callGemini(baseUrl, models, payload, apiKey, cfAigToken) {
  let lastError = null;

  for (const model of models) {
    if (!model) continue;
    const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;

    const headers = {
      'Content-Type': 'application/json'
    };
    // If AI Gateway has authentication enabled, include the CF AIG token
    if (cfAigToken) {
      headers['cf-aig-authorization'] = `Bearer ${cfAigToken}`;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        return { ok: true, data, modelUsed: model };
      }

      const errText = await res.text();
      lastError = `Model ${model} (${res.status}): ${errText.substring(0, 300)}`;

      // If 404 (model not found) or 403 (not authorized for model), try next
      if (res.status === 404 || res.status === 403) {
        continue;
      }

      return { ok: false, error: lastError, status: res.status };
    } catch (e) {
      lastError = `Model ${model} fetch error: ${e.message}`;
    }
  }

  return { ok: false, error: lastError || 'Barcha modellar javob bermadi', status: 500 };
}

// Build the base URL for Gemini API (via Gateway or direct)
function getBaseUrl(env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const gatewayName = env.AI_GATEWAY_NAME;

  if (accountId && gatewayName) {
    return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayName}/google-ai-studio/v1beta`;
  }
  // Fallback: direct to Google
  return 'https://generativelanguage.googleapis.com/v1beta';
}

// =============================================
// MAIN WORKER ENTRY POINT
// =============================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- API ROUTES ---
    if (url.pathname.startsWith('/api/')) {

      // === DEBUG ENDPOINT (remove in production) ===
      if (url.pathname === '/api/debug') {
        const baseUrl = getBaseUrl(env);
        return new Response(JSON.stringify({
          hasGeminiKey: !!env.GEMINI_API_KEY,
          geminiKeyPrefix: env.GEMINI_API_KEY ? env.GEMINI_API_KEY.substring(0, 8) + '...' : 'MISSING',
          hasAppPassword: !!env.APP_PASSWORD,
          hasSessionSecret: !!env.SESSION_SECRET,
          hasCfAigToken: !!env.CF_AIG_TOKEN,
          accountId: env.CLOUDFLARE_ACCOUNT_ID || 'NOT SET',
          gatewayName: env.AI_GATEWAY_NAME || 'NOT SET',
          model: env.GEMINI_MODEL || 'gemini-2.5-flash (default)',
          ttsModel: env.GEMINI_TTS_MODEL || 'gemini-2.5-flash (default)',
          baseUrl: baseUrl
        }, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // === TEST GEMINI ENDPOINT ===
      if (url.pathname === '/api/test-gemini') {
        const apiKey = env.GEMINI_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: 'GEMINI_API_KEY topilmadi! Cloudflare Dashboard > Workers > a24 > Settings > Variables and Secrets bo\'limiga kiring va GEMINI_API_KEY ni Encrypt sifatida qo\'shing.' }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
          });
        }

        const baseUrl = getBaseUrl(env);
        const models = [env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'].filter(Boolean);

        const result = await callGemini(baseUrl, models, {
          contents: [{ role: 'user', parts: [{ text: 'Salom! 1+1 nechta?' }] }],
          generationConfig: { maxOutputTokens: 50 }
        }, apiKey, env.CF_AIG_TOKEN);

        if (result.ok) {
          const answer = result.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          return new Response(JSON.stringify({
            success: true,
            model: result.modelUsed,
            answer: answer,
            gateway: baseUrl
          }, null, 2), {
            status: 200, headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({
          success: false,
          error: result.error,
          gateway: baseUrl,
          hint: 'Agar AI Gateway "Authentication enabled" bo\'lsa, uni o\'chiring yoki CF_AIG_TOKEN secret qo\'shing.'
        }, null, 2), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        });
      }

      // === AUTH: Login (no auth required) ===
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }

      // === MIDDLEWARE: Require auth for everything else ===
      const secret = env.SESSION_SECRET || env.APP_PASSWORD;
      if (!secret) {
        return new Response(JSON.stringify({
          error: "APP_PASSWORD Cloudflare-da kiritilmagan. Dashboard > Workers > a24 > Settings > Variables and Secrets ga o'ting."
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      const cookies = parseCookies(request.headers.get('Cookie'));
      let token = cookies['a24_session'];
      const authHeader = request.headers.get('Authorization');
      if (!token && authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      }

      const session = await verifySessionToken(token, secret);
      if (!session) {
        return new Response(JSON.stringify({
          error: "Avtorizatsiyadan o'tilmagan (Unauthorized)"
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }

      // === AUTH: Check ===
      if (url.pathname === '/api/auth/check') {
        return new Response(JSON.stringify({ authenticated: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }

      // === AUTH: Logout ===
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'a24_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
          }
        });
      }

      // === CHAT ===
      if (url.pathname === '/api/chat' && request.method === 'POST') {
        return handleChat(request, env);
      }

      // === TTS ===
      if (url.pathname === '/api/tts' && request.method === 'POST') {
        return handleTts(request, env);
      }

      return new Response(JSON.stringify({ error: 'Endpoint topilmadi' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    // --- STATIC ASSETS ---
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404 });
  }
};

// =============================================
// HANDLERS
// =============================================

async function handleLogin(request, env) {
  try {
    const body = await request.json();
    const { password } = body;

    const expectedPassword = env.APP_PASSWORD;
    if (!expectedPassword) {
      return new Response(JSON.stringify({
        error: "APP_PASSWORD Cloudflare sozlamalarida kiritilmagan"
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    if (!password || password !== expectedPassword) {
      return new Response(JSON.stringify({ error: "Parol noto'g'ri" }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }

    const secret = env.SESSION_SECRET || expectedPassword;
    const token = await createSessionToken('adchti_user', secret, 60 * 60 * 24 * 30);

    return new Response(JSON.stringify({ success: true, token, message: 'Xush kelibsiz!' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `a24_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Login xatosi: ' + err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleChat(request, env) {
  try {
    const body = await request.json();
    const { audio, text, history = [], generateSpeech = true } = body;

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: "GEMINI_API_KEY topilmadi. Cloudflare Dashboard-da Workers > a24 > Settings > Variables and Secrets bo'limiga GEMINI_API_KEY secret qo'shing."
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const baseUrl = getBaseUrl(env);
    const cfAigToken = env.CF_AIG_TOKEN || null;

    const candidateModels = [
      env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.0-flash'
    ].filter(Boolean);

    const MAX_HISTORY_MESSAGES = 6;
    const trimmedHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : [];

    const userParts = [];
    if (audio && audio.data) {
      userParts.push({ inlineData: { mimeType: audio.mimeType || 'audio/webm', data: audio.data } });
      userParts.push({ text: "Yuqoridagi audio yozuvni tinglang. Savol o'zbek tilida so'ralgan. ADCHTI universiteti qoidalari va statistikasiga tayangan holda samimiy va lo'nda javob bering." });
    } else if (text) {
      userParts.push({ text: text.trim() });
    } else {
      return new Response(JSON.stringify({ error: 'Audio yoki matn kiritilishi shart' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const contents = [...trimmedHistory, { role: 'user', parts: userParts }];

    const geminiPayload = {
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      contents,
      generationConfig: { temperature: 0.6, topP: 0.95, maxOutputTokens: 1024 }
    };

    const result = await callGemini(baseUrl, candidateModels, geminiPayload, apiKey, cfAigToken);
    if (!result.ok) {
      return new Response(JSON.stringify({ error: `Gemini xatoligi: ${result.error}` }), {
        status: result.status || 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const rawAnswer = result.data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

    // Strip <thought>...</thought>
    let thoughtText = '';
    let cleanText = rawAnswer;
    const thoughtMatch = rawAnswer.match(/<thought>([\s\S]*?)<\/thought>/i);
    if (thoughtMatch) {
      thoughtText = thoughtMatch[1].trim();
      cleanText = rawAnswer.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
    }
    cleanText = cleanText.replace(/<\/?thought>/gi, '').trim();

    // TTS
    let speechAudio = null;
    let speechMimeType = null;

    if (generateSpeech && cleanText) {
      const ttsModels = [env.GEMINI_TTS_MODEL, 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean);
      const ttsPayload = {
        contents: [{ parts: [{ text: cleanText }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env.GEMINI_VOICE || "Aoede" } } }
        }
      };

      const ttsResult = await callGemini(baseUrl, ttsModels, ttsPayload, apiKey, cfAigToken);
      if (ttsResult.ok) {
        const audioPart = ttsResult.data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (audioPart?.inlineData) {
          speechAudio = audioPart.inlineData.data;
          speechMimeType = audioPart.inlineData.mimeType || 'audio/mp3';
        }
      }
    }

    const totalTurns = Math.floor(trimmedHistory.length / 2) + 1;

    return new Response(JSON.stringify({
      text: cleanText, thought: thoughtText,
      audio: speechAudio, audioMimeType: speechMimeType,
      turnCount: totalTurns, shouldReset: totalTurns >= 4
    }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Chat xatosi: ' + err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleTts(request, env) {
  try {
    const body = await request.json();
    const { text, voice = 'Aoede' } = body;

    if (!text?.trim()) {
      return new Response(JSON.stringify({ error: 'Matn kiritilmadi' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY o'rnatilmagan" }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const baseUrl = getBaseUrl(env);
    const cfAigToken = env.CF_AIG_TOKEN || null;
    const ttsModels = [env.GEMINI_TTS_MODEL, 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean);

    const ttsPayload = {
      contents: [{ parts: [{ text: text.trim() }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
      }
    };

    const result = await callGemini(baseUrl, ttsModels, ttsPayload, apiKey, cfAigToken);
    if (!result.ok) {
      return new Response(JSON.stringify({ error: `TTS xatoligi: ${result.error}` }), {
        status: result.status || 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const audioPart = result.data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!audioPart?.inlineData) {
      return new Response(JSON.stringify({ error: "Audio qaytmadi" }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      audio: audioPart.inlineData.data,
      mimeType: audioPart.inlineData.mimeType || 'audio/mp3'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'TTS xatosi: ' + err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
