import { AuthManager } from './auth.js';

/**
 * Gemini Live API Client (Bidirectional Streaming WebSocket)
 * Supports:
 * - Direct or Cloudflare Worker WebSocket proxy connection (/api/live-ws)
 * - Automatic activity detection disabled (Manual client-side VAD control)
 * - activityStart & activityEnd turn signaling
 * - Small chunk (20-40ms) PCM16 streaming
 * - Real-time incoming text & 24kHz PCM audio playback
 */
export class GeminiLiveClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.config = null;

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

    // First try the worker proxy endpoint: /api/live-ws
    const token = AuthManager.getToken();
    const loc = window.location;
    const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const proxyUrl = `${wsProto}//${loc.host}/api/live-ws?token=${encodeURIComponent(token)}`;

    try {
      await this.tryConnectUrl(proxyUrl, false);
      this.isConnecting = false;
      return;
    } catch (proxyErr) {
      console.warn('Proxy WebSocket connection failed, attempting direct/gateway fallback:', proxyErr);
    }

    // Fallback: fetch config and connect directly to Gateway or Google Live API
    if (!this.config) {
      await this.fetchConfig();
    }

    if (this.config && (this.config.gatewayUrl || this.config.directUrl)) {
      const targetUrl = this.config.gatewayUrl || this.config.directUrl;
      try {
        await this.tryConnectUrl(targetUrl, true);
        this.isConnecting = false;
        return;
      } catch (directErr) {
        console.error('Direct Gemini Live connection failed:', directErr);
      }
    }

    this.isConnecting = false;
  }

  tryConnectUrl(url, sendSetupOnOpen = false) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;

      try {
        socket = new WebSocket(url);
      } catch (e) {
        return reject(e);
      }

      const connectionTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { socket.close(); } catch {}
          reject(new Error('WebSocket connection timed out'));
        }
      }, 7000);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectionTimeout);

        this.ws = socket;
        this.isConnected = true;
        console.log('⚡ Gemini Live WebSocket connected successfully!');

        // If direct connection without worker proxy, send the initial setup message
        if (sendSetupOnOpen && this.config) {
          this.sendSetup(this.config);
        }

        if (this.onOpen) this.onOpen();
        resolve(socket);
      };

      socket.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      socket.onerror = (err) => {
        console.error('Gemini Live WebSocket error:', err);
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
        console.log(`Gemini Live WebSocket closed (code: ${event.code})`);
        if (this.onClose) this.onClose(event);
      };
    });
  }

  sendSetup(config) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const setupPayload = {
      setup: {
        model: config.model?.startsWith('models/') ? config.model : `models/${config.model || 'gemini-3.8-live'}`,
        generationConfig: {
          responseModalities: ["AUDIO", "TEXT"],
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

  handleMessage(raw) {
    try {
      const data = JSON.parse(raw);

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
