import { AuthManager } from './auth.js';

/**
 * Admin Panel Controller
 * Handles visual object & key-value editing, raw JSON code editor,
 * and secure saving with admin_pass verification.
 */
export class AdminPanelController {
  constructor() {
    // Modal Elements
    this.modal = document.getElementById('adminDataModal');
    this.openBtn = document.getElementById('adminDataBtn');
    this.closeBtn = document.getElementById('closeAdminModalBtn');
    this.cancelBtn = document.getElementById('cancelAdminBtn');
    this.saveBtn = document.getElementById('saveAdminBtn');

    // Tabs
    this.tabVisualBtn = document.getElementById('tabVisualBtn');
    this.tabJsonBtn = document.getElementById('tabJsonBtn');
    this.tabVisualContent = document.getElementById('tabVisualContent');
    this.tabJsonContent = document.getElementById('tabJsonContent');

    // Visual Editor Elements
    this.sectionSelector = document.getElementById('sectionSelector');
    this.sectionsList = document.getElementById('adminSectionsList');
    this.addNewObjectBtn = document.getElementById('addNewObjectBtn');
    this.addNewFacultyBtn = document.getElementById('addNewFacultyBtn');

    // JSON Editor Elements
    this.jsonTextarea = document.getElementById('jsonTextarea');
    this.prettifyJsonBtn = document.getElementById('prettifyJsonBtn');
    this.jsonSyntaxError = document.getElementById('jsonSyntaxError');

    // Password Prompt Elements
    this.passModal = document.getElementById('adminPassPromptModal');
    this.passInput = document.getElementById('adminPassInput');
    this.passError = document.getElementById('adminPassError');
    this.cancelPassBtn = document.getElementById('cancelAdminPassBtn');
    this.confirmPassBtn = document.getElementById('confirmAdminPassBtn');

    // State
    this.currentData = null;
    this.activeTab = 'visual'; // 'visual' | 'json'

    this.initEventListeners();
  }

  initEventListeners() {
    if (this.openBtn) {
      this.openBtn.addEventListener('click', () => this.open());
    }

    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());
    if (this.cancelBtn) this.cancelBtn.addEventListener('click', () => this.close());

    // Tab Switchers
    if (this.tabVisualBtn && this.tabJsonBtn) {
      this.tabVisualBtn.addEventListener('click', () => this.switchTab('visual'));
      this.tabJsonBtn.addEventListener('click', () => this.switchTab('json'));
    }

    // Section filter selector
    if (this.sectionSelector) {
      this.sectionSelector.addEventListener('change', () => this.renderVisualEditor());
    }

    // Add Object & Faculty buttons
    if (this.addNewObjectBtn) {
      this.addNewObjectBtn.addEventListener('click', () => this.promptAddNewObject());
    }
    if (this.addNewFacultyBtn) {
      this.addNewFacultyBtn.addEventListener('click', () => this.addNewFaculty());
    }

    // Prettify JSON button
    if (this.prettifyJsonBtn) {
      this.prettifyJsonBtn.addEventListener('click', () => this.prettifyJson());
    }

    // Save action
    if (this.saveBtn) {
      this.saveBtn.addEventListener('click', () => this.initiateSave());
    }

