import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * 3D Avatar Controller using Three.js & GLTF
 * Implements:
 * - GLB loading & rendering at medium responsive size (320px desktop, 240px mobile)
 * - Draggable movement around the page with dock reset
 * - Natural idle eye blinking (~every 3.5-5.5s)
 * - State management (idle, listening, thinking, speaking)
 * - Strict overlay visibility handling (object.visible = false AND ShowOverlay shape key = 0)
 * - Audio-reactive mouth overlays with immediate close on speech end
 * - Removal of Blender default Cube
 */
export class Avatar3DController {
  constructor(containerElement, statusTextElement, statusDotElement, statusSection) {
    this.container = containerElement;
    this.avatarElement = containerElement; // Backwards compatibility
    this.statusTextElement = statusTextElement;
    this.statusDotElement = statusDotElement;
    this.statusSection = statusSection;

    // Overlay & Mesh references
    this.ovrEyesClosed = null;
    this.ovrMouthWide = null;
    this.baseMesh = null;
    this.avatarRoot = null;

    // Animation & State
    this.state = 'idle'; // 'idle' | 'listening' | 'thinking' | 'speaking'
    this.isBlinking = false;
    this.blinkTimer = null;
    this.pulseRaf = null;
    this.pulseStart = 0;
    this.pulseEnd = 0;
    this.isLoaded = false;

    // Three.js Core
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.animFrameId = null;
    this.clock = new THREE.Clock();

    // Subtle natural head orientation tracking
    this.mouseTarget = new THREE.Vector2(0, 0);
    this.mouseCurrent = new THREE.Vector2(0, 0);

    this.initThree();
    this.loadModel('assets/untitled.glb');
    this.initDraggable();
  }

  initThree() {
    const width = this.container.clientWidth || 320;
    const height = this.container.clientHeight || 320;

    // Scene
    this.scene = new THREE.Scene();

    // Camera (FOV 36 frames the character head & shoulders cleanly)
    this.camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    this.camera.position.set(0, 0.05, 3.1);

    // Renderer with transparency & high-performance settings
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // Append canvas
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'avatar-3d-canvas';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.pointerEvents = 'auto';
    this.container.appendChild(this.canvas);

    // Show loading spinner
    this.createLoadingUI();

    // Lighting setup for photorealistic skin & portrait depth
    const ambientLight = new THREE.AmbientLight(0xfff8f0, 1.6);
    this.scene.add(ambientLight);

    // Key Light (warm front-top right)
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(2.5, 3.8, 3.2);
    this.scene.add(keyLight);

    // Fill Light (soft cool front-left)
    const fillLight = new THREE.DirectionalLight(0xe0efff, 1.2);
    fillLight.position.set(-2.5, 1.8, 2.5);
    this.scene.add(fillLight);

    // Rim Backlight (separation from background)
    const rimLight = new THREE.DirectionalLight(0xffecd2, 1.1);
    rimLight.position.set(0, 3.0, -2.5);
    this.scene.add(rimLight);

    // Responsive container resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (!this.container || !this.renderer) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w > 0 && h > 0) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(this.container);

    // Pointer move listener for subtle natural head looking
    window.addEventListener('pointermove', (e) => {
      if (!this.container) return;
      const rect = this.container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const nx = (e.clientX - cx) / (window.innerWidth / 2);
      const ny = (e.clientY - cy) / (window.innerHeight / 2);
      this.mouseTarget.set(
        Math.max(-0.35, Math.min(0.35, nx * 0.25)),
        Math.max(-0.2, Math.min(0.2, -ny * 0.18))
      );
    });

    // Start render loop
    this.animate = this.animate.bind(this);
    this.animate();
  }

  createLoadingUI() {
    this.loaderEl = document.createElement('div');
    this.loaderEl.className = 'avatar-3d-loader';
    this.loaderEl.innerHTML = `
      <div class="loader-spinner"></div>
      <span class="loader-text">3D Model yuklanmoqda...</span>
    `;
    this.container.appendChild(this.loaderEl);
  }

  hideLoadingUI() {
    if (this.loaderEl) {
      this.loaderEl.style.opacity = '0';
      setTimeout(() => this.loaderEl?.remove(), 300);
    }
  }

