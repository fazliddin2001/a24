import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * 3D Avatar Controller using Three.js & GLTF
 * Implements:
 * - GLB loading & rendering at medium responsive size (320px desktop, 240px mobile)
 * - Draggable movement around the page with dock reset
 * - Enhanced 3D perspective & head movement with cursor parallax
 * - Natural idle eye blinking (~every 3.5-5.5s)
 * - Smooth biological lip-sync with attack/release envelope & cadence
 * - Strict overlay visibility handling (object.visible = false AND ShowOverlay shape key = 0)
 * - State management (idle, listening, thinking, speaking)
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
    this.keyLight = null;
    this.centerOffset = new THREE.Vector3(0, 0, 0);

    // Animation & State
    this.state = 'idle'; // 'idle' | 'listening' | 'thinking' | 'speaking'
    this.isBlinking = false;
    this.blinkTimer = null;
    this.pulseRaf = null;
    this.pulseStart = 0;
    this.pulseEnd = 0;
    this.isLoaded = false;

    // Smooth Lip Articulation Envelope
    this.targetMouthOpen = 0.0;
    this.currentMouthOpen = 0.0;

    // Three.js Core
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.animFrameId = null;
    this.clock = new THREE.Clock();

    // Natural 3D head orientation tracking (expanded range for 3D depth)
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

    // Camera (FOV 36 frames the character head & shoulders cleanly with true perspective)
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
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.keyLight.position.set(2.5, 3.8, 3.2);
    this.scene.add(this.keyLight);

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

    // Pointer move listener with expanded range for realistic 3D viewing
    window.addEventListener('pointermove', (e) => {
      if (!this.container) return;
      const rect = this.container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const nx = (e.clientX - cx) / (window.innerWidth / 2);
      const ny = (e.clientY - cy) / (window.innerHeight / 2);

      // Expanded horizontal & vertical room:
      // ~31.5 deg max horizontal rotation, ~16 deg vertical tilt.
      // Shows the 3D depth of face, nose, braids, and cap without exposing back/edges.
      this.mouseTarget.set(
        Math.max(-0.55, Math.min(0.55, nx * 0.45)),
        Math.max(-0.28, Math.min(0.28, -ny * 0.24))
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
        this.centerOffset = box.getCenter(new THREE.Vector3());
        this.avatarRoot.position.x = -this.centerOffset.x;
        this.avatarRoot.position.y = -this.centerOffset.y - 0.05;
        this.avatarRoot.position.z = -this.centerOffset.z;

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
  /**
   * Sets the target vocal energy.
   * Instead of abruptly turning overlays on/off, values are filtered through
   * an organic attack/release envelope in the 60 FPS animation loop.
   */
  setMouthOpen(value) {
    if (this.state !== 'speaking') {
      this.targetMouthOpen = 0.0;
      return;
    }

    const v = Number(value) || 0.0;

    // Vocal noise floor filter
    if (v < 0.10) {
      this.targetMouthOpen = 0.0;
    } else {
      // Map voice energy to smooth opening intensity with natural power response
      const normalized = Math.min(1.0, (v - 0.10) / 0.45);
      this.targetMouthOpen = Math.pow(normalized, 0.85);
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
      this.targetMouthOpen = 0.0;
      this.currentMouthOpen = 0.0;
      this.setOverlayVisible(this.ovrMouthWide, false, 0.0);
      this.setOverlayVisible(this.ovrEyesClosed, false, 0.0);
    } else if (state === 'thinking') {
      this.container.classList.add('thinking');
      this.updateStatus('Fikrlanmoqda... (Thinking)', '#8b5cf6');
      this.stopPulse();

      // Thinking: Hide mouth overlays and disable blinking
      this.isBlinking = false;
      this.targetMouthOpen = 0.0;
      this.currentMouthOpen = 0.0;
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
      this.targetMouthOpen = 0.0;
      this.currentMouthOpen = 0.0;
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
      this.setMouthOpen(0.12 + Math.max(0, syllable * 0.55));
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
    this.targetMouthOpen = 0.0;
    this.currentMouthOpen = 0.0;
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
      // Fluid natural interpolation for head tracking
      this.mouseCurrent.lerp(this.mouseTarget, 0.065);

      // Natural breathing sway & subtle posture oscillation
      const breathingSway = Math.sin(elapsedTime * 1.6) * 0.015;
      const gentleTilt = Math.cos(elapsedTime * 0.8) * 0.008;

      // 3D Rotations: Y-yaw, X-pitch, and Z-roll tilt
      this.avatarRoot.rotation.y = this.mouseCurrent.x + gentleTilt;
      this.avatarRoot.rotation.x = this.mouseCurrent.y + breathingSway * 0.4;
      this.avatarRoot.rotation.z = -this.mouseCurrent.x * 0.09; // Natural ear-to-shoulder tilt

      // 3D Parallax Translations: moves in X, Y and depth Z to emphasize 3D geometry
      this.avatarRoot.position.x = -this.centerOffset.x + this.mouseCurrent.x * 0.12;
      this.avatarRoot.position.y = -this.centerOffset.y - 0.05 + this.mouseCurrent.y * 0.08 + breathingSway * 0.02;
      this.avatarRoot.position.z = -this.centerOffset.z - Math.abs(this.mouseCurrent.x) * 0.05;

      // Dynamic key light shift: glints across the cheeks as the head turns
      if (this.keyLight) {
        this.keyLight.position.set(
          2.5 + this.mouseCurrent.x * 1.5,
          3.8 + this.mouseCurrent.y * 1.0,
          3.2
        );
      }
    }

    // --- SMOOTH MOUTH MOVEMENT & CADENCE ---
    if (this.ovrMouthWide && this.isLoaded) {
      if (this.state === 'speaking') {
        const target = this.targetMouthOpen;
        // Asymmetric filter: fast opening attack (0.28), smooth closing decay (0.15)
        const rate = target > this.currentMouthOpen ? 0.28 : 0.15;
        this.currentMouthOpen += (target - this.currentMouthOpen) * rate;

        // Organic syllable micro-modulation for human speech articulation
        let mouthWeight = this.currentMouthOpen;
        if (this.currentMouthOpen > 0.06) {
          // Natural 4.2Hz speech cadence rhythm
          const cadence = Math.sin(elapsedTime * 24.0) * 0.10 + Math.sin(elapsedTime * 12.0) * 0.05;
          mouthWeight = Math.max(0.0, Math.min(1.0, this.currentMouthOpen + cadence));
        }

        // Hysteresis threshold to prevent flickering
        if (mouthWeight > 0.025) {
          this.setOverlayVisible(this.ovrMouthWide, true, mouthWeight);
        } else {
          this.setOverlayVisible(this.ovrMouthWide, false, 0.0);
        }
      } else {
        if (this.currentMouthOpen > 0.005) {
          this.currentMouthOpen = 0.0;
          this.targetMouthOpen = 0.0;
          this.setOverlayVisible(this.ovrMouthWide, false, 0.0);
        }
      }
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