    // Password Prompt buttons
    if (this.cancelPassBtn) {
      this.cancelPassBtn.addEventListener('click', () => this.closePassPrompt());
    }
    if (this.confirmPassBtn) {
      this.confirmPassBtn.addEventListener('click', () => this.submitSaveWithPassword());
    }
    if (this.passInput) {
      this.passInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.submitSaveWithPassword();
        if (e.key === 'Escape') this.closePassPrompt();
      });
    }

    // Close on backdrop click
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.close();
      });
    }
    if (this.passModal) {
      this.passModal.addEventListener('click', (e) => {
        if (e.target === this.passModal) this.closePassPrompt();
      });
    }
  }

  async open() {
    if (!this.modal) return;
    this.modal.classList.add('active');
    this.switchTab('visual');
    await this.fetchInstituteData();
  }

  close() {
    if (this.modal) this.modal.classList.remove('active');
    this.closePassPrompt();
  }

  openPassPrompt() {
    if (this.passModal) {
      this.passModal.classList.add('active');
      if (this.passInput) {
        this.passInput.value = '';
        setTimeout(() => this.passInput.focus(), 100);
      }
      if (this.passError) this.passError.textContent = '';
    }
  }

  closePassPrompt() {
    if (this.passModal) this.passModal.classList.remove('active');
  }

  switchTab(tab) {
    this.activeTab = tab;

    if (tab === 'visual') {
      // Sync from JSON to Visual if changed
      if (this.jsonTextarea && this.jsonTextarea.value.trim()) {
        try {
          const parsed = JSON.parse(this.jsonTextarea.value);
          this.currentData = parsed;
          if (this.jsonSyntaxError) this.jsonSyntaxError.textContent = '';
        } catch (e) {
          if (this.jsonSyntaxError) this.jsonSyntaxError.textContent = `JSON xatosi: ${e.message}`;
          return;
        }
      }

      this.tabVisualBtn.classList.add('active');
      this.tabJsonBtn.classList.remove('active');
      this.tabVisualContent.style.display = 'block';
      this.tabJsonContent.style.display = 'none';
      this.renderVisualEditor();
    } else {
      // Sync from Visual to JSON
      this.tabVisualBtn.classList.remove('active');
      this.tabJsonBtn.classList.add('active');
      this.tabVisualContent.style.display = 'none';
      this.tabJsonContent.style.display = 'block';

      if (this.jsonTextarea && this.currentData) {
        this.jsonTextarea.value = JSON.stringify(this.currentData, null, 2);
      }
    }
  }

  async fetchInstituteData() {
    try {
      const res = await fetch('/api/admin/institute-data', {
        headers: AuthManager.getAuthHeaders(),
        credentials: 'include'
      });

      if (!res.ok) throw new Error('Ma\'lumotlarni serverdan yuklab bo\'lmadi');
      const json = await res.json();
      this.currentData = json.data;

      this.renderVisualEditor();
      if (this.jsonTextarea) {
        this.jsonTextarea.value = JSON.stringify(this.currentData, null, 2);
      }
    } catch (err) {
      console.error(err);
      this.showToast('Xatolik: ' + err.message, 'error');
    }
  }

  renderVisualEditor() {
    if (!this.sectionsList || !this.currentData) return;
    this.sectionsList.innerHTML = '';

    const inst = this.currentData.institute || (this.currentData.institute = {});
    const filter = this.sectionSelector ? this.sectionSelector.value : 'all';

    // 1. General Info
    if (filter === 'all' || filter === 'general') {
      this.renderKeyValueSection('🏢 Institut Asosiy Ma\'lumotlari', inst, [
        { key: 'name', label: 'Institut to\'liq nomi' },
        { key: 'shortName', label: 'Qisqartma nomi' },
        { key: 'location', label: 'Joylashuvi / Manzili' },
        { key: 'established', label: 'Tashkil topishi' }
      ]);
    }

    // 2. Statistics
    if (filter === 'all' || filter === 'statistics') {
      const stats = inst.statistics || (inst.statistics = {});
      this.renderDynamicObjectSection('📊 Statistika', stats, 'statistics');
    }

    // 3. Faculties
    if (filter === 'all' || filter === 'faculties') {
      const faculties = inst.faculties || (inst.faculties = []);
      this.renderFacultiesSection(faculties);
    }

    // 4. Academic Systems
    if (filter === 'all' || filter === 'academicSystems') {
      const academic = inst.academicSystems || (inst.academicSystems = {});
      this.renderDynamicObjectSection('💻 Ta\'lim Tizimlari (HEMIS, ECTS, ARM)', academic, 'academicSystems');
    }

    // 5. Student Services
    if (filter === 'all' || filter === 'studentServices') {
      const services = inst.studentServices || (inst.studentServices = {});
      this.renderDynamicObjectSection('🏠 Talabalar Xizmatlari (TTJ, Kontrakt, Perevod)', services, 'studentServices');
    }

    // 6. Custom Sections
    if (filter === 'all' || filter === 'custom') {
      const standardKeys = ['name', 'shortName', 'location', 'established', 'statistics', 'faculties', 'academicSystems', 'studentServices'];
      for (const [secKey, secVal] of Object.entries(inst)) {
        if (!standardKeys.includes(secKey) && typeof secVal === 'object' && secVal !== null) {
          this.renderCustomObjectSection(secKey, secVal);
        }
      }
    }
  }

  renderKeyValueSection(title, targetObj, fields) {
    const card = document.createElement('div');
    card.className = 'admin-card-section';
    card.innerHTML = `<h3 class="admin-section-title">${title}</h3>`;

    fields.forEach(({ key, label }) => {
      const row = document.createElement('div');
      row.className = 'admin-field-row';
      row.innerHTML = `
        <label class="admin-field-label">${label} (<code>${key}</code>):</label>
        <input type="text" class="admin-field-input" value="${targetObj[key] || ''}" />
      `;
      const input = row.querySelector('input');
      input.addEventListener('input', (e) => {
        targetObj[key] = e.target.value;
      });
      card.appendChild(row);
    });

    this.sectionsList.appendChild(card);
  }

  renderDynamicObjectSection(title, targetObj, sectionId) {
    const card = document.createElement('div');
    card.className = 'admin-card-section';

    const header = document.createElement('div');
    header.className = 'admin-section-header-row';
    header.innerHTML = `
      <h3 class="admin-section-title">${title}</h3>
      <button class="btn-sm-action add-field-btn">+ Maydon qo'shish</button>
    `;
    card.appendChild(header);

    const fieldsContainer = document.createElement('div');
    fieldsContainer.className = 'admin-dynamic-fields-box';

    const renderRows = () => {
      fieldsContainer.innerHTML = '';
      for (const [key, val] of Object.entries(targetObj)) {
        const row = document.createElement('div');
        row.className = 'admin-kv-row';
        row.innerHTML = `
          <input type="text" class="admin-kv-key" value="${key}" title="Maydon kaliti" />
          <input type="text" class="admin-kv-val" value="${typeof val === 'object' ? JSON.stringify(val) : val}" title="Qiymat" />
          <button class="btn-remove-row" title="O'chirish">🗑</button>
        `;

        const keyInput = row.querySelector('.admin-kv-key');
        const valInput = row.querySelector('.admin-kv-val');
        const removeBtn = row.querySelector('.btn-remove-row');

        keyInput.addEventListener('change', (e) => {
          const newKey = e.target.value.trim();
          if (newKey && newKey !== key) {
            targetObj[newKey] = targetObj[key];
            delete targetObj[key];
            renderRows();
          }
        });

        valInput.addEventListener('input', (e) => {
          targetObj[key] = e.target.value;
        });

        removeBtn.addEventListener('click', () => {
          delete targetObj[key];
          renderRows();
        });

        fieldsContainer.appendChild(row);
      }
    };

    renderRows();
    card.appendChild(fieldsContainer);

    const addBtn = header.querySelector('.add-field-btn');
    addBtn.addEventListener('click', () => {
      const propName = prompt('Yangi maydon nomini kiriting (masalan: grantlar, stipendiya):');
      if (propName && propName.trim()) {
        targetObj[propName.trim()] = '';
        renderRows();
      }
    });

    this.sectionsList.appendChild(card);
  }

  renderFacultiesSection(facultiesArray) {
    const card = document.createElement('div');
    card.className = 'admin-card-section';

    const header = document.createElement('div');
    header.className = 'admin-section-header-row';
    header.innerHTML = `
      <h3 class="admin-section-title">🎓 Fakultetlar va Yo'nalishlar</h3>
      <button class="btn-sm-action add-faculty-btn">+ Yangi fakultet</button>
    `;
    card.appendChild(header);

    const facultiesBox = document.createElement('div');
    facultiesBox.className = 'admin-faculties-box';

    const renderFaculties = () => {
      facultiesBox.innerHTML = '';
      facultiesArray.forEach((fac, idx) => {
        const facRow = document.createElement('div');
        facRow.className = 'admin-faculty-card';

        const dirsStr = Array.isArray(fac.directions) ? fac.directions.join(', ') : (fac.directions || '');
        facRow.innerHTML = `
          <div class="faculty-card-header">
            <strong>Fakultet #${idx + 1}</strong>
            <button class="btn-remove-row remove-fac-btn" title="Fakultetni o'chirish">🗑</button>
          </div>
          <div class="admin-field-row">
            <label class="admin-field-label">Fakultet nomi:</label>
            <input type="text" class="admin-field-input fac-name" value="${fac.name || ''}" />
          </div>
          <div class="admin-field-row">
            <label class="admin-field-label">Ta'lim yo'nalishlari (vergul bilan ajrating):</label>
            <input type="text" class="admin-field-input fac-dirs" value="${dirsStr}" placeholder="Filologiya, Tarjima..." />
          </div>
        `;

        const nameInput = facRow.querySelector('.fac-name');
        const dirsInput = facRow.querySelector('.fac-dirs');
        const removeBtn = facRow.querySelector('.remove-fac-btn');

        nameInput.addEventListener('input', (e) => {
          fac.name = e.target.value;
        });

        dirsInput.addEventListener('input', (e) => {
          fac.directions = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
        });

        removeBtn.addEventListener('click', () => {
          facultiesArray.splice(idx, 1);
          renderFaculties();
        });

        facultiesBox.appendChild(facRow);
      });
    };

    renderFaculties();
    card.appendChild(facultiesBox);

    const addBtn = header.querySelector('.add-faculty-btn');
    addBtn.addEventListener('click', () => {
      facultiesArray.push({
        name: 'Yangi fakultet nomi',
        directions: ['Yo\'nalish 1', 'Yo\'nalish 2']
      });
      renderFaculties();
    });

    this.sectionsList.appendChild(card);
  }

  renderCustomObjectSection(secKey, secObj) {
    const card = document.createElement('div');
    card.className = 'admin-card-section custom-section';

    const header = document.createElement('div');
    header.className = 'admin-section-header-row';
    header.innerHTML = `
      <h3 class="admin-section-title">✨ ${secKey} (Maxsus bo'lim)</h3>
      <div class="header-action-group">
        <button class="btn-sm-action add-field-btn">+ Maydon</button>
        <button class="btn-remove-row delete-sec-btn" title="Bo'limni o'chirish">🗑</button>
      </div>
    `;
    card.appendChild(header);

    const fieldsContainer = document.createElement('div');
    fieldsContainer.className = 'admin-dynamic-fields-box';

    const renderRows = () => {
      fieldsContainer.innerHTML = '';
      for (const [key, val] of Object.entries(secObj)) {
        const row = document.createElement('div');
        row.className = 'admin-kv-row';
        row.innerHTML = `
          <input type="text" class="admin-kv-key" value="${key}" title="Kalit" />
          <input type="text" class="admin-kv-val" value="${typeof val === 'object' ? JSON.stringify(val) : val}" title="Qiymat" />
          <button class="btn-remove-row" title="O'chirish">🗑</button>
        `;

        const keyInput = row.querySelector('.admin-kv-key');
        const valInput = row.querySelector('.admin-kv-val');
        const removeBtn = row.querySelector('.btn-remove-row');

        keyInput.addEventListener('change', (e) => {
          const newKey = e.target.value.trim();
          if (newKey && newKey !== key) {
            secObj[newKey] = secObj[key];
            delete secObj[key];
            renderRows();
          }
        });

        valInput.addEventListener('input', (e) => {
          secObj[key] = e.target.value;
        });

        removeBtn.addEventListener('click', () => {
          delete secObj[key];
          renderRows();
        });

        fieldsContainer.appendChild(row);
      }
    };

    renderRows();
    card.appendChild(fieldsContainer);

    header.querySelector('.add-field-btn').addEventListener('click', () => {
      const p = prompt('Yangi maydon nomini kiriting:');
      if (p && p.trim()) {
        secObj[p.trim()] = '';
        renderRows();
      }
    });

    header.querySelector('.delete-sec-btn').addEventListener('click', () => {
      if (confirm(`Haqiqatan ham '${secKey}' bo'limini o'chirmoqchimisiz?`)) {
        delete this.currentData.institute[secKey];
        this.renderVisualEditor();
      }
    });

    this.sectionsList.appendChild(card);
  }

  promptAddNewObject() {
    const secName = prompt('Yangi bo\'lim (obyekt) nomini kiriting (masalan: grantlar, xalqaro_aloqalar):');
    if (!secName || !secName.trim()) return;

    const safeName = secName.trim().replace(/\s+/g, '_');
    if (!this.currentData.institute) this.currentData.institute = {};
    if (this.currentData.institute[safeName]) {
      alert('Bu nomdagi bo\'lim allaqachon mavjud!');
      return;
    }

    this.currentData.institute[safeName] = {
      malumot: 'Boshlang\'ich ma\'lumot'
    };
    this.renderVisualEditor();
  }

  addNewFaculty() {
    if (!this.currentData.institute) this.currentData.institute = {};
    if (!Array.isArray(this.currentData.institute.faculties)) {
      this.currentData.institute.faculties = [];
    }
    this.currentData.institute.faculties.push({
      name: 'Yangi fakultet nomi',
      directions: ['Yo\'nalish 1']
    });
    this.renderVisualEditor();
  }

  prettifyJson() {
    if (!this.jsonTextarea) return;
    try {
      const parsed = JSON.parse(this.jsonTextarea.value);
      this.jsonTextarea.value = JSON.stringify(parsed, null, 2);
      if (this.jsonSyntaxError) this.jsonSyntaxError.textContent = '';
    } catch (e) {
      if (this.jsonSyntaxError) this.jsonSyntaxError.textContent = `Formatlash xatosi: ${e.message}`;
    }
  }

  initiateSave() {
    // If in JSON tab, validate JSON first
    if (this.activeTab === 'json') {
      try {
        const parsed = JSON.parse(this.jsonTextarea.value);
        this.currentData = parsed;
        if (this.jsonSyntaxError) this.jsonSyntaxError.textContent = '';
      } catch (e) {
        if (this.jsonSyntaxError) this.jsonSyntaxError.textContent = `JSON formati noto'g'ri: ${e.message}`;
        alert('Iltimos, JSON formatidagi xatolikni to\'g\'rilang: ' + e.message);
        return;
      }
    }

    this.openPassPrompt();
  }

  async submitSaveWithPassword() {
    const pass = this.passInput ? this.passInput.value.trim() : '';
    if (!pass) {
      if (this.passError) this.passError.textContent = 'Admin parolini kiritish shart!';
      return;
    }

    if (this.passError) this.passError.textContent = 'Saqlanmoqda...';

    try {
      const res = await fetch('/api/admin/institute-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...AuthManager.getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({
          data: this.currentData,
          password: pass
        })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Server saqlashni rad etdi');
      }

      // Success!
      this.closePassPrompt();
      this.close();
      this.showToast('✅ Institut ma\'lumotlari muvaffaqiyatli saqlandi! Malika javob berishda yangi ma\'lumotlardan foydalanadi.', 'success');

    } catch (err) {
      console.error(err);
      if (this.passError) {
        this.passError.textContent = err.message;
      }
    }
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `admin-toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }
}
