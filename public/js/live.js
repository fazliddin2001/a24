import { AuthManager } from './auth.js';

/**
 * Gemini Live API Client (Bidirectional Streaming WebSocket)
 * Directly connects via Cloudflare AI Gateway WebSocket endpoint:
 * wss://gateway.ai.cloudflare.com/v1/{account}/{gateway}/google?api_key={key}
 * with subprotocol cf-aig-authorization.{token}
 * 
 * Supports:
 * - Direct AI Gateway logging
 * - Automatic activity detection disabled (Manual client-side VAD control)
 * - activityStart & activityEnd turn signaling
 * - Small chunk (20-40ms) PCM16 streaming
 * - Real-time incoming text & 24kHz PCM audio playback
 * - Automatic fallback to Google direct endpoint if Gateway is unreachable
 */
export class GeminiLiveClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.config = null;
    this.hasTriedFallbackModel = false;

    // Callbacks
    this.onOpen = null;
    this.onClose = null;
    this.onError = null;
    this.onTextPart = null;
    this.onAudioChunk = null;
    this.onTurnComplete = null;
    this.onInterrupted = null;
  }

  async fetchConfig() {
    try {
      const res = await fetch('/api/live-config', {
        headers: AuthManager.getAuthHeaders(),
        credentials: 'include'
      });
      if (res.ok) {
        this.config = await res.json();
        return this.config;
      }
    } catch (err) {
      console.warn('Could not fetch live config:', err);
    }
    return null;
  }

  async connect() {
    if (this.isConnected || this.isConnecting) return;
    this.isConnecting = true;

    // Fetch live configuration from server
    if (!this.config) {
      await this.fetchConfig();
    }

    if (!this.config || !this.config.apiKey) {
      console.warn('Gemini Live config or API key is not available');
      this.isConnecting = false;
      return;
    }

    // Attempt 1: Cloudflare AI Gateway WebSocket (logs will appear in AI Gateway!)
    if (this.config.gatewayUrl) {
      try {
        console.log('Connecting to Cloudflare AI Gateway Live WebSocket...');
        const protocols = this.config.token ? [`cf-aig-authorization.${this.config.token}`] : [];
        await this.tryConnectUrl(this.config.gatewayUrl, protocols);
        this.isConnecting = false;
        return;
      } catch (gwErr) {
        console.warn('Cloudflare AI Gateway WebSocket connection failed, trying direct Google endpoint:', gwErr);
      }
    }

    // Attempt 2: Direct Google Generative Service WebSocket endpoint
    if (this.config.directUrl) {
      try {
        console.log('Connecting to Google Gemini Live WebSocket directly...');
        await this.tryConnectUrl(this.config.directUrl, []);
        this.isConnecting = false;
        return;
      } catch (directErr) {
        console.error('Direct Gemini Live connection failed:', directErr);
      }
    }

    this.isConnecting = false;
  }

  tryConnectUrl(url, protocols = []) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;

      try {
        socket = protocols.length > 0 ? new WebSocket(url, protocols) : new WebSocket(url);
      } catch (e) {
        return reject(e);
      }

      const connectionTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { socket.close(); } catch {}
          reject(new Error('WebSocket connection timed out (5s)'));
        }
      }, 5000);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectionTimeout);

        this.ws = socket;
        this.isConnected = true;
        console.log('⚡ Gemini Live WebSocket connected successfully!');

        // Send setup message immediately on open
        this.sendSetup(this.config);

        if (this.onOpen) this.onOpen();
        resolve(socket);
      };

      socket.onmessage = async (event) => {
        await this.handleMessage(event.data);
      };

      socket.onerror = (err) => {
        console.warn('Gemini Live WebSocket error event:', err);
        if (!settled) {
          settled = true;
          clearTimeout(connectionTimeout);
          reject(err);
        }
        if (this.onError) this.onError(err);
      };

      socket.onclose = (event) => {
        this.isConnected = false;
        this.ws = null;
        console.log(`Gemini Live WebSocket closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
        if (this.onClose) this.onClose(event);
      };
    });
  }

  sendSetup(config) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const modelName = config.model?.startsWith('models/') ? config.model : `models/${config.model || 'gemini-3.8-live'}`;

    const setupPayload = {
      setup: {
        model: modelName,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: config.voice || "Aoede"
              }
            }
          }
        },
        systemInstruction: {
          parts: [{ text: config.systemInstruction || "Siz — Malika, ADCHTI rasmiy ovozli assistentisiz." }]
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: true
          }
        }
      }
    };

    console.log(`Sending Live setup message for model: ${modelName}`);
    this.ws.send(JSON.stringify(setupPayload));
  }

  sendActivityStart() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = {
      realtimeInput: {
        activityStart: {}
      }
    };
    this.ws.send(JSON.stringify(msg));
  }

  sendAudioChunk(base64PcmChunk) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !base64PcmChunk) return;
    const msg = {
      realtimeInput: {
        audio: {
          data: base64PcmChunk,
          mimeType: "audio/pcm;rate=16000"
        }
      }
    };
    this.ws.send(JSON.stringify(msg));
  }

  sendActivityEnd() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = {
      realtimeInput: {
        activityEnd: {}
      }
    };
    this.ws.send(JSON.stringify(msg));
  }

  sendTextMessage(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !text?.trim()) return;
    const msg = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: text.trim() }]
          }
        ],
        turnComplete: true
      }
    };
    this.ws.send(JSON.stringify(msg));
  }

  async handleMessage(raw) {
    try {
      let text;
      if (raw instanceof Blob) {
        text = await raw.text();
      } else if (typeof raw === 'string') {
        text = raw;
      } else {
        text = new TextDecoder().decode(raw);
      }
      const data = JSON.parse(text);

      // Check for Gemini API errors
      if (data.error) {
        console.error('Gemini Live API error from server:', data.error);
        if (this.onError) this.onError(data.error);

        // If specified model is not supported, attempt fallback to gemini-2.5-flash or gemini-2.0-flash
        if (data.error.message && data.error.message.toLowerCase().includes('not found') && !this.hasTriedFallbackModel) {
          this.hasTriedFallbackModel = true;
          console.warn('Live model not found. Switching to fallback live model: gemini-2.5-flash');
          if (this.config) {
            this.config.model = 'gemini-2.5-flash';
          }
          this.disconnect();
          setTimeout(() => this.connect(), 500);
        }
        return;
      }

      if (data.serverContent) {
        const { modelTurn, interrupted, turnComplete } = data.serverContent;

        if (interrupted) {
          if (this.onInterrupted) this.onInterrupted();
          return;
        }

        if (modelTurn?.parts) {
          for (const part of modelTurn.parts) {
            if (part.text && this.onTextPart) {
              this.onTextPart(part.text);
            }
            if (part.inlineData?.data && this.onAudioChunk) {
              this.onAudioChunk(part.inlineData.data, part.inlineData.mimeType || 'audio/pcm;rate=24000');
            }
          }
        }

        if (turnComplete && this.onTurnComplete) {
          this.onTurnComplete();
        }
      }
    } catch (e) {
      console.warn('Failed to parse incoming Gemini Live message:', e);
    }
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.isConnected = false;
  }
}
