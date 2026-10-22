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
            error: "Tizim xatoligi: SESSION_SECRET yoki APP_PASSWORD o'rnatilmagan"
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const cookies = parseCookies(request.headers.get('Cookie'));
        let token = cookies['a24_session'];
        if (!token) {
          const authHeader = request.headers.get('Authorization');
          if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7).trim();
          }
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
            'Set-Cookie': 'a24_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
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
        error: "Tizim xatoligi: APP_PASSWORD Cloudflare sozlamalarida o'rnatilmagan"
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

    const token = await createSessionToken('adchti_user', secret, 60 * 60 * 24 * 30);
    const cookieHeader = `a24_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`;

    return new Response(JSON.stringify({ success: true, message: 'Xush kelibsiz!' }), {
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

// --- CHAT HANDLER (Gemini 3.8 Flash + Thinking Stripping + TTS) ---
async function handleChat(request, env) {
  try {
    const body = await request.json();
    const { audio, text, history = [], generateSpeech = true } = body;

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: "GEMINI_API_KEY o'rnatilmagan (Missing GEMINI_API_KEY in Cloudflare settings)"
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let baseUrl;
    if (env.CLOUDFLARE_ACCOUNT_ID && env.AI_GATEWAY_NAME) {
      baseUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_NAME}/google-ai-studio/v1beta`;
    } else {
      baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    }

    const modelName = env.GEMINI_MODEL || 'gemini-3.8-flash';
    const ttsModelName = env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
    const generateUrl = `${baseUrl}/models/${modelName}:generateContent?key=${apiKey}`;

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

    const geminiRes = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({
        error: `Gemini API xatoligi (${geminiRes.status}): ${errText}`
      }), {
        status: geminiRes.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const geminiData = await geminiRes.json();
    const rawAnswer = geminiData.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

    // Strip Thinking Tokens
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
      try {
        const ttsUrl = `${baseUrl}/models/${ttsModelName}:generateContent?key=${apiKey}`;
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

        const ttsRes = await fetch(ttsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ttsPayload)
        });

        if (ttsRes.ok) {
          const ttsData = await ttsRes.json();
          const audioPart = ttsData.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          if (audioPart && audioPart.inlineData) {
            speechAudio = audioPart.inlineData.data;
            speechMimeType = audioPart.inlineData.mimeType || 'audio/mp3';
          }
        }
      } catch (ttsErr) {
        console.error('TTS Generation error:', ttsErr);
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

    let baseUrl;
    if (env.CLOUDFLARE_ACCOUNT_ID && env.AI_GATEWAY_NAME) {
      baseUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_NAME}/google-ai-studio/v1beta`;
    } else {
      baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    }

    const ttsModelName = env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
    const ttsUrl = `${baseUrl}/models/${ttsModelName}:generateContent?key=${apiKey}`;

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

    const res = await fetch(ttsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ttsPayload)
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ error: `TTS xatoligi: ${errText}` }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await res.json();
    const audioPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

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
