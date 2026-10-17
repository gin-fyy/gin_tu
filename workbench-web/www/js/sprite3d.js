/* 3D 精灵（WebGL / three.js）
 *
 * 能力：
 *  - 透明画布叠在页面上，只点亮精灵时才接管手势，其他 UI 完全不受影响（pointer-events: none）
 *  - 程序化生成的小鲸灵（不需要任何模型文件）；若 www/models/pet.glb 存在则自动换成它，并播放其 idle/walk 动画
 *  - 自由游走（随机目标 + 待机/走路切换）、手指拖拽、点击弹对话
 *  - AI 回复后按语气切表情/动作（happy / sad / angry / shy / sleepy / excited）
 *
 * 用法：
 *   await WBSprite.mount({ container, modelUrl, onTap })
 *   WBSprite.react('happy'); WBSprite.destroy();
 */
(function () {
  var THREE = null;
  var rt = null;          // { renderer, scene, camera, pet, clock, raf, ... }
  var state = {
    mounted: false,
    dragging: false,
    dragMoved: 0,
    lastPointer: null,
    target: { x: 0, y: 0.0 },
    pos: { x: 0, y: 0.0 },
    facing: 1,
    mode: 'idle',
    modeUntil: 0,
    hop: 0,
    spin: 0,
    tint: 0,
    onTap: null,
    container: null,
    bubble: null,
    hidden: false
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------- 程序化小鲸灵：球体拼出来，带鳍、尾巴和蝴蝶结 ----------
  function makeProceduralPet() {
    var g = new THREE.Group();
    var blue = 0x3E8FE0, deep = 0x2A6FB8, skin = 0xBFE3FF, pink = 0xFF9FC4, white = 0xFFFFFF, ink = 0x1E2A3A;

    var body = new THREE.Mesh(
      new THREE.SphereGeometry(0.52, 28, 20),
      new THREE.MeshStandardMaterial({ color: blue, roughness: 0.55, metalness: 0.05 })
    );
    body.scale.set(1, 1.06, 0.94);
    body.position.y = 0.62;
    g.add(body);

    var belly = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 20, 16),
      new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 })
    );
    belly.scale.set(1, 1.05, 0.6);
    belly.position.set(0, 0.56, 0.34);
    g.add(belly);

    var head = new THREE.Mesh(
      new THREE.SphereGeometry(0.58, 28, 22),
      new THREE.MeshStandardMaterial({ color: blue, roughness: 0.5 })
    );
    head.position.y = 1.42;
    g.add(head);

    // 眼睛（白 + 瞳 + 高光）
    [-0.21, 0.21].forEach(function (x) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), new THREE.MeshStandardMaterial({ color: white, roughness: 0.25 }));
      eye.position.set(x, 1.47, 0.5);
      eye.scale.set(1, 1.15, 0.6);
      g.add(eye);
      var pupil = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), new THREE.MeshStandardMaterial({ color: 0x22304A, roughness: 0.2 }));
      pupil.position.set(x, 1.46, 0.57);
      g.add(pupil);
      var hi = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), new THREE.MeshBasicMaterial({ color: white }));
      hi.position.set(x - 0.03, 1.51, 0.62);
      g.add(hi);
    });

    // 腮红
    [-0.34, 0.34].forEach(function (x) {
      var b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), new THREE.MeshStandardMaterial({ color: pink, roughness: 0.8, transparent: true, opacity: 0.85 }));
      b.position.set(x, 1.32, 0.44);
      b.scale.set(1.4, 0.8, 0.4);
      g.add(b);
    });

    // 鲸鳍（左右）
    [-1, 1].forEach(function (s) {
      var fin = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.42, 14),
        new THREE.MeshStandardMaterial({ color: deep, roughness: 0.6 })
      );
      fin.position.set(0.56 * s, 0.66, 0);
      fin.rotation.z = s * 1.15;
      g.add(fin);
    });

    // 尾巴
    var tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.5, 14),
      new THREE.MeshStandardMaterial({ color: deep, roughness: 0.6 })
    );
    tail.position.set(0, 0.5, -0.52);
    tail.rotation.x = -1.2;
    g.add(tail);

    // 蝴蝶结（参考图的标志）
    var bowMat = new THREE.MeshStandardMaterial({ color: deep, roughness: 0.5 });
    [-0.13, 0.13].forEach(function (x) {
      var b = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 4), bowMat);
      b.position.set(0.32 + x, 1.88, 0.28);
      b.rotation.z = x < 0 ? 1.6 : -1.6;
      b.rotation.x = 1.57;
      g.add(b);
    });
    var knot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshStandardMaterial({ color: pink, roughness: 0.5 }));
    knot.position.set(0.32, 1.88, 0.32);
    g.add(knot);

    // 头顶小水柱
    var spout = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.02, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: 0xBFE3FF, transparent: true, opacity: 0.85 })
    );
    spout.position.set(-0.1, 2.02, 0);
    spout.rotation.z = 0.3;
    g.add(spout);

    g.userData.parts = { body: body, head: head, tail: tail, spout: spout };
    return g;
  }

  // ---------- 影子（让精灵"站"在地上，而不是飘着） ----------
  function makeShadow() {
    var m = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 32),
      new THREE.MeshBasicMaterial({ color: 0x0b1020, transparent: true, opacity: 0.16 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.01;
    return m;
  }

  function ensureSize() {
    if (!rt) return;
    var w = window.innerWidth || 360;
    var h = window.innerHeight || 640;
    rt.renderer.setSize(w, h, false);
    rt.camera.aspect = w / h;
    rt.camera.updateProjectionMatrix();
  }

  function buildScene() {
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(42, (window.innerWidth || 360) / (window.innerHeight || 640), 0.1, 60);
    camera.position.set(0, 2.0, 7.2);
    camera.lookAt(0, 1.1, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8fa6c8, 0.95));
    var dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(3, 6, 4);
    scene.add(dir);
    var fill = new THREE.DirectionalLight(0x9fc4ff, 0.35);
    fill.position.set(-4, 2, -3);
    scene.add(fill);

    var pet = makeProceduralPet();
    pet.position.y = 0;
    scene.add(pet);
    var shadow = makeShadow();
    scene.add(shadow);

    return { scene: scene, camera: camera, pet: pet, shadow: shadow };
  }

  function loadModel(url, cb) {
    if (!url || !THREE.GLTFLoader) { cb(null); return; }
    try {
      var loader = new THREE.GLTFLoader();
      loader.load(url, function (gltf) {
        var model = gltf.scene;
        var box = new THREE.Box3().setFromObject(model);
        var size = box.getSize(new THREE.Vector3());
        var scale = size.y > 0 ? (2.15 / size.y) : 1;
        model.scale.setScalar(scale);
        var box2 = new THREE.Box3().setFromObject(model);
        model.position.y -= box2.min.y;
        cb({ model: model, animations: gltf.animations || [] });
      }, undefined, function () { cb(null); });
    } catch (e) { cb(null); }
  }

  // ---------- 主循环：游走 + 待机/走路 + 拖拽 + 表情动作 ----------
  function tick() {
    if (!rt) return;
    rt.raf = requestAnimationFrame(tick);
    if (state.hidden) return;

    var now = performance.now();
    var dt = Math.min(0.05, (now - (rt.last || now)) / 1000);
    rt.last = now;
    var pet = rt.pet;
    if (!pet) return;

    // 待机 / 走路切换
    if (state.mode !== 'drag' && now > state.modeUntil) {
      var walk = Math.random() > 0.45;
      state.mode = walk ? 'walk' : 'idle';
      state.modeUntil = now + (walk ? 2600 + Math.random() * 3200 : 1800 + Math.random() * 2600);
      if (walk) {
        state.target.x = clamp(state.target.x + (Math.random() * 2.4 - 1.2) * 2.2, -2.3, 2.3);
      }
    }

    // 位置平滑
    var lerp = state.mode === 'drag' ? 0.42 : (state.mode === 'walk' ? 0.055 : 0.03);
    state.pos.x += (state.target.x - state.pos.x) * lerp;
    state.pos.y += (state.target.y - state.pos.y) * 0.25;

    var dx = state.target.x - state.pos.x;
    if (Math.abs(dx) > 0.04 && state.mode !== 'drag') state.facing = dx > 0 ? 1 : -1;

    // 动作叠加
    var bob = 0;
    if (state.mode === 'walk') bob = Math.abs(Math.sin(now / 180)) * 0.09;
    else bob = Math.sin(now / 700) * 0.035;
    if (state.hop > 0) {
      var t = 1 - state.hop;
      bob += Math.sin(t * Math.PI) * 0.55;
      state.hop = Math.max(0, state.hop - dt * 1.9);
    }
    var spinY = 0;
    if (state.spin > 0) {
      spinY = state.spin * Math.PI * 2;
      state.spin = Math.max(0, state.spin - dt * 1.6);
    }

    pet.position.x = state.pos.x;
    pet.position.y = state.pos.y + bob;
    pet.position.z = 0;
    pet.rotation.y = (state.facing > 0 ? 0.18 : -0.18) + spinY;
    pet.rotation.z = state.mode === 'walk' ? Math.sin(now / 220) * 0.05 : Math.sin(now / 900) * 0.02;
    if (rt.shadow) {
      rt.shadow.position.x = pet.position.x;
      var sh = 1 - Math.min(0.5, Math.abs(bob) * 0.7);
      rt.shadow.scale.setScalar(sh);
    }

    // 表情：眼神/头部倾斜 + 材质色温
    if (pet.userData && pet.userData.parts) {
      var p = pet.userData.parts;
      if (p.head) p.head.rotation.z = state.tint === 'sad' ? 0.18 : 0;
      if (p.tail) p.tail.rotation.z = Math.sin(now / (state.tint === 'excited' ? 90 : 380)) * 0.25;
      if (p.spout) p.spout.scale.y = 0.8 + Math.abs(Math.sin(now / 500)) * 0.4;
    }

    // 混合模型动画
    if (rt.mixer) rt.mixer.update(dt);
    if (rt.actions) {
      var wantWalk = state.mode === 'walk';
      if (rt.actions.walk && rt.actions.idle) {
        if (wantWalk && !rt.actions.walk.isRunning()) { rt.actions.walk.reset().fadeIn(0.2).play(); rt.actions.idle.fadeOut(0.2); }
        else if (!wantWalk && !rt.actions.idle.isRunning()) { rt.actions.idle.reset().fadeIn(0.2).play(); rt.actions.walk.fadeOut(0.2); }
      }
    }

    rt.renderer.render(rt.scene, rt.camera);
  }

  // ---------- 手势：只点亮精灵才接管 ----------
  function petScreenPos() {
    if (!rt || !rt.pet) return null;
    var v = new THREE.Vector3(rt.pet.position.x, rt.pet.position.y + 1.1, 0);
    v.project(rt.camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight
    };
  }

  function onDown(e) {
    if (!state.mounted || state.hidden) return;
    var p = petScreenPos();
    if (!p) return;
    var dx = e.clientX - p.x;
    var dy = e.clientY - p.y;
    if (Math.sqrt(dx * dx + dy * dy) > 96) return;   // 没点到精灵：完全放行给 App
    state.dragging = true;
    state.dragMoved = 0;
    state.mode = 'drag';
    state.lastPointer = { x: e.clientX, y: e.clientY };
    try { e.preventDefault(); } catch (err) { /* ignore */ }
  }

  function onMove(e) {
    if (!state.dragging || !state.lastPointer) return;
    var dx = e.clientX - state.lastPointer.x;
    var dy = e.clientY - state.lastPointer.y;
    state.dragMoved += Math.abs(dx) + Math.abs(dy);
    state.lastPointer = { x: e.clientX, y: e.clientY };
    // 屏幕像素 → 世界坐标（近似）
    var worldPerPx = 4.6 / Math.max(240, window.innerWidth);
    state.target.x = clamp(state.target.x + dx * worldPerPx, -2.4, 2.4);
    state.target.y = clamp(state.target.y - dy * worldPerPx * 0.9, -0.15, 0.9);
    try { e.preventDefault(); } catch (err) { /* ignore */ }
  }

  function onUp() {
    if (!state.dragging) return;
    var moved = state.dragMoved;
    state.dragging = false;
    state.mode = 'idle';
    state.modeUntil = 0;
    state.lastPointer = null;
    if (moved < 9) {
      state.hop = Math.max(state.hop, 0.85);
      if (typeof state.onTap === 'function') state.onTap();
    }
  }

  function hideWhenHidden() {
    state.hidden = !!document.hidden;
  }

  // ---------- 对外接口 ----------
  function react(kind) {
    state.tint = kind || '';
    if (kind === 'happy' || kind === 'excited') { state.hop = 1; state.spin = kind === 'excited' ? 1 : 0; }
    else if (kind === 'shy') { state.spin = 0.6; }
    else if (kind === 'angry') { state.hop = 0.5; }
    else if (kind === 'sad' || kind === 'sleepy') { state.mode = 'idle'; state.modeUntil = 0; }
    clearTimeout(react._t);
    react._t = setTimeout(function () { state.tint = ''; }, 4200);
  }

  function say(text, opts) {
    if (!rt || !state.container) return;
    var o = opts || {};
    if (!state.bubble) {
      var b = document.createElement('div');
      b.className = 'sprite-bubble';
      b.addEventListener('click', function () {
        b.classList.remove('on');
        if (typeof o.onClose === 'function') o.onClose();
      });
      state.container.appendChild(b);
      state.bubble = b;
    }
    state.bubble.textContent = String(text || '');
    state.bubble.classList.add('on');
    clearTimeout(say._t);
    say._t = setTimeout(function () {
      if (state.bubble) state.bubble.classList.remove('on');
    }, Math.max(4000, String(text || '').length * 220));
    positionBubble();
  }

  function positionBubble() {
    if (!state.bubble || !rt) return;
    var p = petScreenPos();
    if (!p) return;
    var el = state.bubble;
    el.style.left = Math.round(Math.max(12, Math.min(window.innerWidth - 200, p.x - 20))) + 'px';
    el.style.top = Math.round(Math.max(70, p.y - 150)) + 'px';
  }

  function mount(opts) {
    var o = opts || {};
    if (state.mounted) return true;
    THREE = window.THREE;
    if (!THREE || !THREE.WebGLRenderer) return false;

    var canvas = document.createElement('canvas');
    canvas.className = 'sprite3d-canvas';
    var container = o.container || document.body;
    container.appendChild(canvas);

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch (e) {
      try { container.removeChild(canvas); } catch (e2) { /* ignore */ }
      return false;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    var built = buildScene();
    rt = {
      renderer: renderer,
      scene: built.scene,
      camera: built.camera,
      pet: built.pet,
      shadow: built.shadow,
      last: performance.now(),
      raf: 0,
      mixer: null,
      actions: null
    };
    state.mounted = true;
    state.container = container;
    state.onTap = o.onTap || null;
    state.target.x = 0.6;
    state.pos.x = 0.2;
    state.mode = 'idle';
    state.modeUntil = 0;

    ensureSize();
    window.addEventListener('resize', ensureSize);
    window.addEventListener('orientationchange', ensureSize);
    document.addEventListener('visibilitychange', hideWhenHidden);
    document.addEventListener('pointerdown', onDown, { passive: false });
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);

    if (o.modelUrl) {
      loadModel(o.modelUrl, function (res) {
        if (!res || !rt) return;
        try { rt.scene.remove(rt.pet); } catch (e) { /* ignore */ }
        rt.pet = res.model;
        rt.pet.position.x = state.pos.x;
        rt.scene.add(rt.pet);
        if (res.animations && res.animations.length) {
          rt.mixer = new THREE.AnimationMixer(rt.pet);
          rt.actions = {};
          res.animations.forEach(function (clip) {
            var name = String(clip.name || '').toLowerCase();
            var action = rt.mixer.clipAction(clip);
            if (name.indexOf('walk') >= 0 || name.indexOf('run') >= 0) rt.actions.walk = action;
            else if (name.indexOf('idle') >= 0) rt.actions.idle = action;
            else if (!rt.actions.idle) rt.actions.idle = action;
          });
          if (rt.actions.idle) rt.actions.idle.play();
        }
      });
    }

    tick();
    return true;
  }

  function destroy() {
    if (rt) {
      cancelAnimationFrame(rt.raf);
      try { rt.renderer.dispose(); } catch (e) { /* ignore */ }
      var c = rt.renderer && rt.renderer.domElement;
      if (c && c.parentNode) c.parentNode.removeChild(c);
      rt = null;
    }
    state.mounted = false;
    state.dragging = false;
    if (state.bubble && state.bubble.parentNode) state.bubble.parentNode.removeChild(state.bubble);
    state.bubble = null;
    window.removeEventListener('resize', ensureSize);
    window.removeEventListener('orientationchange', ensureSize);
    document.removeEventListener('visibilitychange', hideWhenHidden);
    document.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
  }

  function setVisible(on) {
    var c = rt && rt.renderer && rt.renderer.domElement;
    if (c) c.style.display = on ? 'block' : 'none';
    if (!on && state.bubble) state.bubble.classList.remove('on');
  }

  window.WBSprite = {
    mount: mount,
    destroy: destroy,
    react: react,
    say: say,
    setVisible: setVisible,
    isMounted: function () { return state.mounted; },
    hasWebGL: function () {
      try {
        var c = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
      } catch (e) { return false; }
    }
  };
})();
