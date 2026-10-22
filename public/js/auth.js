/**
 * Authentication Helper: Password modal and session management
 */
export class AuthManager {
  constructor(modalElement, errorElement, passwordInput, loginButton, onAuthenticated) {
    this.modal = modalElement;
    this.errorEl = errorElement;
    this.input = passwordInput;
    this.button = loginButton;
    this.onAuthenticated = onAuthenticated;

    this.bindEvents();
  }

  bindEvents() {
    this.button.addEventListener('click', () => this.handleLogin());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleLogin();
    });
  }

  showModal() {
    this.modal.classList.add('active');
    setTimeout(() => this.input.focus(), 150);
  }

  hideModal() {
    this.modal.classList.remove('active');
    this.errorEl.textContent = '';
    this.input.value = '';
  }

  static getToken() {
    return localStorage.getItem('a24_token') || '';
  }

  static getAuthHeaders() {
    const token = AuthManager.getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  async checkAuth() {
    const token = AuthManager.getToken();
    try {
      const res = await fetch('/api/auth/check', {
        headers: AuthManager.getAuthHeaders(),
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated) {
          this.hideModal();
          if (this.onAuthenticated) this.onAuthenticated();
          return true;
        }
      }
    } catch {}
    this.showModal();
    return false;
  }

  async handleLogin() {
    const password = this.input.value.trim();
    if (!password) {
      this.errorEl.textContent = 'Iltimos, parolni kiriting';
      return;
    }

    this.button.disabled = true;
    this.button.textContent = 'Tekshirilmoqda...';
    this.errorEl.textContent = '';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.token) {
          localStorage.setItem('a24_token', data.token);
        }
        this.hideModal();
        if (this.onAuthenticated) this.onAuthenticated();
      } else {
        this.errorEl.textContent = data.error || 'Parol noto\'g\'ri';
      }
    } catch (err) {
      this.errorEl.textContent = 'Server bilan aloqa uzildi';
    } finally {
      this.button.disabled = false;
      this.button.textContent = 'Kirish';
    }
  }
}
