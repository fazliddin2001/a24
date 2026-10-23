/**
 * Wake Word Listener ("Malika")
 * Lightweight client-side wake word detector using Web Speech API
 * - Passively listens in background for "Malika"
 * - Automatically triggers microphone recording when heard
 * - Pauses during active recording and TTS speech to prevent feedback loops
 */
export class WakeWordListener {
  constructor(onWakeCallback, onStatusChangeCallback = null) {
    this.onWake = onWakeCallback;
    this.onStatusChange = onStatusChangeCallback;
    this.recognition = null;
    this.isActive = false;
    this.isPaused = false;
    this.isSupported = false;

    // Wake keywords (Uzbek, phonetic variations, and Cyrillic)
    this.keywords = ['malika', 'malik', 'малика', 'malikam', 'ey malika', 'hey malika', 'molika'];

    this.initRecognition();
  }

  initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Web Speech API (SpeechRecognition) bu brauzerda qo\'llab-quvvatlanmaydi.');
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

      this.recognition.onresult = (event) => {
        if (this.isPaused) return;

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.toLowerCase().trim();
          console.log('[WakeWord Check]:', transcript);

          const matched = this.keywords.some((kw) => transcript.includes(kw));
          if (matched) {
            console.log('⚡ Wake word "Malika" aniqlandi! Mikrofon faollashtirilmoqda...');
            this.pause(); // Pause wake-word listening while user records/interacts
            if (this.onWake) {
              this.onWake(transcript);
            }
            break;
          }
        }
      };

      this.recognition.onerror = (event) => {
        // 'no-speech' or 'aborted' are normal lifecycle events
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn('WakeWord error:', event.error);
        }
      };

      this.recognition.onend = () => {
        // Continuous listener auto-reconnect if not explicitly paused or stopped
        if (this.isActive && !this.isPaused) {
          setTimeout(() => {
            if (this.isActive && !this.isPaused) {
              try {
                this.recognition.start();
              } catch (e) {
                // Ignore if already active
              }
            }
          }, 300);
        }
      };
    } catch (err) {
      console.error('WakeWord init xatosi:', err);
      this.isSupported = false;
    }
  }

  start() {
    if (!this.isSupported || !this.recognition) return false;
    this.isActive = true;
    this.isPaused = false;
    try {
      this.recognition.start();
      if (this.onStatusChange) this.onStatusChange(true, 'listening');
      return true;
    } catch (err) {
      // Already running
      if (this.onStatusChange) this.onStatusChange(true, 'listening');
      return true;
    }
  }

  pause() {
    this.isPaused = true;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (err) {}
    }
    if (this.onStatusChange) this.onStatusChange(false, 'paused');
  }

  resume() {
    if (!this.isActive || !this.isSupported) return;
    this.isPaused = false;
    setTimeout(() => {
      if (this.isActive && !this.isPaused) {
        try {
          this.recognition.start();
          if (this.onStatusChange) this.onStatusChange(true, 'listening');
        } catch (err) {}
      }
    }, 400);
  }

  stop() {
    this.isActive = false;
    this.isPaused = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (err) {}
    }
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
