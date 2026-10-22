export async function onRequestPost(context) {
  const { request, env } = context;

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
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY o\'rnatilmagan' }), {
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
      return new Response(JSON.stringify({ error: 'Audio ma\'lumoti qaytmadi' }), {
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