  loadModel(url) {
    const loader = new GLTFLoader();

    loader.load(
      url,
      (gltf) => {
        this.avatarRoot = gltf.scene;

        const nodesToRemove = [];

        // Traverse & find nodes
        this.avatarRoot.traverse((child) => {
          // Remove default Blender Cube
          if (child.name && child.name.toLowerCase().includes('cube')) {
            child.visible = false;
            nodesToRemove.push(child);
          }

          if (child.name === 'OVR_EyesClosed') {
            this.ovrEyesClosed = child;
            this.configureOverlayMesh(child, 10);
          }

          if (child.name === 'OVR_MouthWide') {
            this.ovrMouthWide = child;
            this.configureOverlayMesh(child, 12);
          }

          if (child.name === 'Mesh_0.001') {
            this.baseMesh = child;
            if (child.material) {
              child.material.depthTest = true;
              child.material.depthWrite = true;
            }
          }
        });

        // Strip Cube nodes completely
        nodesToRemove.forEach((node) => {
          if (node.parent) node.parent.remove(node);
        });

        // Center the avatar model perfectly in the viewport
        const box = new THREE.Box3().setFromObject(this.avatarRoot);
        const center = box.getCenter(new THREE.Vector3());
        this.avatarRoot.position.x = -center.x;
        this.avatarRoot.position.y = -center.y - 0.05;
        this.avatarRoot.position.z = -center.z;

        this.scene.add(this.avatarRoot);

        // Strict initial visibility fix: hide overlays completely
        this.setOverlayVisible(this.ovrEyesClosed, false);
        this.setOverlayVisible(this.ovrMouthWide, false);

        this.isLoaded = true;
        this.hideLoadingUI();
        this.initBlinking();
        this.setState('idle');
      },
      (xhr) => {
        if (xhr.lengthComputable && this.loaderEl) {
          const percent = Math.round((xhr.loaded / xhr.total) * 100);
          const txt = this.loaderEl.querySelector('.loader-text');
          if (txt) txt.textContent = `3D Model yuklanmoqda... ${percent}%`;
        }
      },
      (error) => {
        console.error('GLTF Load error:', error);
        if (this.loaderEl) {
          const txt = this.loaderEl.querySelector('.loader-text');
          if (txt) txt.textContent = 'Model yuklanmadi';
        }
      }
    );
  }

  configureOverlayMesh(mesh, renderOrder) {
    mesh.renderOrder = renderOrder;
    if (mesh.material) {
      mesh.material.transparent = true;
      mesh.material.depthTest = true;
      mesh.material.depthWrite = false; // Prevents alpha z-sorting glitches
      mesh.material.polygonOffset = true;
      mesh.material.polygonOffsetFactor = -1;
      mesh.material.polygonOffsetUnits = -4; // Prevents z-fighting against face
    }
  }

  /**
   * Visibility Fix:
   * Sets BOTH object.visible = false AND ShowOverlay shape key = 0
   * so overlays disappear completely without any ghosting or alpha artifacts.
   */
  setOverlayVisible(overlayObject, isVisible, weight = 1.0) {
    if (!overlayObject) return;

    overlayObject.visible = !!isVisible;
    const targetWeight = isVisible ? Math.max(0, Math.min(1.0, weight)) : 0.0;

    if (overlayObject.morphTargetDictionary && ('ShowOverlay' in overlayObject.morphTargetDictionary)) {
      const idx = overlayObject.morphTargetDictionary['ShowOverlay'];
      if (overlayObject.morphTargetInfluences) {
        overlayObject.morphTargetInfluences[idx] = targetWeight;
      }
    } else if (overlayObject.morphTargetInfluences && overlayObject.morphTargetInfluences.length > 0) {
      overlayObject.morphTargetInfluences[0] = targetWeight;
    }
  }

