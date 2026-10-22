/**
 * Avatar Controller: Multi-frame natural animation with audio-driven lip sync and eye blinking
 */
export class AvatarController {
  constructor(avatarElement, statusTextElement, statusDotElement, statusSection) {
    this.avatarElement = avatarElement;
    this.statusTextElement = statusTextElement;
    this.statusDotElement = statusDotElement;
    this.statusSection = statusSection;

    // Layer elements
    this.frameIdle = document.getElementById('frameIdle');
    this.frameTalkSmall = document.getElementById('frameTalkSmall');
    this.frameTalkOpen = document.getElementById('frameTalkOpen');
    this.frameBlink = document.getElementById('frameBlink');

    this.layers = [this.frameIdle, this.frameTalkSmall, this.frameTalkOpen, this.frameBlink].filter(Boolean);

    this.state = 'idle'; // 'idle' | 'listening' | 'thinking' | 'speaking'
    this.pulseRaf = null;
    this.pulseStart = 0;
    this.pulseEnd = 0;
    this.blinkTimer = null;
    this.isBlinking = false;
    this.currentFrame = 'idle';

    this.initBlinking();
    this.setState('idle');
  }

  showFrame(frameName) {
    if (this.isBlinking && frameName !== 'blink') {
      this.currentFrame = frameName;
      return;
    }

    this.currentFrame = frameName;
    const targetMap = {
      'idle': this.frameIdle,
      'small': this.frameTalkSmall,
      'open': this.frameTalkOpen,
      'blink': this.frameBlink
    };

    const targetEl = targetMap[frameName] || this.frameIdle;
    this.layers.forEach(layer => {
      if (layer === targetEl) layer.classList.add('active');
      else layer.classList.remove('active');
    });
  }

  initBlinking() {
    const scheduleNextBlink = () => {
      if (this.blinkTimer) clearTimeout(this.blinkTimer);
      // Blink every 3.5 to 6 seconds
      const nextDelay = 3500 + Math.random() * 2500;
      this.blinkTimer = setTimeout(() => {
        if (this.state === 'idle' || this.state === 'listening') {
          this.triggerBlink();
        }
        scheduleNextBlink();
      }, nextDelay);
    };

    scheduleNextBlink();
  }

  triggerBlink() {
    if (this.isBlinking) return;
    this.isBlinking = true;
    const previousFrame = this.currentFrame;

    if (this.frameBlink) {
      this.layers.forEach(layer => {
        if (layer === this.frameBlink) layer.classList.add('active');
        else layer.classList.remove('active');
      });
    }

    setTimeout(() => {
      this.isBlinking = false;
      this.showFrame(previousFrame || 'idle');
    }, 130);
  }

  setMouthOpen(value) {
    if (this.isBlinking) return;

    const v = Number(value) || 0.16;

    if (v < 0.28) {
      this.showFrame('idle');
    } else if (v < 0.55) {
      this.showFrame('small');
    } else {
      this.showFrame('open');
    }
  }

  setState(state) {
    this.state = state;

    // Reset container classes
    this.avatarElement.classList.remove('listening', 'thinking', 'speaking');
    if (this.statusSection) {
      this.statusSection.classList.remove('idle', 'listening', 'thinking', 'speaking');
      this.statusSection.classList.add(state);
    }

    if (state === 'listening') {
      this.avatarElement.classList.add('listening');
      this.updateStatus('Eshitilmoqda... (Listening)', '#10b981');
      this.stopPulse();
      this.showFrame('idle');
    } else if (state === 'thinking') {
      this.avatarElement.classList.add('thinking');
      this.updateStatus('Fikrlanmoqda... (Thinking)', '#8b5cf6');
      this.stopPulse();
      this.showFrame('idle');
    } else if (state === 'speaking') {
      this.avatarElement.classList.add('speaking');
      this.updateStatus('Javob bermoqda... (Speaking)', '#2563eb');
    } else {
      this.updateStatus('Tayyor (Ready)', '#10b981');
      this.stopPulse();
      this.showFrame('idle');
    }
  }

  updateStatus(text, color) {
    if (this.statusTextElement) this.statusTextElement.textContent = text;
    if (this.statusDotElement && color) this.statusDotElement.style.background = color;
  }

  // Fallback organic mouth animation
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
      // Syllable oscillation
      const syllable = Math.sin(t * 11.2) * 0.5 + Math.sin(t * 5.6 + 0.8) * 0.3 + 0.2;
      this.setMouthOpen(0.16 + Math.max(0, syllable * 0.7));
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
    this.showFrame('idle');
  }
}
