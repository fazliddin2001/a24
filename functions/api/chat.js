import { buildSystemPrompt } from '../../data/system-prompt.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { audio, text, history = [], generateSpeech = true } = body;

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: 'GEMINI_API_KEY o\'rnatilmagan (Environment variable GEMINI_API_KEY is missing)'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Determine Gateway URL or Direct Google AI Studio
    let baseUrl;
    if (env.CLOUDFLARE_ACCOUNT_ID && env.AI_GATEWAY_NAME) {
      baseUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_NAME}/google-ai-studio/v1beta`;
    } else {
      baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    }

    const modelName = env.GEMINI_MODEL || 'gemini-2.0-flash';
    const generateUrl = `${baseUrl}/models/${modelName}:generateContent?key=${apiKey}`;

    // Context Turn Management: limit history to last 3-4 turns (6-8 messages)
    const MAX_HISTORY_MESSAGES = 6;
    const trimmedHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : [];

    // Construct User Parts (Audio or Text)
    const userParts = [];
    if (audio && audio.data) {
      // Direct Multimodal Audio Input (bypasses low-quality external STT)
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

    // Call Gemini for Thinking & Answering
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
    // Extract <thought>...</thought> if model included reasoning
    let thoughtText = '';
    let cleanText = rawAnswer;

    const thoughtMatch = rawAnswer.match(/<thought>([\s\S]*?)<\/thought>/i);
    if (thoughtMatch) {
      thoughtText = thoughtMatch[1].trim();
      cleanText = rawAnswer.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
    }

    // Secondary cleanup of any leftover brackets/artifacts
    cleanText = cleanText.replace(/<\/?thought>/gi, '').trim();

    // Generate Audio (TTS) if requested
    let speechAudio = null;
    let speechMimeType = null;

    if (generateSpeech && cleanText) {
      try {
        const ttsUrl = `${baseUrl}/models/${modelName}:generateContent?key=${apiKey}`;
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
                  voiceName: env.GEMINI_VOICE || "Aoede" // Aoede / Kore
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
        // Fallback: TTS audio failure shouldn't fail the entire response, client can fall back
        console.error('TTS Generation error:', ttsErr);
      }
    }

    // Calculate current turn count
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
