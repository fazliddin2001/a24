/**
 * Audio Pipeline: Microphone recording, base64 encoding, audio-reactive playback,
 * and Voice Activity Detection (VAD) with silence auto-stop & 1-min cap
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

  // --- RECORDING PIPELINE WITH VAD & 1-MINUTE TIMEOUT ---
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

    // Check supported MIME type
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
    micAnalyser.smoothingTimeConstant = 0.5;
    micSource.connect(micAnalyser);

    const freqData = new Uint8Array(micAnalyser.frequencyBinCount);
    if (this.waveformBox) this.waveformBox.classList.add('active');

    // VAD state variables
    let hasSpoken = false;
    let lastVoiceTime = 0;
    const recordingStartTime = Date.now();
    const SILENCE_LIMIT_MS = 1800; // 1.8 seconds of silence to auto-stop after speech
    const MAX_DURATION_MS = 60000; // 1 minute maximum duration limit
    let autoStopFired = false;

    const triggerAutoStop = () => {
      if (autoStopFired || !this.isRecording) return;
      autoStopFired = true;
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

      // Check speech activity (voice energy above ambient noise threshold)
      if (avgEnergy > 0.08) {
        hasSpoken = true;
        lastVoiceTime = now;
      }

      // 1. If user spoke and has now been silent for 1.8 seconds -> Auto-stop!
      if (hasSpoken && lastVoiceTime > 0 && (now - lastVoiceTime >= SILENCE_LIMIT_MS)) {
        console.log('VAD: Jimlik aniqlandi (1.8s silence) -> yozish avtomatik toxtatildi');
        triggerAutoStop();
        return;
      }

      // 2. Or until 1 minute (60 seconds) whichever comes first!
      if (now - recordingStartTime >= MAX_DURATION_MS) {
        console.log('VAD: 1 daqiqalik maksimal vaqt chegarasi -> yozish avtomatik toxtatildi');
        triggerAutoStop();
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

  // --- PLAYBACK & SILKY SMOOTH LIP-SYNC PIPELINE ---
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

    // Analyser setup with Web Audio smoothing filter
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75; // Smooth exponential moving average

    source.connect(analyser);
    analyser.connect(this.audioContext.destination);

    this.currentSource = source;
    this.avatar.setState('speaking');

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const sampleRate = this.audioContext.sampleRate || 44100;
    const binSize = sampleRate / analyser.fftSize;

    // Human speech formant frequency band: ~250 Hz to ~3200 Hz
    const minBin = Math.max(1, Math.floor(250 / binSize));
    const maxBin = Math.min(analyser.frequencyBinCount - 1, Math.ceil(3200 / binSize));

    const monitorLipSync = () => {
      analyser.getByteFrequencyData(freqData);

      let voiceEnergySum = 0;
      let count = 0;
      for (let i = minBin; i <= maxBin; i++) {
        voiceEnergySum += freqData[i];
        count++;
      }
      const avgEnergy = count > 0 ? (voiceEnergySum / (count * 255)) : 0;

      // Feed smoothed vocal formant energy to 3D avatar
      this.avatar.setMouthOpen(avgEnergy);

      this.animFrame = requestAnimationFrame(monitorLipSync);
    };

    source.onended = () => {
      if (this.animFrame) cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
      this.avatar.setState('idle');
      this.avatar.setMouthOpen(0.0);
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
