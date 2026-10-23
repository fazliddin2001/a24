/**
 * Wake Word Listener ("Malika")
 * High-sensitivity client-side wake word detector using Web Speech API
 * - Passively and continuously listens for "Malika"
 * - Instant single-attempt trigger across alternative transcriptions
 * - Automatic robust reconnection with zero dead-time
 * - Pauses during active recording and TTS playback to prevent feedback loops
 */
export class WakeWordListener {
  constructor(onWakeCallback, onStatusChangeCallback = null) {
    this.onWake = onWakeCallback;
    this.onStatusChange = onStatusChangeCallback;
    this.recognition = null;
    this.isActive = false;
    this.isPaused = false;
    this.isListening = false;
    this.isSupported = false;
    this.restartTimer = null;

    // Comprehensive phonetic variations of "Malika" in Uzbek (Latin & Cyrillic)
    this.patterns = [
      'malika', 'malik', 'malikam', 'malikaxon', 'malikaa', 'alika',
      'molika', 'melika', 'marika', 'malka', 'manika',
      'малика', 'малик', 'молика', 'мэлика', 'маликам'
    ];
    this.regex = /\b(m[a-z]{0,2}lik[a-z]*|marika|molika|malka|малик[а-я]*)\b/i;

    this.initRecognition();
  }

  initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Web Speech API bu brauzerda mavjud emas.');
      this.isSupported = false;
      if (this.onStatusChange) this.onStatusChange(false, 'unsupported');
      return;
    }

    this.isSupported = true;
    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'uz-UZ';
      this.recognition.maxAlternatives = 3;

      this.recognition.onstart = () => {
        this.isListening = true;
        if (this.onStatusChange) this.onStatusChange(true, 'listening');
      };

      this.recognition.onresult = (event) => {
        if (this.isPaused) return;

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          // Check top alternatives for maximum recognition accuracy on first try
          for (let j = 0; j < res.length; j++) {
            const transcript = res[j].transcript.toLowerCase().trim();

            if (this.matchesWakeWord(transcript)) {
              console.log('⚡ "Malika" aniqlandi:', transcript);
              this.pause(); // Pause immediately so it does not conflict with mic recording
              if (this.onWake) {
                this.onWake(transcript);
              }
              return;
            }
          }
        }
      };

      this.recognition.onerror = (event) => {
        // 'no-speech' and 'aborted' are normal lifecycle events
        if (event.error === 'not-allowed') {
          console.warn('Mikrofon ruxsati berilmadi (WakeWord to\'xtatildi).');
          this.isActive = false;
          if (this.onStatusChange) this.onStatusChange(false, 'denied');
        } else {
          // Immediately schedule restart for transient errors
          this.scheduleRestart(40);
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        // Keep listening continuously: auto-restart with minimal delay
        if (this.isActive && !this.isPaused) {
          this.scheduleRestart(30);
        }
      };
    } catch (err) {
      console.error('WakeWord init xatosi:', err);
      this.isSupported = false;
    }
  }

  matchesWakeWord(text) {
    if (!text) return false;
    if (this.patterns.some((p) => text.includes(p))) return true;
    return this.regex.test(text);
  }

  scheduleRestart(delay = 50) {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      if (this.isActive && !this.isPaused && !this.isListening) {
        try {
          this.recognition.start();
          this.isListening = true;
        } catch (e) {
          // If already starting or engine busy, retry shortly
          this.scheduleRestart(150);
        }
      }
    }, delay);
  }

  start() {
    if (!this.isSupported || !this.recognition) return false;
    this.isActive = true;
    this.isPaused = false;
    try {
      this.recognition.start();
      this.isListening = true;
      if (this.onStatusChange) this.onStatusChange(true, 'listening');
      return true;
    } catch (err) {
      this.scheduleRestart(100);
      return true;
    }
  }

  pause() {
    this.isPaused = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (err) {}
    }
    this.isListening = false;
    if (this.onStatusChange) this.onStatusChange(false, 'paused');
  }

  resume() {
    if (!this.isActive || !this.isSupported) return;
    this.isPaused = false;
    this.scheduleRestart(100);
  }

  stop() {
    this.isActive = false;
    this.isPaused = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (err) {}
    }
    this.isListening = false;
    if (this.onStatusChange) this.onStatusChange(false, 'stopped');
  }

  toggle() {
    if (this.isActive) {
      this.stop();
      return false;
    } else {
      return this.start();
    }
  }
}
