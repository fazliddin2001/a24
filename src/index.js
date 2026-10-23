import { verifySessionToken, parseCookies, createSessionToken } from './utils/crypto.js';

// =============================================
// DEFAULT UNIVERSITY DATA & CONTEXT
// =============================================
const DEFAULT_UNIVERSITY_CONTEXT = {
  institute: {
    name: "Andijon davlat chet tillari instituti (ADCHTI)",
    shortName: "ADCHTI",
    location: "Andijon shahri, Bobur shohko'chasi",
    established: "O'zbekiston Respublikasi Prezidentining tegishli qarori asosida tashkil etilgan",
    statistics: {
      totalStudents: "6,500+",
      professorsAndStaff: "320+",
      departments: "18 ta kafedra",
      facultiesCount: 4,
      internationalPartners: "25+ xorijiy universitetlar (AQSH, Buyuk Britaniya, Germaniya, Xitoy, Yaponiya, Koreya)"
    },
    faculties: [
      {
        name: "Ingliz tili va adabiyoti fakulteti",
        directions: ["Filologiya va tillarni o'qitish (ingliz tili)", "Gid hamrohligi va tarjimonlik faoliyati"]
      },
      {
        name: "Roman-german va slavyan tillari fakulteti",
        directions: ["Nemis tili filologiyasi", "Fransuz tili filologiyasi", "Rus tili filologiyasi"]
      },
      {
        name: "Sharq tillari fakulteti",
        directions: ["Xitoy tili va adabiyoti", "Koreys tili va adabiyoti", "Arab tili va adabiyoti", "Yapon tili"]
      },
      {
        name: "Tarjimashunoslik va xalqaro munosabatlar fakulteti",
        directions: ["Sinxron tarjima", "Badiiy tarjima", "Xalqaro jurnalistika"]
      }
    ],
    academicSystems: {
      platform: "HEMIS axborot tizimi (hemis.adchti.uz)",
      creditSystem: "ECTS kredit-modul tizimi",
      grading: "GPA (Grade Point Average) baholash mezoni",
      library: "Axborot-resurs markazi (ARM), elektron kutubxona bazasi"
    },
    studentServices: {
      dormitory: "Talabalar turar joyi (TTJ) - arizalar my.gov.uz yoki HEMIS orqali qabul qilinadi",
      tuitionContract: "Kontrakt to'lovlari semestr boshida amalga oshiriladi, tabaqalashtirilgan shartnoma (super-kontrakt) ham mavjud",
      scholarship: "Davlat granti va tabaqalashtirilgan stipendiyalar (a'lo, yaxshi, bazaviy) mavjud",
      transfer: "O'qishni ko'chirish (perevod) - faqat transfer.edu.uz rasmiy portali orqali belgilangan muddatlarda"
    }
  },
  persona: {
    name: "Malika",
    role: "ADCHTI raqamli ovozli yordamchisi",
    language: "uz-UZ",
    tone: "Samimiy, xushmuomala, akademik va yordamga shay",
    speechGuidelines: "Javoblar qisqa, nutqqa mos (og'zaki so'zlashuvga qulay) bo'lishi shart. Murakkab belgilar ishlatilmasin."
  }
};

// In-memory runtime cache for edge worker instance
let runtimeContextCache = null;

async function getInstituteContext(env) {
  if (env.INSTITUTE_KV) {
    try {
      const kvData = await env.INSTITUTE_KV.get('university_context', 'json');
      if (kvData) return kvData;
    } catch (e) {
      console.error('KV get error:', e);
    }
  }
  if (runtimeContextCache) return runtimeContextCache;
  return DEFAULT_UNIVERSITY_CONTEXT;
}

async function saveInstituteContext(data, env) {
  runtimeContextCache = data;
  if (env.INSTITUTE_KV) {
    try {
      await env.INSTITUTE_KV.put('university_context', JSON.stringify(data));
    } catch (e) {
      console.error('KV put error:', e);
    }
  }
}