  // --- BLINKING SYSTEM ---
  initBlinking() {
    const scheduleNextBlink = () => {
      if (this.blinkTimer) clearTimeout(this.blinkTimer);
      // Blink occasionally and naturally every 3.5 to 5.5 seconds
      const delay = 3500 + Math.random() * 2000;
      this.blinkTimer = setTimeout(() => {
        if (this.state === 'idle') {
          this.triggerBlink();
        }
        scheduleNextBlink();
      }, delay);
    };

    scheduleNextBlink();
  }

  triggerBlink() {
    if (this.isBlinking || !this.ovrEyesClosed || this.state !== 'idle') return;
    this.isBlinking = true;

    // Show eyes closed overlay
    this.setOverlayVisible(this.ovrEyesClosed, true, 1.0);

    // Natural blink closure duration ~140ms
    setTimeout(() => {
      // Disappear completely
      this.setOverlayVisible(this.ovrEyesClosed, false, 0.0);
      this.isBlinking = false;
    }, 140);
  }

  // --- MOUTH OPENING / AUDIO LIP-SYNC ---
  setMouthOpen(value) {
    if (!this.ovrMouthWide || !this.isLoaded) return;

    // Only allow mouth opening when actively speaking
    if (this.state !== 'speaking') {
      this.setOverlayVisible(this.ovrMouthWide, false, 0.0);
      return;
    }

    const v = Number(value) || 0.0;

    // Audio threshold: if sound drops (pause between words), close immediately
    if (v < 0.22) {
      this.setOverlayVisible(this.ovrMouthWide, false, 0.0);
    } else {
      // Map audio energy to mouth shape key intensity
      const weight = Math.min(1.0, Math.max(0.4, (v - 0.2) * 1.5));
      this.setOverlayVisible(this.ovrMouthWide, true, weight);
    }
  }

  // --- STATE CONTROLLER ---
  setState(state) {
    this.state = state;

    // Update container visual states
    this.container.classList.remove('listening', 'thinking', 'speaking');
    if (this.statusSection) {
      this.statusSection.classList.remove('idle', 'listening', 'thinking', 'speaking');
      this.statusSection.classList.add(state);
    }

    if (state === 'listening') {
      this.container.classList.add('listening');
      this.updateStatus('Eshitilmoqda... (Listening)', '#10b981');
      this.stopPulse();

      // Listening / recording: Keep mouth closed and disable blinking
      this.isBlinking = false;
      this.setOverlayVisible(this.ovrMouthWide, false, 0.0);
      this.setOverlayVisible(this.ovrEyesClosed, false, 0.0);
    } else if (state === 'thinking') {
      this.container.classList.add('thinking');
      this.updateStatus('Fikrlanmoqda... (Thinking)', '#8b5cf6');
      this.stopPulse();

      // Thinking: Hide mouth overlays and disable blinking
      this.isBlinking = false;
      this.setOverlayVisible(this.ovrMouthWide, false, 0.0);
      this.setOverlayVisible(this.ovrEyesClosed, false, 0.0);
    } else if (state === 'speaking') {
      this.container.classList.add('speaking');
      this.updateStatus('Javob bermoqda... (Speaking)', '#2563eb');

      // Speaking: Disable blinking during speech to focus on lip-sync
      this.isBlinking = false;
      this.setOverlayVisible(this.ovrEyesClosed, false, 0.0);
    } else {
      // Idle: Ready, enable blinking, mouth strictly closed
      this.updateStatus('Tayyor (Ready)', '#10b981');
      this.stopPulse();
      this.setOverlayVisible(this.ovrMouthWide, false, 0.0);
      this.setOverlayVisible(this.ovrEyesClosed, false, 0.0);
    }
  }

  updateStatus(text, color) {
    if (this.statusTextElement) this.statusTextElement.textContent = text;
    if (this.statusDotElement && color) this.statusDotElement.style.background = color;
  }

  // Fallback organic mouth pulsation when raw audio analyser is not used
  startPulse(durationMs = 4500) {
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
      // Syllable oscillation rhythm
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
    this.setOverlayVisible(this.ovrMouthWide, false, 0.0);
  }

