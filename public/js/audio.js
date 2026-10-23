/**
 * Audio Pipeline: Microphone recording, base64 encoding, audio-reactive playback,
 * and robust Voice Activity Detection (VAD) with initial grace period & 1-min cap
 */
export class AudioPipeline {
  constructor(avatarController, waveformBox) {
    this.avatar = avatarController;
    this.waveformBox = waveformBox;
    this.audioContext = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.analyser = null;
    this.animFrame = null;
    this.currentSource = null;
    this.currentAudioElement = null;
    this.autoStopCallback = null;
    this.onPlaybackEnded = null;

    this.waveBars = waveformBox ? Array.from(waveformBox.querySelectorAll('.wave-bar')) : [];
  }

  async initAudioContext() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    return this.audioContext;
  }

  // --- RECORDING PIPELINE WITH ROBUST VAD & 1-MINUTE TIMEOUT ---
  /**
   * Starts recording from microphone.
   * @param {Function} onAutoStop - Called when user stops speaking (silence detected) or 1 minute elapses.
   */
  async startRecording(onAutoStop = null) {
    await this.initAudioContext();
    this.audioChunks = [];
    this.autoStopCallback = onAutoStop;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else mimeType = '';
    }

    this.mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    // Audio level visualizer & Voice Activity Detection (VAD)
    const micSource = this.audioContext.createMediaStreamSource(stream);
    const micAnalyser = this.audioContext.createAnalyser();
    micAnalyser.fftSize = 128;
    micAnalyser.smoothingTimeConstant = 0.4;
    micSource.connect(micAnalyser);

    const freqData = new Uint8Array(micAnalyser.frequencyBinCount);
    if (this.waveformBox) this.waveformBox.classList.add('active');

    // VAD state variables:
    const recordingStartTime = Date.now();
    let speechFramesCount = 0;
    let hasSpokenSustained = false; // User has actually spoken a sentence
    let lastVoiceTime = 0;

    // Generous thresholds to prevent false cut-offs:
    // 2.8 seconds of natural silence after sentence completion
    const SILENCE_LIMIT_MS = 2800;
    // 6.0 seconds grace period at start for user to formulate their question
    const INITIAL_GRACE_PERIOD_MS = 6000;
    // 60 seconds (1 minute) hard maximum
    const MAX_DURATION_MS = 60000;

    let autoStopFired = false;

    const triggerAutoStop = (reason) => {
      if (autoStopFired || !this.isRecording) return;
      autoStopFired = true;
      console.log(`VAD Trigger: ${reason}`);
      if (this.autoStopCallback) {
        this.autoStopCallback();
      }
    };

    const updateWaveAndVAD = () => {
      if (!this.isRecording) return;
      micAnalyser.getByteFrequencyData(freqData);

      let sum = 0;
      this.waveBars.forEach((bar, idx) => {
        const val = freqData[idx % freqData.length] || 0;
        sum += val;
        const h = Math.max(6, (val / 255) * 32);
        bar.style.height = `${h}px`;
      });

      const avgEnergy = sum / (this.waveBars.length * 255);
      const now = Date.now();

      // Check speech activity (above room background noise)
      if (avgEnergy > 0.08) {
        speechFramesCount++;
        if (speechFramesCount >= 5) { // Sustained speech ~100ms
          hasSpokenSustained = true;
          lastVoiceTime = now;
        }
      } else {
        speechFramesCount = Math.max(0, speechFramesCount - 1);
      }

      // 1. User has spoken, and now silence has lasted >= 2.8 seconds -> Auto stop!
      if (hasSpokenSustained && lastVoiceTime > 0 && (now - lastVoiceTime >= SILENCE_LIMIT_MS)) {
        triggerAutoStop('Nutq yakunlandi va 2.8s jimlik saqlandi');
        return;
      }

      // 2. 6 seconds passed since mic opened without any speech -> Auto stop!
      if (!hasSpokenSustained && (now - recordingStartTime >= INITIAL_GRACE_PERIOD_MS)) {
        triggerAutoStop('6s davomida hech qanday ovoz aytilmadi');
        return;
      }

      // 3. 1 minute maximum duration limit reached -> Auto stop!
      if (now - recordingStartTime >= MAX_DURATION_MS) {
        triggerAutoStop('1 daqiqalik maksimal vaqt chegarasiga yetildi');
        return;
      }

      requestAnimationFrame(updateWaveAndVAD);
    };

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };

    this.mediaRecorder.onstart = () => {
      this.isRecording = true;
      this.avatar.setState('listening');
      updateWaveAndVAD();
    };

    this.mediaRecorder.start(100);
  }

  async stopRecording() {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = async () => {
        this.isRecording = false;
        if (this.waveformBox) {
          this.waveformBox.classList.remove('active');
          this.waveBars.forEach(bar => bar.style.height = '8px');
        }

        // Stop all mic tracks
        this.mediaRecorder.stream.getTracks().forEach(track => track.stop());

        const blob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Data = reader.result.split(',')[1];
          resolve({
            data: base64Data,
            mimeType: blob.type
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  // --- PLAYBACK & RESTORED LIP-SYNC PIPELINE ---
  stopPlayback() {
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement = null;
    }
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch {}
      this.currentSource = null;
    }
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.avatar.setState('idle');
  }

  async playBase64Audio(base64Data, mimeType = 'audio/mp3') {
    this.stopPlayback();
    await this.initAudioContext();

    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Standard Web Audio buffer decode (supports WAV, MP3, AAC, OGG)
    try {
      const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer.slice(0));
      this.playAudioBuffer(audioBuffer);
    } catch (decodeErr) {
      // Fallback: raw 24kHz 16-bit PCM from Gemini
      try {
        const pcmBuffer = this.pcmToAudioBuffer(bytes, 24000);
        this.playAudioBuffer(pcmBuffer);
      } catch (pcmErr) {
        // Fallback: standard HTMLAudioElement blob
        const blob = new Blob([bytes], { type: mimeType });
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        this.currentAudioElement = audio;

        this.avatar.setState('speaking');
        this.avatar.startPulse(4000);

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
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.65;

    source.connect(analyser);
    analyser.connect(this.audioContext.destination);

    this.currentSource = source;
    this.avatar.setState('speaking');

    const samples = new Uint8Array(analyser.fftSize);

    const monitorLipSync = () => {
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (let i = 0; i < samples.length; i++) {
        const norm = (samples[i] - 128) / 128;
        energy += norm * norm;
      }
      const rms = Math.sqrt(energy / samples.length);

      // Map RMS volume directly to mouth openness (reverted to original working logic)
      const mouthVal = 0.16 + Math.min(0.84, Math.max(0, rms - 0.012) * 14.5);
      this.avatar.setMouthOpen(mouthVal);

      this.animFrame = requestAnimationFrame(monitorLipSync);
    };

    source.onended = () => {
      if (this.animFrame) cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
      this.avatar.setState('idle');
      this.avatar.setMouthOpen(0.16);
      if (this.onPlaybackEnded) this.onPlaybackEnded();
    };

    source.start(0);
    monitorLipSync();
  }

  pcmToAudioBuffer(uint8Bytes, sampleRate = 24000) {
    const int16Array = new Int16Array(uint8Bytes.buffer, uint8Bytes.byteOffset, uint8Bytes.byteLength / 2);
    const audioBuffer = this.audioContext.createBuffer(1, int16Array.length, sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < int16Array.length; i++) {
      channelData[i] = int16Array[i] / 32768.0;
    }
    return audioBuffer;
  }
}