// =============================================
// DYNAMIC SYSTEM PROMPT BUILDER
// =============================================
function buildSystemPrompt(context = DEFAULT_UNIVERSITY_CONTEXT) {
  const inst = context?.institute || DEFAULT_UNIVERSITY_CONTEXT.institute;
  const stats = inst.statistics || {};
  const faculties = inst.faculties || [];
  const academic = inst.academicSystems || {};
  const services = inst.studentServices || {};

  let statsLines = '';
  for (const [key, val] of Object.entries(stats)) {
    statsLines += `- ${key}: ${val}\n`;
  }

  let facultiesLines = '';
  if (Array.isArray(faculties)) {
    faculties.forEach((f) => {
      const dirs = Array.isArray(f.directions) ? f.directions.join(', ') : (f.directions || 'Barcha yo\'nalishlar');
      facultiesLines += `  * ${f.name || 'Fakultet'}: yo'nalishlar (${dirs})\n`;
    });
  }

  let academicLines = '';
  for (const [key, val] of Object.entries(academic)) {
    academicLines += `- ${key}: ${val}\n`;
  }

  let servicesLines = '';
  for (const [key, val] of Object.entries(services)) {
    servicesLines += `- ${key}: ${val}\n`;
  }

  // Any custom sections added by the admin
  let customSectionsText = '';
  for (const [key, val] of Object.entries(inst)) {
    if (!['name', 'shortName', 'location', 'established', 'statistics', 'faculties', 'academicSystems', 'studentServices'].includes(key)) {
      if (typeof val === 'object' && val !== null) {
        customSectionsText += `\n${key.toUpperCase()}:\n`;
        for (const [subK, subV] of Object.entries(val)) {
          customSectionsText += `- ${subK}: ${typeof subV === 'object' ? JSON.stringify(subV) : subV}\n`;
        }
      } else {
        customSectionsText += `- ${key}: ${val}\n`;
      }
    }
  }

  return `Siz — Malika, Andijon davlat chet tillari instituti (ADCHTI) rasmiy raqamli ayol ovozli assistentisiz.

MUHIM TIL VA NUTQ KO'RSATMALARI (O'ZBEK AUDITORIYASI UCHUN):
1. Auditoriyangiz asosan o'zbek tilida so'zlashuvchi talabalar, abituriyentlar va professor-o'qituvchilardir.
2. Foydalanuvchining audio nutqi fonetik jihatdan noaniq yoki qisqargan bo'lishi mumkin (masalan: "perevod", "kontraktim", "dekanat qatta", "hemis ochmayapti"). Ularni o'zbek tili va universitet kontekstida to'g'ri tushuning.
3. Foydalanuvchi lotin yoki kirill alifbosida, rasmiy yoki samimiy og'zaki tilda gapirsa ham, har doim adabiy, muloyim va xushmuomala o'zbek tilida (lotin alifbosida) javob bering.
4. JAVOB FORMATI OVOZLI O'QISH UCHUN MAXSUS SOZLANGAN BO'LISHI SHART:
   - Javoblarni murakkab jadvallar, yulduzchalar, tushunarsiz ro'yxatlar yoki maxsus belgilarsiz bering.
   - Javoblar qisqa, ixcham, tinglovchiga eshitilishi oson bo'lgan 2-4 ta tabiiy og'zaki jumlalardan iborat bo'lsin.
   - Avatarning og'iz harakati va TTS yaxshi yangrashi uchun ifodali va jonli jumlalar tuzing.

INSTITUT MA'LUMOTLARI VA STATISTIKASI (YANGILANGAN RASMIY BAZA):
- Nomi: ${inst.name || 'Andijon davlat chet tillari instituti (ADCHTI)'}
- Joylashuvi: ${inst.location || 'Andijon shahri, Bobur shohko\'chasi'}
${inst.established ? `- Tashkil topishi: ${inst.established}\n` : ''}${statsLines}
Fakultetlar va Yo'nalishlar:
${facultiesLines}
Ta'lim tizimi:
${academicLines}
Talabalar xizmatlari va muhim ma'lumotlar:
${servicesLines}
${customSectionsText}
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

function getBaseUrl(env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const gatewayName = env.AI_GATEWAY_NAME;

  if (accountId && gatewayName) {
    return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayName}/google-ai-studio/v1beta`;
  }
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

      // === DEBUG ENDPOINT ===
      if (url.pathname === '/api/debug') {
        const baseUrl = getBaseUrl(env);
        return new Response(JSON.stringify({
          hasGeminiKey: !!env.GEMINI_API_KEY,
          geminiKeyPrefix: env.GEMINI_API_KEY ? env.GEMINI_API_KEY.substring(0, 8) + '...' : 'MISSING',
          hasAppPassword: !!env.APP_PASSWORD,
          hasAdminPass: !!(env.ADMIN_PASS || env.admin_pass),
          hasSessionSecret: !!env.SESSION_SECRET,
          hasCfAigToken: !!env.CF_AIG_TOKEN,
          accountId: env.CLOUDFLARE_ACCOUNT_ID || 'NOT SET',
          gatewayName: env.AI_GATEWAY_NAME || 'NOT SET',
          model: env.GEMINI_MODEL || 'gemini-3.8-flash (default)',
          ttsModel: env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts (default)',
          liveModel: env.GEMINI_LIVE_MODEL || 'gemini-3.8-live (default)',
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
          return new Response(JSON.stringify({ error: 'GEMINI_API_KEY topilmadi! Cloudflare Dashboard > Workers > a24 > Settings > Variables and Secrets bo\'limiga GEMINI_API_KEY ni kiriting.' }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
          });
        }

        const baseUrl = getBaseUrl(env);
        const models = [env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean);

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
          gateway: baseUrl
        }, null, 2), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        });
      }

      // === LIST MODELS ENDPOINT ===
      if (url.pathname === '/api/list-models') {
        const apiKey = env.GEMINI_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: 'GEMINI_API_KEY topilmadi' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
          const data = await res.json();
          return new Response(JSON.stringify(data, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      // === AUTH: Login ===
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }

      // === MIDDLEWARE: Require auth for protected endpoints ===
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
      if (!token) {
        token = url.searchParams.get('token');
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

      // === ADMIN: Institute Data (Fetch current JSON) ===
      if (url.pathname === '/api/admin/institute-data' && request.method === 'GET') {
        return handleGetInstituteData(request, env);
      }

      // === ADMIN: Institute Data (Update with admin_pass) ===
      if (url.pathname === '/api/admin/institute-data' && request.method === 'POST') {
        return handleUpdateInstituteData(request, env);
      }

      // === LIVE API: Session Config ===
      if (url.pathname === '/api/live-config' && request.method === 'GET') {
        return handleLiveConfig(request, env);
      }

      // === LIVE API: WebSocket Proxy ===
      if (url.pathname === '/api/live-ws') {
        return handleLiveWebSocket(request, env);
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
      return new Response(JSON.stringify({
        error: "Parol noto'g'ri. Iltimos qaytadan urinib ko'ring."
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const secret = env.SESSION_SECRET || expectedPassword;
    const token = await createSessionToken({ role: 'user', loginTime: Date.now() }, secret);

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

// === GET INSTITUTE DATA (ADMIN & FRONTEND) ===
async function handleGetInstituteData(request, env) {
  try {
    const data = await getInstituteContext(env);
    return new Response(JSON.stringify({ success: true, data }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Ma\'lumotlarni olishda xatolik: ' + err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

// === UPDATE INSTITUTE DATA (PROTECTED BY admin_pass) ===
async function handleUpdateInstituteData(request, env) {
  try {
    const body = await request.json();
    const { data, password } = body;

    const expectedAdminPass = env.ADMIN_PASS || env.admin_pass;
    if (expectedAdminPass) {
      if (!password || password !== expectedAdminPass) {
        return new Response(JSON.stringify({
          error: "Admin paroli noto'g'ri! Iltimos, Cloudflare-da o'rnatilgan 'admin_pass' parolini kiriting."
        }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
    } else if (env.APP_PASSWORD) {
      // Fallback if admin_pass is not yet added to Cloudflare Secrets
      if (!password || password !== env.APP_PASSWORD) {
        return new Response(JSON.stringify({
          error: "Noto'g'ri parol! Cloudflare Dashboard > Workers > a24 > Settings > Variables and Secrets bo'limiga 'admin_pass' maxfiy parolini qo'shing."
        }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
    } else {
      return new Response(JSON.stringify({
        error: "admin_pass Cloudflare sozlamalarida topilmadi. Dashboard > Workers > a24 > Settings > Variables and Secrets ga o'ting."
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    if (!data || typeof data !== 'object') {
      return new Response(JSON.stringify({ error: "Yaroqsiz ma'lumotlar formati. JSON obyekti kutilmoqda." }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    await saveInstituteContext(data, env);

    return new Response(JSON.stringify({
      success: true,
      message: "Institut ma'lumotlari muvaffaqiyatli saqlandi! Malika bilim bazasi yangilandi."
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Saqlashda xatolik: ' + err.message }), {
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
      env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'
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

    // Fetch dynamic institute context (admin-editable)
    const instituteContext = await getInstituteContext(env);
    const systemInstructionText = buildSystemPrompt(instituteContext);

    const geminiPayload = {
      systemInstruction: { parts: [{ text: systemInstructionText }] },
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
      const ttsModels = [env.GEMINI_TTS_MODEL, 'gemini-3.8-flash-tts', 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean);
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
        if (audioPart && audioPart.inlineData) {
          speechAudio = audioPart.inlineData.data;
          speechMimeType = audioPart.inlineData.mimeType || 'audio/mp3';
        }
      }
    }

    return new Response(JSON.stringify({
      text: cleanText,
      thought: thoughtText || null,
      audio: speechAudio,
      audioMimeType: speechMimeType,
      model: result.modelUsed
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server xatosi: ' + err.message }), {
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
    const ttsModels = [env.GEMINI_TTS_MODEL, 'gemini-3.8-flash-tts', 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean);

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

// =============================================
// GEMINI LIVE REALTIME STREAMING HANDLERS
// =============================================

async function handleLiveConfig(request, env) {
  try {
    const instituteContext = await getInstituteContext(env);
    const systemPrompt = buildSystemPrompt(instituteContext);
    const apiKey = env.GEMINI_API_KEY || '';
    const liveModel = env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
    const voice = env.GEMINI_VOICE || 'Aoede';
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    const gatewayName = env.AI_GATEWAY_NAME;

    return new Response(JSON.stringify({
      success: true,
      model: liveModel,
      voice: voice,
      apiKey: apiKey,
      token: env.CF_AIG_TOKEN || '',
      systemInstruction: systemPrompt,
      gatewayUrl: (accountId && gatewayName && apiKey)
        ? `wss://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayName}/google?api_key=${apiKey}`
        : null,
      directUrl: apiKey
        ? `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`
        : null
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleLiveWebSocket(request, env) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket Upgrade', { status: 426 });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response('GEMINI_API_KEY not configured', { status: 500 });
  }

  const instituteContext = await getInstituteContext(env);
  const systemPrompt = buildSystemPrompt(instituteContext);
  const liveModel = env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
  const voice = env.GEMINI_VOICE || 'Aoede';

  // Target Cloudflare AI Gateway (or Google directly as fallback)
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const gatewayName = env.AI_GATEWAY_NAME;
  let targetUrl;
  if (accountId && gatewayName) {
    targetUrl = `wss://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayName}/google?api_key=${apiKey}`;
  } else {
    targetUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  }

  let geminiResp;
  try {
    const fetchHeaders = { 'Upgrade': 'websocket' };
    if (env.CF_AIG_TOKEN) {
      fetchHeaders['cf-aig-authorization'] = `Bearer ${env.CF_AIG_TOKEN}`;
    }
    geminiResp = await fetch(targetUrl, { headers: fetchHeaders });
  } catch (err) {
    return new Response('Failed to connect to Gemini Live: ' + err.message, { status: 502 });
  }

  const geminiWs = geminiResp.webSocket;
  if (!geminiWs) {
    return new Response('Upstream server did not upgrade to WebSocket', { status: 502 });
  }
  geminiWs.accept();

  // Create WebSocket pair for browser client
  const pair = new WebSocketPair();
  const [clientWs, serverWs] = Object.values(pair);
  serverWs.accept();

  // Send the setup message required by Gemini Live
  const setupMessage = {
    setup: {
      model: liveModel.startsWith('models/') ? liveModel : `models/${liveModel}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice
            }
          }
        }
      },
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: true
        }
      }
    }
  };

  try {
    geminiWs.send(JSON.stringify(setupMessage));
  } catch (e) {
    console.error('Failed to send setup to Gemini:', e);
  }

  // Forward client messages to Gemini
  serverWs.addEventListener('message', (event) => {
    try {
      geminiWs.send(event.data);
    } catch (err) {
      console.error('Client -> Gemini forward error:', err);
    }
  });

  // Forward Gemini messages to client
  geminiWs.addEventListener('message', (event) => {
    try {
      serverWs.send(event.data);
    } catch (err) {
      console.error('Gemini -> Client forward error:', err);
    }
  });

  // Error and close handling
  serverWs.addEventListener('close', (e) => {
    try { geminiWs.close(e.code, e.reason); } catch {}
  });
  geminiWs.addEventListener('close', (e) => {
    try { serverWs.close(e.code, e.reason); } catch {}
  });
  serverWs.addEventListener('error', () => {
    try { geminiWs.close(1011, 'Client error'); } catch {}
  });
  geminiWs.addEventListener('error', () => {
    try { serverWs.close(1011, 'Gemini error'); } catch {}
  });

  return new Response(null, {
    status: 101,
    webSocket: clientWs
  });
}
