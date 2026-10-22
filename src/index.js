import { verifySessionToken, parseCookies, createSessionToken } from './utils/crypto.js';
import { buildSystemPrompt } from '../data/system-prompt.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. API ROUTES
    if (url.pathname.startsWith('/api/')) {
      // Middleware: Check authentication for protected routes
      if (url.pathname !== '/api/auth/login') {
        const secret = env.SESSION_SECRET || env.APP_PASSWORD;
        if (!secret) {
          return new Response(JSON.stringify({
            error: "Tizim xatoligi: Cloudflare boshqaruv panelida APP_PASSWORD kiritilmagan (Missing APP_PASSWORD in Cloudflare Variables and Secrets)"
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Check both Cookie and Authorization Bearer header
        const cookies = parseCookies(request.headers.get('Cookie'));
        let token = cookies['a24_session'];
        
        const authHeader = request.headers.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7).trim();
        }

        const session = await verifySessionToken(token, secret);
        if (!session) {
          return new Response(JSON.stringify({
            error: "Avtorizatsiyadan o'tilmagan (Unauthorized)"
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Handler: POST /api/auth/login
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }

      // Handler: GET /api/auth/check
      if (url.pathname === '/api/auth/check' && request.method === 'GET') {
        return new Response(JSON.stringify({ authenticated: true, user: 'authorized' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Handler: POST /api/auth/logout
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        return new Response(JSON.stringify({ success: true, message: 'Tizimdan chiqildi' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'a24_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
          }
        });
      }

      // Handler: POST /api/chat
      if (url.pathname === '/api/chat' && request.method === 'POST') {
        return handleChat(request, env);
      }

      // Handler: POST /api/tts
      if (url.pathname === '/api/tts' && request.method === 'POST') {
        return handleTts(request, env);
      }

      return new Response(JSON.stringify({ error: 'Endpoint topilmadi' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. STATIC ASSETS SERVING (Cloudflare Workers Assets)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};

// --- AUTH LOGIN HANDLER ---
async function handleLogin(request, env) {
  try {
    const body = await request.json();
    const { password } = body;

    const expectedPassword = env.APP_PASSWORD;
    if (!expectedPassword) {
      return new Response(JSON.stringify({
        error: "Tizim xatoligi: Cloudflare Settings > Variables and Secrets bo'limida APP_PASSWORD kiritilmagan"
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const secret = env.SESSION_SECRET || expectedPassword;
    if (!password || password !== expectedPassword) {
      return new Response(JSON.stringify({ error: "Parol noto'g'ri (Invalid password)" }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generate signed HMAC token valid for 30 days
    const token = await createSessionToken('adchti_user', secret, 60 * 60 * 24 * 30);
    const cookieHeader = `a24_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;

    // Return token in both JSON body (for localStorage) and Set-Cookie
    return new Response(JSON.stringify({
      success: true,
      token: token,
      message: 'Xush kelibsiz!'
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookieHeader
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server xatosi: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// --- HELPER: GEMINI API CALL WITH RETRIES & FALLBACK ---
async function callGemini(baseUrl, models, payload, apiKey) {
  let lastError = null;

  for (const model of models) {
    if (!model) continue;
    const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        return { ok: true, data, modelUsed: model };
      }

      const errText = await res.text();
      lastError = `Model ${model} (${res.status}): ${errText}`;

      // If 404 (model not found), try next model in fallback list
      if (res.status === 404) {
        continue;
      }

      return { ok: false, error: lastError, status: res.status };
    } catch (e) {
      lastError = e.message;
    }
  }

  return { ok: false, error: lastError || 'Gemini API javob bermadi', status: 500 };
}

// --- CHAT HANDLER ---
async function handleChat(request, env) {
  try {
    const body = await request.json();
    const { audio, text, history = [], generateSpeech = true } = body;

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: "GEMINI_API_KEY o'rnatilmagan. Cloudflare Dashboard > Workers > a24 > Settings > Variables and Secrets bo'limida GEMINI_API_KEY qo'shing."
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Connect via Cloudflare AI Gateway
    const accountId = env.CLOUDFLARE_ACCOUNT_ID || '013eea585e696c68d17848038a22f355';
    const gatewayName = env.AI_GATEWAY_NAME || 'adchti-gemini-gateway';
    const baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayName}/google-ai-studio/v1beta`;

    // Candidate models with graceful fallback
    const candidateModels = [
      env.GEMINI_MODEL,
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ].filter(Boolean);

    const MAX_HISTORY_MESSAGES = 6;
    const trimmedHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : [];

    const userParts = [];
    if (audio && audio.data) {
      userParts.push({
        inlineData: {
          mimeType: audio.mimeType || 'audio/webm',
          data: audio.data
        }
      });
      userParts.push({
        text: "Yuqoridagi audio yozuvni tinglang. Savol o'zbek tilida so'ralgan. ADCHTI universiteti qoidalari va statistikasiga tayangan holda samimiy va lo'nda javob bering."
      });
    } else if (text) {
      userParts.push({ text: text.trim() });
    } else {
      return new Response(JSON.stringify({ error: 'Audio yoki matn kiritilishi shart' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const contents = [
      ...trimmedHistory,
      {
        role: 'user',
        parts: userParts
      }
    ];

    const systemInstruction = buildSystemPrompt();

    const geminiPayload = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: contents,
      generationConfig: {
        temperature: 0.6,
        topP: 0.95,
        maxOutputTokens: 1024
      }
    };

    const result = await callGemini(baseUrl, candidateModels, geminiPayload, apiKey);

    if (!result.ok) {
      return new Response(JSON.stringify({
        error: `Gemini Gateway xatoligi: ${result.error}`
      }), {
        status: result.status || 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rawAnswer = result.data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

    // Strip Thinking Tokens (<thought>...</thought>)
    let thoughtText = '';
    let cleanText = rawAnswer;

    const thoughtMatch = rawAnswer.match(/<thought>([\s\S]*?)<\/thought>/i);
    if (thoughtMatch) {
      thoughtText = thoughtMatch[1].trim();
      cleanText = rawAnswer.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
    }
    cleanText = cleanText.replace(/<\/?thought>/gi, '').trim();

    // Generate Audio (TTS)
    let speechAudio = null;
    let speechMimeType = null;

    if (generateSpeech && cleanText) {
      const candidateTtsModels = [
        env.GEMINI_TTS_MODEL,
        'gemini-2.5-flash',
        'gemini-2.0-flash'
      ].filter(Boolean);

      const ttsPayload = {
        contents: [{
          parts: [{
            text: `Quyidagi o'zbekcha matnni xushmuomala, tabiiy va ravon talaffuz bilan ovoz chiqarib o'qing: "${cleanText}"`
          }]
        }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: env.GEMINI_VOICE || "Aoede"
              }
            }
          }
        }
      };

      const ttsResult = await callGemini(baseUrl, candidateTtsModels, ttsPayload, apiKey);
      if (ttsResult.ok) {
        const audioPart = ttsResult.data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (audioPart && audioPart.inlineData) {
          speechAudio = audioPart.inlineData.data;
          speechMimeType = audioPart.inlineData.mimeType || 'audio/mp3';
        }
      }
    }

    const totalTurns = Math.floor(trimmedHistory.length / 2) + 1;
    const shouldResetNext = totalTurns >= 4;

    return new Response(JSON.stringify({
      text: cleanText,
      thought: thoughtText,
      audio: speechAudio,
      audioMimeType: speechMimeType,
      turnCount: totalTurns,
      shouldReset: shouldResetNext
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server xatosi: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// --- DEDICATED TTS HANDLER ---
async function handleTts(request, env) {
  try {
    const body = await request.json();
    const { text, voice = 'Aoede' } = body;

    if (!text || !text.trim()) {
      return new Response(JSON.stringify({ error: 'Matn kiritilmadi' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY o'rnatilmagan" }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const accountId = env.CLOUDFLARE_ACCOUNT_ID || '013eea585e696c68d17848038a22f355';
    const gatewayName = env.AI_GATEWAY_NAME || 'adchti-gemini-gateway';
    const baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayName}/google-ai-studio/v1beta`;

    const candidateTtsModels = [
      env.GEMINI_TTS_MODEL,
      'gemini-2.5-flash',
      'gemini-2.0-flash'
    ].filter(Boolean);

    const ttsPayload = {
      contents: [{
        parts: [{
          text: `Quyidagi o'zbekcha matnni xushmuomala, tabiiy va ravon talaffuz bilan ovoz chiqarib o'qing: "${text.trim()}"`
        }]
      }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice
            }
          }
        }
      }
    };

    const ttsResult = await callGemini(baseUrl, candidateTtsModels, ttsPayload, apiKey);
    if (!ttsResult.ok) {
      return new Response(JSON.stringify({ error: `TTS xatoligi: ${ttsResult.error}` }), {
        status: ttsResult.status || 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const audioPart = ttsResult.data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!audioPart || !audioPart.inlineData) {
      return new Response(JSON.stringify({ error: "Audio ma'lumoti qaytmadi" }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      audio: audioPart.inlineData.data,
      mimeType: audioPart.inlineData.mimeType || 'audio/mp3'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'TTS xatosi: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
