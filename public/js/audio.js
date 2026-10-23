/**
 * Audio Pipeline: 16kHz PCM streaming to Gemini Live, small chunks (20-40ms),
 * client-side manual VAD with 800ms rolling pre-buffer (ensures no clipped initial syllables),
 * instant sample-level speech onset detection, gapless real-time 24kHz PCM playback scheduling,
 * audio-reactive 3D lip-sync, and full conversation audio recording for user & assistant replay.
 */

// Convert 16-bit PCM buffer to standard canonical WAV Blob (supports 16kHz or 24kHz)
export function pcm16ToWavBlob(uint8Bytes, sampleRate = 24000, numChannels = 1) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const totalDataLen = uint8Bytes.length;

  // 'RIFF' chunk descriptor
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
  view.setUint32(4, 36 + totalDataLen, true);
  // 'WAVE' format
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);
  // 'fmt ' subchunk
  view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
  view.setUint32(16, 16, true); // 16 for PCM
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // Byte rate
  view.setUint16(32, numChannels * 2, true); // Block align
  view.setUint16(34, 16, true); // 16-bit
  // 'data' subchunk
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
  view.setUint32(40, totalDataLen, true);

  return new Blob([header, uint8Bytes], { type: 'audio/wav' });
}

// Downsample Float32 buffer to 16,000 Hz if hardware runs at 44.1k/48k
function downsampleBuffer(buffer, inSampleRate, outSampleRate = 16000) {
  if (inSampleRate === outSampleRate) return buffer;
  const ratio = inSampleRate / outSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : buffer[offsetBuffer];
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

// Convert Float32 [-1.0, 1.0] to 16-bit PCM little-endian
function floatTo16BitPCM(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output;
}

// Convert Int16Array to Base64 string
function int16ToBase64(int16Array) {
  const bytes = new Uint8Array(int16Array.buffer, int16Array.byteOffset, int16Array.byteLength);
  let binary = '';
  const len = bytes.byteLength;
  const CHUNK_SZ = 0x8000;
  for (let i = 0; i < len; i += CHUNK_SZ) {
    const sub = bytes.subarray(i, Math.min(i + CHUNK_SZ, len));
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

export class AudioPipeline {
  constructor(avatarController, waveformBox, liveClient = null) {
    this.avatar = avatarController;
    this.waveformBox = waveformBox;
    this.liveClient = liveClient;

    this.audioContext = null;
    this.playbackCtx = null;
    this.mediaStream = null;
    this.micSource = null;
    this.processor = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;

    // VAD & Rolling Pre-Buffer State
    this.hasSpokenSustained = false;
    this.hasSentActivityStart = false;
    this.rollingPreBuffer = [];
    // 26 chunks * 32ms ≈ 832ms rolling buffer (preserves entire first word)
    this.MAX_PRE_BUFFER_CHUNKS = 26;
    this.autoStopCallback = null;
    this.onPlaybackEnded = null;

    // Audio Replay & History storage
    this.currentTurnPcmChunks = [];
    this.lastAssistantWavBlob = null;
    this.lastUserAudioBlob = null;
    this.onTurnAudioReady = null;

    // Playback state
    this.playbackAnalyser = null;
    this.nextPlayTime = 0;
    this.activeLiveSources = [];
    this.isLiveTurnComplete = false;
    this.animFrame = null;
    this.currentSource = null;
    this.currentAudioElement = null;

    this.waveBars = waveformBox ? Array.from(waveformBox.querySelectorAll('.wave-bar')) : [];
  }

  setLiveClient(client) {
    this.liveClient = client;
  }

  async initAudioContext() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      try {
        this.audioContext = new AudioCtx({ sampleRate: 16000 });
      } catch (e) {
        this.audioContext = new AudioCtx();
      }
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    return this.audioContext;
  }

  async initPlaybackContext() {
    if (!this.playbackCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.playbackCtx = new AudioCtx();
    }
    if (this.playbackCtx.state === 'suspended') {
      await this.playbackCtx.resume();
    }
    if (!this.playbackAnalyser) {
      this.playbackAnalyser = this.playbackCtx.createAnalyser();
      this.playbackAnalyser.fftSize = 256;
      this.playbackAnalyser.smoothingTimeConstant = 0.65;
      this.playbackAnalyser.connect(this.playbackCtx.destination);
    }
    return this.playbackCtx;
  }

  // --- REALTIME STREAMING RECORDING WITH 800MS ROLLING BUFFER & VAD ---
  async startRecording(onAutoStop = null) {
    this.stopPlayback();
    await this.initAudioContext();

    this.autoStopCallback = onAutoStop;
    this.rollingPreBuffer = [];
    this.hasSpokenSustained = false;
    this.hasSentActivityStart = false;
    this.currentTurnPcmChunks = [];
    this.lastAssistantWavBlob = null;
    this.lastUserAudioBlob = null;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Start background MediaRecorder to capture user's voice for replay and fallback
    this.audioChunks = [];
    try {
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      }
      this.mediaRecorder = mimeType ? new MediaRecorder(this.mediaStream, { mimeType }) : new MediaRecorder(this.mediaStream);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };
      this.mediaRecorder.start(100);
    } catch (mrErr) {
      console.warn('MediaRecorder init error:', mrErr);
    }

    this.micSource = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Analyser node for visualizer & wave bars animation
    const micAnalyser = this.audioContext.createAnalyser();
    micAnalyser.fftSize = 128;
    micAnalyser.smoothingTimeConstant = 0.35;
    this.micSource.connect(micAnalyser);

    // BufferSize 512 at 16kHz = 32ms chunks
    const bufferSize = 512;
    this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
    this.micSource.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    if (this.waveformBox) this.waveformBox.classList.add('active');

    const recordingStartTime = Date.now();
    let speechFramesCount = 0;
    let lastVoiceTime = 0;
    let autoStopFired = false;

    // VAD thresholds
    const SILENCE_LIMIT_MS = 2400; // 2.4s silence after user stops speaking
    const INITIAL_GRACE_PERIOD_MS = 6000;
    const MAX_DURATION_MS = 60000;

    const triggerAutoStop = (reason) => {
      if (autoStopFired || !this.isRecording) return;
      autoStopFired = true;
      console.log(`VAD Trigger: ${reason}`);

      if (this.liveClient?.isConnected && this.hasSentActivityStart) {
        this.liveClient.sendActivityEnd();
      }

      if (this.autoStopCallback) {
        this.autoStopCallback();
      }
    };

    const freqData = new Uint8Array(micAnalyser.frequencyBinCount);

    const updateWaveVisualizer = () => {
      if (!this.isRecording) return;
      micAnalyser.getByteFrequencyData(freqData);

      this.waveBars.forEach((bar, idx) => {
        const val = freqData[idx % freqData.length] || 0;
        const h = Math.max(6, (val / 255) * 32);
        bar.style.height = `${h}px`;
      });

      const now = Date.now();

      // Silence timeout check
      if (this.hasSpokenSustained && lastVoiceTime > 0 && (now - lastVoiceTime >= SILENCE_LIMIT_MS)) {
        triggerAutoStop('Nutq yakunlandi va jimlik saqlandi');
        return;
      }

      // Initial grace period check
      if (!this.hasSpokenSustained && (now - recordingStartTime >= INITIAL_GRACE_PERIOD_MS)) {
        triggerAutoStop('6s davomida ovoz eshitilmadi');
        return;
      }

      // 1 minute hard limit
      if (now - recordingStartTime >= MAX_DURATION_MS) {
        triggerAutoStop('1 daqiqalik maksimal vaqt yakunlandi');
        return;
      }

      requestAnimationFrame(updateWaveVisualizer);
    };

    // Low-level audio quantum processing callback (runs in Web Audio thread every ~32ms)
    this.processor.onaudioprocess = (e) => {
      if (!this.isRecording) return;
      const rawChannel = e.inputBuffer.getChannelData(0);

      // Direct sample-level RMS calculation for instant speech onset detection
      let sumSquares = 0;
      for (let i = 0; i < rawChannel.length; i++) {
        sumSquares += rawChannel[i] * rawChannel[i];
      }
      const chunkRms = Math.sqrt(sumSquares / rawChannel.length);

      const downsampled = downsampleBuffer(rawChannel, this.audioContext.sampleRate, 16000);
      const pcm16 = floatTo16BitPCM(downsampled);
      const base64Chunk = int16ToBase64(pcm16);

      // Low threshold (0.02) triggers quickly in ~64ms, preventing any lost initial consonant
      if (chunkRms > 0.02) {
        speechFramesCount++;
        if (speechFramesCount >= 2) {
          lastVoiceTime = Date.now();

          if (!this.hasSpokenSustained) {
            this.hasSpokenSustained = true;

            if (this.liveClient?.isConnected && !this.hasSentActivityStart) {
              this.hasSentActivityStart = true;
              this.liveClient.sendActivityStart();

              // Send the full 800ms rolling pre-buffer so beginning of question is fully preserved
              while (this.rollingPreBuffer.length > 0) {
                const chunk = this.rollingPreBuffer.shift();
                this.liveClient.sendAudioChunk(chunk);
              }
            }
          }
        }
      } else {
        speechFramesCount = Math.max(0, speechFramesCount - 1);
      }

      if (this.hasSentActivityStart) {
        if (this.liveClient?.isConnected) {
          this.liveClient.sendAudioChunk(base64Chunk);
        }
      } else {
        // Keep 800ms pre-buffer while waiting for speech
        this.rollingPreBuffer.push(base64Chunk);
        if (this.rollingPreBuffer.length > this.MAX_PRE_BUFFER_CHUNKS) {
          this.rollingPreBuffer.shift();
        }
      }
    };

    this.isRecording = true;
    this.avatar.setState('listening');
    updateWaveVisualizer();
  }

  async stopRecording() {
    if (!this.isRecording) return null;
    this.isRecording = false;

    if (this.waveformBox) {
      this.waveformBox.classList.remove('active');
      this.waveBars.forEach((bar) => (bar.style.height = '8px'));
    }

    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {}
      this.processor = null;
    }

    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {}
      this.micSource = null;
    }

    // Capture user's recorded audio blob for user replay and fallback
    let fallbackData = null;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      fallbackData = await new Promise((resolve) => {
        this.mediaRecorder.onstop = () => {
          if (this.audioChunks.length === 0) {
            resolve(null);
            return;
          }
          const blob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
          this.lastUserAudioBlob = blob;

          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Data = reader.result.split(',')[1];
            resolve({
              data: base64Data,
              mimeType: blob.type,
              blob: blob
            });
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        };
        try {
          this.mediaRecorder.stop();
        } catch {
          resolve(null);
        }
      });
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.liveClient?.isConnected && this.hasSentActivityStart) {
      this.liveClient.sendActivityEnd();
    }

    return fallbackData;
  }

  // --- REALTIME STREAMING PLAYBACK & 3D LIP-SYNC PIPELINE ---
  async queueLiveAudioChunk(base64Data, mimeType = 'audio/pcm;rate=24000') {
    await this.initPlaybackContext();

    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // Store chunk bytes for full assistant response replay
      this.currentTurnPcmChunks.push(bytes);

      const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
      const sampleRate = mimeType.includes('rate=16000') ? 16000 : 24000;
      const audioBuffer = this.playbackCtx.createBuffer(1, int16.length, sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < int16.length; i++) {
        channelData[i] = int16[i] / 32768.0;
      }

      const source = this.playbackCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackAnalyser);

      const now = this.playbackCtx.currentTime;
      const startTime = Math.max(now + 0.015, this.nextPlayTime);
      source.start(startTime);
      this.nextPlayTime = startTime + audioBuffer.duration;

      this.activeLiveSources.push(source);
      this.avatar.setState('speaking');
      this.startLipSyncLoop();

      source.onended = () => {
        const idx = this.activeLiveSources.indexOf(source);
        if (idx > -1) this.activeLiveSources.splice(idx, 1);

        if (this.activeLiveSources.length === 0 && this.isLiveTurnComplete) {
          this.handleLivePlaybackFinished();
        }
      };
    } catch (err) {
      console.warn('Live audio chunk decode error:', err);
    }
  }

  markLiveTurnComplete() {
    this.isLiveTurnComplete = true;

    // Concatenate all streamed chunks into a canonical 24kHz WAV Blob for replay
    if (this.currentTurnPcmChunks.length > 0) {
      let totalLen = 0;
      for (const chunk of this.currentTurnPcmChunks) totalLen += chunk.length;
      const allBytes = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of this.currentTurnPcmChunks) {
        allBytes.set(chunk, offset);
        offset += chunk.length;
      }
      this.lastAssistantWavBlob = pcm16ToWavBlob(allBytes, 24000);
      if (this.onTurnAudioReady) {
        this.onTurnAudioReady(this.lastAssistantWavBlob);
      }
    }

    if (this.activeLiveSources.length === 0) {
      this.handleLivePlaybackFinished();
    }
  }

  handleLivePlaybackFinished() {
    this.stopLipSyncLoop();
    this.avatar.setState('idle');
    this.avatar.setMouthOpen(0.16);
    this.isLiveTurnComplete = false;
    this.nextPlayTime = 0;
    if (this.onPlaybackEnded) {
      this.onPlaybackEnded();
    }
  }

  startLipSyncLoop() {
    if (this.animFrame) return;
    const samples = new Uint8Array(this.playbackAnalyser.fftSize);

    const monitorLipSync = () => {
      if (this.activeLiveSources.length === 0 && this.isLiveTurnComplete) {
        this.stopLipSyncLoop();
        return;
      }

      this.playbackAnalyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (let i = 0; i < samples.length; i++) {
        const norm = (samples[i] - 128) / 128;
        energy += norm * norm;
      }
      const rms = Math.sqrt(energy / samples.length);

      const mouthVal = 0.16 + Math.min(0.84, Math.max(0, rms - 0.012) * 14.5);
      this.avatar.setMouthOpen(mouthVal);

      this.animFrame = requestAnimationFrame(monitorLipSync);
    };

    this.animFrame = requestAnimationFrame(monitorLipSync);
  }

  stopLipSyncLoop() {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.avatar.setMouthOpen(0.16);
  }

  stopPlayback() {
    for (const src of this.activeLiveSources) {
      try {
        src.stop();
      } catch {}
    }
    this.activeLiveSources = [];
    this.nextPlayTime = 0;
    this.isLiveTurnComplete = false;

    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement = null;
    }
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {}
      this.currentSource = null;
    }

    this.stopLipSyncLoop();
    this.avatar.setState('idle');
    this.avatar.setMouthOpen(0.16);
  }

  // --- AUDIO BLOB PLAYBACK (For User & Assistant Replay with Lip-Sync) ---
  async playAudioBlob(blob) {
    this.stopPlayback();
    await this.initPlaybackContext();

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await this.playbackCtx.decodeAudioData(arrayBuffer);
      this.playAudioBuffer(audioBuffer);
    } catch (decodeErr) {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudioElement = audio;
      this.avatar.setState('speaking');
      audio.onended = () => {
        this.avatar.setState('idle');
        URL.revokeObjectURL(url);
        if (this.onPlaybackEnded) this.onPlaybackEnded();
      };
      await audio.play();
    }
  }

  // --- TRADITIONAL BASE64 AUDIO PLAYBACK (Fallback & Replay) ---
  async playBase64Audio(base64Data, mimeType = 'audio/mp3') {
    this.stopPlayback();
    await this.initPlaybackContext();

    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    try {
      const audioBuffer = await this.playbackCtx.decodeAudioData(bytes.buffer.slice(0));
      this.playAudioBuffer(audioBuffer);
    } catch (decodeErr) {
      try {
        const pcmBuffer = this.pcmToAudioBuffer(bytes, 24000);
        this.playAudioBuffer(pcmBuffer);
      } catch (pcmErr) {
        const blob = new Blob([bytes], { type: mimeType });
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        this.currentAudioElement = audio;

        this.avatar.setState('speaking');
        audio.onended = () => {
          this.avatar.setState('idle');
          URL.revokeObjectURL(audioUrl);
          if (this.onPlaybackEnded) this.onPlaybackEnded();
        };
        await audio.play();
      }
    }
  }

  playAudioBuffer(buffer) {
    const source = this.playbackCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.playbackAnalyser);

    this.currentSource = source;
    this.avatar.setState('speaking');
    this.startLipSyncLoop();

    source.onended = () => {
      this.stopLipSyncLoop();
      this.avatar.setState('idle');
      if (this.onPlaybackEnded) this.onPlaybackEnded();
    };

    source.start(0);
  }

  pcmToAudioBuffer(uint8Bytes, sampleRate = 24000) {
    const int16Array = new Int16Array(uint8Bytes.buffer, uint8Bytes.byteOffset, uint8Bytes.byteLength / 2);
    const audioBuffer = this.playbackCtx.createBuffer(1, int16Array.length, sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < int16Array.length; i++) {
      channelData[i] = int16Array[i] / 32768.0;
    }
    return audioBuffer;
  }
}
