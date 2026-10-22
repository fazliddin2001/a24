/**
 * Avatar Controller: Manages interactive states and audio-driven lip movements
 */
export class AvatarController {
  constructor(avatarElement, statusTextElement, statusDotElement, statusSection) {
    this.avatarElement = avatarElement;
    this.statusTextElement = statusTextElement;
    this.statusDotElement = statusDotElement;
    this.statusSection = statusSection;
    this.state = 'idle'; // 'idle' | 'listening' | 'thinking' | 'speaking'
    this.pulseRaf = null;
    this.pulseStart = 0;
    this.pulseEnd = 0;

    this.setState('idle');
  }

  setMouthOpen(value) {
    const v = Math.max(0.16, Math.min(1.0, Number(value) || 0.16));
    this.avatarElement.style.setProperty('--mouth-open', v.toFixed(3));
  }

  setState(state) {
    this.state = state;
    
    // Reset classes
    this.avatarElement.classList.remove('listening', 'thinking', 'speaking');
    if (this.statusSection) {
      this.statusSection.classList.remove('idle', 'listening', 'thinking', 'speaking');
      this.statusSection.classList.add(state);
    }

    if (state === 'listening') {
      this.avatarElement.classList.add('listening');
      this.updateStatus('Eshitilmoqda... (Listening)', '#10b981');
      this.stopPulse();
    } else if (state === 'thinking') {
      this.avatarElement.classList.add('thinking');
      this.updateStatus('Fikrlanmoqda... (Thinking)', '#8b5cf6');
      this.stopPulse();
    } else if (state === 'speaking') {
      this.avatarElement.classList.add('speaking');
      this.updateStatus('Javob bermoqda... (Speaking)', '#2563eb');
    } else {
      this.updateStatus('Tayyor (Ready)', '#10b981');
      this.stopPulse();
      this.setMouthOpen(0.16);
    }
  }

  updateStatus(text, color) {
    if (this.statusTextElement) this.statusTextElement.textContent = text;
    if (this.statusDotElement && color) this.statusDotElement.style.background = color;
  }

  // Fallback organic mouth pulsation when raw PCM is being simulated or during Web Speech
  startPulse(durationMs = 4000) {
    this.stopPulse();
    this.setState('speaking');
    this.pulseStart = performance.now();
    this.pulseEnd = this.pulseStart + durationMs;

    const loop = (now) => {
      if (!this.pulseEnd || now >= this.pulseEnd) {
        this.stopPulse();
        this.setState('idle');
        return;
      }
      const t = (now - this.pulseStart) / 1000;
      // Syllable rhythm simulation
      const syllable = Math.max(0, Math.sin(t * 11.2) * 0.52 + Math.sin(t * 5.6 + 0.8) * 0.28 + 0.18);
      const breath = Math.max(0, Math.sin(t * 2.2) * 0.08);
      this.setMouthOpen(0.16 + Math.min(0.84, syllable * 0.85 + breath));
      this.pulseRaf = requestAnimationFrame(loop);
    };

    this.pulseRaf = requestAnimationFrame(loop);
  }

  stopPulse() {
    if (this.pulseRaf !== null) {
      cancelAnimationFrame(this.pulseRaf);
      this.pulseRaf = null;
    }
    this.pulseEnd = 0;
    this.setMouthOpen(0.16);
  }
}