  // --- DRAGGABLE MOVEMENT AROUND THE PAGE ---
  initDraggable() {
    const targetElement = this.container.parentElement; // .avatar-section
    if (!targetElement) return;

    // Create drag bar at the top of the avatar section
    const dragBar = document.createElement('div');
    dragBar.className = 'avatar-drag-handle';
    dragBar.title = 'Avatarni ekranning istalgan joyiga surishingiz mumkin';
    dragBar.innerHTML = `
      <span class="avatar-drag-title">⋮⋮ Avatarni surish</span>
      <button class="avatar-dock-btn" title="Boshlang'ich joyiga qaytarish">↺ Qaytarish</button>
    `;
    dragBar.style.touchAction = 'none';
    targetElement.prepend(dragBar);

    // Create layout placeholder so the grid does not collapse when detached
    const placeholder = document.createElement('div');
    placeholder.className = 'avatar-placeholder';
    placeholder.style.display = 'none';
    targetElement.parentElement.insertBefore(placeholder, targetElement);

    const dockBtn = dragBar.querySelector('.avatar-dock-btn');

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let isDetached = false;

    const onPointerDown = (e) => {
      // Don't drag if clicking dock button or controls
      if (e.target.closest('.avatar-dock-btn')) return;
      if (e.target.closest('button') && e.target !== dragBar) return;
      if (e.target.closest('.mic-button')) return;

      isDragging = true;
      targetElement.classList.add('dragging');

      const rect = targetElement.getBoundingClientRect();

      // Convert to fixed positioning on first drag
      if (!isDetached) {
        placeholder.style.width = `${rect.width}px`;
        placeholder.style.height = `${rect.height}px`;
        placeholder.style.display = 'block';

        targetElement.style.width = `${rect.width}px`;
        targetElement.style.position = 'fixed';
        targetElement.style.zIndex = '9999';
        targetElement.style.left = `${rect.left}px`;
        targetElement.style.top = `${rect.top}px`;
        targetElement.style.margin = '0';
        targetElement.classList.add('detached');

        isDetached = true;
        dockBtn.style.display = 'inline-block';
      }

      startX = e.clientX;
      startY = e.clientY;
      initialLeft = parseFloat(targetElement.style.left) || rect.left;
      initialTop = parseFloat(targetElement.style.top) || rect.top;

      try {
        dragBar.setPointerCapture(e.pointerId);
      } catch (err) {}
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      // Keep within viewport boundaries
      const rect = targetElement.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width - 10;
      const maxTop = window.innerHeight - rect.height - 10;

      newLeft = Math.max(10, Math.min(newLeft, maxLeft));
      newTop = Math.max(10, Math.min(newTop, maxTop));

      targetElement.style.left = `${newLeft}px`;
      targetElement.style.top = `${newTop}px`;
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      targetElement.classList.remove('dragging');
      try {
        dragBar.releasePointerCapture(e.pointerId);
      } catch (err) {}
    };

    // Dock button to reset position back to original layout
    dockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      placeholder.style.display = 'none';
      targetElement.classList.remove('detached');
      targetElement.style.position = '';
      targetElement.style.zIndex = '';
      targetElement.style.left = '';
      targetElement.style.top = '';
      targetElement.style.width = '';
      targetElement.style.margin = '';
      isDetached = false;
      dockBtn.style.display = 'none';
    });

    dragBar.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  // --- RENDER LOOP ---
  animate() {
    this.animFrameId = requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();

    if (this.avatarRoot) {
      // Smooth interpolation for head tracking
      this.mouseCurrent.lerp(this.mouseTarget, 0.08);

      // Natural breathing sway and gentle posture oscillation
      const breathingSway = Math.sin(elapsedTime * 1.6) * 0.015;
      const gentleTilt = Math.cos(elapsedTime * 0.8) * 0.008;

      this.avatarRoot.rotation.y = this.mouseCurrent.x + gentleTilt;
      this.avatarRoot.rotation.x = this.mouseCurrent.y + breathingSway * 0.5;
      this.avatarRoot.position.y = -0.05 + breathingSway * 0.02;
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  destroy() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    if (this.blinkTimer) clearTimeout(this.blinkTimer);
    if (this.pulseRaf) cancelAnimationFrame(this.pulseRaf);
    if (this.renderer) this.renderer.dispose();
  }
}
