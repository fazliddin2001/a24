import { AvatarController } from './avatar.js';
import { AudioPipeline } from './audio.js';
import { AuthManager } from './auth.js';
import { WakeWordListener } from './wakeword.js';
import { AdminPanelController } from './admin.js';

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const avatarEl = document.getElementById('avatarContainer');
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');
  const statusSection = document.getElementById('avatarSection');
  const waveformBox = document.getElementById('waveformBox');
  const micBtn = document.getElementById('micButton');
  const wakeBadge = document.getElementById('wakeBadge');
  const chatHistory = document.getElementById('chatHistory');
  const textInput = document.getElementById('textInput');
  const sendBtn = document.getElementById('sendBtn');
  const turnBadge = document.getElementById('turnBadge');
  const turnCounter = document.getElementById('turnCounter');
  const resetBtn = document.getElementById('resetBtn');
  const quickChips = document.querySelectorAll('.quick-chip');

  // Auth Elements
  const authModal = document.getElementById('authModal');
  const authInput = document.getElementById('authPasswordInput');
  const authBtn = document.getElementById('authSubmitBtn');
  const authError = document.getElementById('authError');

  // Controllers
  const avatar = new AvatarController(avatarEl, statusText, statusDot, statusSection);
  const audio = new AudioPipeline(avatar, waveformBox);
  const adminPanel = new AdminPanelController();

  // Conversation State
  let conversationHistory = [];
  let turnCount = 1;
  const MAX_TURNS = 4;
  let isRecording = false;

  const updateTurnUI = () => {
    if (turnCounter) turnCounter.textContent = `${turnCount} / ${MAX_TURNS}`;
    if (turnBadge) {
      if (turnCount >= MAX_TURNS) turnBadge.classList.add('near-limit');
      else turnBadge.classList.remove('near-limit');
    }
  };

  const resetConversation = (notify = true) => {
    conversationHistory = [];
    turnCount = 1;
    updateTurnUI();
    if (notify) {
      appendSystemNotice("Suhbat yangilandi. Yangi savolingizni so'rashingiz mumkin.");
    }
  };

  // Auth initialization
  const auth = new AuthManager(authModal, authError, authInput, authBtn, () => {
    console.log('Foydalanuvchi tasdiqlandi');
  });
  auth.checkAuth();

  // Reset Button
  resetBtn.addEventListener('click', () => {
    resetConversation(true);
  });

  // UI Helpers
  function appendMessage(role, text, thought = null, audioBase64 = null) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    // If assistant has a thinking reasoning block, add a neat collapsible toggle
    if (role === 'assistant' && thought) {
      const toggle = document.createElement('div');
      toggle.className = 'thought-toggle';
      toggle.innerHTML = '<span>✦ Fikrlash jarayoni</span>';

      const thoughtBox = document.createElement('div');
      thoughtBox.className = 'thought-content';
      thoughtBox.textContent = thought;

      toggle.addEventListener('click', () => {
        thoughtBox.classList.toggle('open');
      });

      bubble.appendChild(toggle);
      bubble.appendChild(thoughtBox);
    }

    const textSpan = document.createElement('div');
    textSpan.className = 'message-text';
    textSpan.textContent = text;
    bubble.appendChild(textSpan);

    // Audio replay button if audio is attached
    if (role === 'assistant' && audioBase64) {
      const replayBtn = document.createElement('button');
      replayBtn.className = 'message-audio-btn';
      replayBtn.innerHTML = '▶ Qayta tinglash';
      replayBtn.addEventListener('click', () => {
        wakeWord.pause();
        audio.playBase64Audio(audioBase64);
      });
      bubble.appendChild(replayBtn);
    }

    msgDiv.appendChild(bubble);
    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  function appendSystemNotice(text) {
    const notice = document.createElement('div');
    notice.style.textAlign = 'center';
    notice.style.fontSize = '12px';
    notice.style.color = '#64748b';
    notice.style.margin = '8px 0';
    notice.style.fontStyle = 'italic';
    notice.textContent = `— ${text} —`;
    chatHistory.appendChild(notice);
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  // --- RECORDING WORKFLOW WITH VAD (SILENCE & 1-MIN CAP) ---
  async function startRecordingFlow() {
    if (isRecording) return;
    try {
      wakeWord.pause();
      isRecording = true;
      micBtn.classList.add('recording');
      micBtn.innerHTML = '⏹';

      // startRecording accepts onAutoStop callback (fired by 1.8s silence or 60s max)
      await audio.startRecording(async () => {
        await stopRecordingFlow();
      });
    } catch (err) {
      isRecording = false;
      micBtn.classList.remove('recording');
      micBtn.innerHTML = '🎙';
      console.error('Mic start error:', err);
      alert('Mikrofon ruxsati berilmadi yoki mavjud emas: ' + err.message);
      wakeWord.resume();
    }
  }

  async function stopRecordingFlow() {
    if (!isRecording) return;
    isRecording = false;
    micBtn.classList.remove('recording');
    micBtn.innerHTML = '🎙';

    const audioData = await audio.stopRecording();
    if (audioData) {
      submitQuery({ audioData });
    } else {
      wakeWord.resume();
    }
  }

  // Submit User Request (Audio or Text)
  async function submitQuery({ audioData, text }) {
    if (avatar.state === 'thinking' || avatar.state === 'speaking') return;

    wakeWord.pause();

    if (text) {
      appendMessage('user', text);
    } else {
      appendMessage('user', '🎙 Ovozli savol berildi...');
    }

    avatar.setState('thinking');

    try {
      const payload = {
        history: conversationHistory,
        generateSpeech: true
      };

      if (audioData) {
        payload.audio = audioData;
      } else {
        payload.text = text;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...AuthManager.getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (res.status === 401) {
        localStorage.removeItem('a24_token');
        auth.showModal();
        avatar.setState('idle');
        wakeWord.resume();
        return;
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Server javob bermadi');
      }

      const data = await res.json();

      // Render assistant message
      appendMessage('assistant', data.text, data.thought, data.audio);

      // Save to history
      conversationHistory.push({
        role: 'user',
        parts: text ? [{ text }] : [{ text: 'Foydalanuvchi ovozli savol berdi' }]
      });
      conversationHistory.push({
        role: 'model',
        parts: [{ text: data.text }]
      });

      // Update turn counter
      turnCount = (data.turnCount || turnCount) + 1;
      updateTurnUI();

      // Play returned TTS audio (which drives smooth 3D lip-sync)
      if (data.audio) {
        audio.playBase64Audio(data.audio, data.audioMimeType || 'audio/mp3');
      } else {
        avatar.setState('idle');
        wakeWord.resume();
      }

      // Check context turn limit (3-4 turns)
      if (data.shouldReset || turnCount > MAX_TURNS) {
        setTimeout(() => {
          resetConversation(true);
        }, 3000);
      }

    } catch (err) {
      console.error(err);
      appendMessage('assistant', `Kechirasiz, xatolik yuz berdi: ${err.message}`);
      avatar.setState('idle');
      wakeWord.resume();
    }
  }

  // --- WAKE WORD LISTENER ("Malika") ---
  const wakeWord = new WakeWordListener(
    (detectedTranscript) => {
      console.log('⚡ "Malika" wake-word triggered!');
      if (wakeBadge) {
        wakeBadge.classList.add('triggered');
        const textSpan = wakeBadge.querySelector('.wake-word-text');
        if (textSpan) textSpan.textContent = '"Malika" eshitildi!';
      }
      setTimeout(() => {
        if (wakeBadge) {
          wakeBadge.classList.remove('triggered');
          const textSpan = wakeBadge.querySelector('.wake-word-text');
          if (textSpan) textSpan.textContent = '"Malika" deb chaqiring';
        }
      }, 1600);

      // Automatically activate recording
      startRecordingFlow();
    },
    (isActive, status) => {
      if (wakeBadge) {
        if (isActive) {
          wakeBadge.classList.add('active');
          wakeBadge.title = "Ovozli chaqiruv faol: 'Malika' deb ayting (o'chirish uchun bosing)";
        } else if (status !== 'paused') {
          wakeBadge.classList.remove('active');
          wakeBadge.title = "Ovozli chaqiruv o'chiq (yoqish uchun bosing)";
        }
      }
    }
  );

  // Resume wake-word listening automatically when assistant completes speaking
  audio.onPlaybackEnded = () => {
    wakeWord.resume();
  };

  // Toggle wake word manually via badge click
  if (wakeBadge) {
    wakeBadge.addEventListener('click', () => {
      const active = wakeWord.toggle();
      if (!active) {
        wakeBadge.classList.remove('active');
      }
    });
  }

  // Start wake-word continuous detection
  wakeWord.start();

  // Microphone Manual Click Handler
  micBtn.addEventListener('click', () => {
    if (!isRecording) {
      startRecordingFlow();
    } else {
      stopRecordingFlow();
    }
  });

  // Text Send Handler
  function handleTextSend() {
    const val = textInput.value.trim();
    if (!val) return;
    textInput.value = '';
    submitQuery({ text: val });
  }

  sendBtn.addEventListener('click', handleTextSend);
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleTextSend();
  });

  // Quick Suggestion Chips
  quickChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.getAttribute('data-q');
      if (q) submitQuery({ text: q });
    });
  });

  updateTurnUI();
});
