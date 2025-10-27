/**
 * nn-animation-final-v3.js
 * Changes in v3:
 *  - Replaced per-node noise drift with elliptical orbits per layer (near & mid layers).
 *  - Configurable loop/cycle count ensures nodes return to origin after each loop.
 *  - Seamless looping (positions and pulses align at loop boundaries).
 *  - Applied line masking (punch-through) to static/background nodes.
 *  - Connecting lines use depth-based gradient brightness for 3D effect.
 *  - Optional radial fade at canvas edges via CSS mask for vignette effect.
 */
(function () {
  "use strict";

  // ------------------ CONFIG ------------------
  const CONFIG = {
    // --- Runtime limits ---
    DPR_MAX: 1.5,                 // Clamp devicePixelRatio for lower fill-rate on hi-DPI
    UPDATE_HZ: 30,                // Fixed simulation steps per second (30 is mobile-friendly)
    RENDER_FPS_CAP: 30,           // Max render FPS (24–30 recommended for background use)

    // --- Baseline viewport for scaling densities ---
    BASE_WIDTH: 1440,
    BASE_HEIGHT: 900,
    BASE_NODE_COUNT: 70,          // Foreground nodes count at baseline viewport
    BASE_BG_NODE_COUNT: 70,       // Background nodes count at baseline
    BASE_MAX_LINK_DISTANCE: 500,  // Max link length at baseline (scaled by sqrt(area))
    BASE_PULSE_MAX_ACTIVE: 1,     // Max simultaneous pulses at baseline

    // --- Population (computed from baseline; act as upper bounds) ---
    NODE_COUNT: 100,              // Max nodes after responsive scaling
    BG_NODE_COUNT: 60,            // Max background nodes after scaling
    MOBILE_SCALE: 0.9,            // Additional density reduction for narrow screens

    // --- Degree caps / density controls ---
    MAX_LINK_DISTANCE: 350,       // (Responsive) Max link reach, overwritten by scaler
    MAX_LINKS_DYNAMIC: 6,         // Per-node cap on edges involving moving nodes
    MAX_LINKS_STATIC: 5,          // Per-node cap on edges among static nodes
    BG_LINK_MAX_DEGREE: 4,        // Max degree for background nodes (keep sparse)
    BG_LINK_MAX_DISTANCE: 400,    // Max link length in background layer
    BG_LINK_ALPHA: 0.08,          // Low alpha for static background wiring
    BG_LINK_WIDTH: 3,             // Stroke width for background wiring

    // --- Parallax bands (near/mid/far layers) ---
    PARALLAX_BANDS: [
      { zMin: 0.00, zMax: 0.4, move: true, headingDeg: 20 },   // near layer (moves right)
      { zMin: 0.4, zMax: 0.75, move: true, headingDeg: 160 },  // mid layer (moves diagonally)
      { zMin: 0.70, zMax: 1.00, move: false, headingDeg: 180 } // far layer static
    ],

    // --- Visuals & depth ---
    NODE_RADIUS_BASE: 12,         // Base radius (px) for node glow sprite
    NODE_NEAR_SCALE: 1.0,         // Scale for nearest nodes (smaller)
    NODE_FAR_SCALE: 1.6,          // Scale for farthest nodes (larger)
    BRIGHTNESS_NEAR: 0.8,         // Relative brightness (alpha) for nearest nodes
    BRIGHTNESS_FAR: 0.15,         // Relative brightness for farthest nodes

    // --- Pulses (traversing links) ---
    PULSE_MAX_ACTIVE: 4,          // (Responsive) Max active pulses
    PULSE_POOL_SIZE: 12,
    PULSE_SPEED: 500,             // Pulse travel speed (px/second along links)
    PULSE_SPAWN_EVERY_MS: 1000,    // Base interval between pulse spawns (ms)
    PULSE_RADIUS: 4,              // Pulse glow sprite radius

    // --- Loop & motion (elliptical paths) ---
    LOOP_DURATION_MS: 28000,      // Full loop duration in milliseconds (visual repeat period)
    ELLIPSE_NEAR_CYCLES: 1,       // Ellipse orbits per loop for near layer (integer for seamless return)
    ELLIPSE_MID_CYCLES: 1,        // Ellipse orbits per loop for mid layer
    ELLIPSE_RADIUS_NEAR_X: 80,    // Horizontal ellipse radius for near nodes (baseline minDim=900)
    ELLIPSE_RADIUS_NEAR_Y: 30,    // Vertical ellipse radius for near nodes (baseline)
    ELLIPSE_RADIUS_MID_X: 40,     // Horizontal radius for mid-layer nodes (baseline)
    ELLIPSE_RADIUS_MID_Y: 15,     // Vertical radius for mid-layer nodes (baseline)
    RANDOMIZE_NODE_PHASES: true,
    STARTING_PHASE_RANDOMIZER: 0.15,  // How much to randomize the initial phase by this fraction of 2π
    GLOBAL_DRIFT_RATIO: 0.0,     // Global slow drift as % of min(viewport) (applied via CSS translate)
    BG_DRIFT_RATIO: 0.00,         // Background layer drift magnitude (fraction of minDim)
    BG_DRIFT_SPEED_MULT: 0.0,     // Background drift speed relative to foreground
    BG_DRIFT_HEADING_DEG: -100,   // Background drift direction in degrees
    BG_DRIFT_PHASE: -1.0,         // Phase offset for background drift vs global (decorrelation)

    // --- Lines (foreground network) ---
    LINE_ALPHA_MIN: 0.3,         // Opacity for very short links (nearby nodes)
    LINE_ALPHA_MAX: 0.08,         // Opacity for longest links
    LINE_WIDTH_NEAR: 1.5,           // Line width for nearest links
    LINE_WIDTH_FAR: 3,            // Line width for far links

    // --- Masking & culling ---
    DYNAMIC_LINE_PUNCH: true,     // Enable masking of lines behind node sprites (prevents line "punch-through")
    PUNCH_THROUGH_RADIUS_SCALE: 0.9,  // Mask radius as fraction of node sprite radius
    CULL_MARGIN: 24,              // Offscreen culling margin (px beyond viewport)

    // --- Edge fade (radial vignette) ---
    EDGE_FADE_DYNAMIC: true,      // Apply radial fade-out at canvas edges for dynamic layer (near nodes)
    EDGE_FADE_STATIC: true,      // Apply radial edge fade for static layer (far nodes)
    EDGE_FADE_BG: true,          // Radial edge fade for background layer (usually off)
    EDGE_FADE_DYNAMIC_INNER: 0.8, // Inner radius (fraction of half-size) where dynamic layer fade begins
    EDGE_FADE_DYNAMIC_OUTER: 1.0, // Outer radius (fraction) where dynamic layer is fully faded
    EDGE_FADE_STATIC_INNER: 0.95, // Inner radius for static layer fade
    EDGE_FADE_STATIC_OUTER: 1.0,  // Outer radius for static layer fade end
    EDGE_FADE_BG_INNER: 0.4,      // (unused if EDGE_FADE_BG is false)
    EDGE_FADE_BG_OUTER: 0.9
  };

  function readCssRGBTuple(varName, fallback) {
    const styles = getComputedStyle(document.body);
    const v = styles.getPropertyValue(varName).trim();
    return (v && v.length) ? v : fallback;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const BASELINE = {
    WIDTH: CONFIG.BASE_WIDTH,
    HEIGHT: CONFIG.BASE_HEIGHT,
    AREA: CONFIG.BASE_WIDTH * CONFIG.BASE_HEIGHT,
    NODE_COUNT: CONFIG.BASE_NODE_COUNT,
    BG_NODE_COUNT: CONFIG.BASE_BG_NODE_COUNT,
    MAX_LINK_DISTANCE: CONFIG.BASE_MAX_LINK_DISTANCE,
    PULSE_MAX_ACTIVE: CONFIG.BASE_PULSE_MAX_ACTIVE,
    BG_LINK_MAX_DISTANCE: CONFIG.BG_LINK_MAX_DISTANCE
  };

  // Precompute any static angles from config
  CONFIG.PARALLAX_BANDS.forEach(band => {
    band.headingRad = (band.headingDeg ?? 0) * Math.PI / 180;
  });
  CONFIG.BG_DRIFT_HEADING_RAD = (CONFIG.BG_DRIFT_HEADING_DEG ?? 0) * Math.PI / 180;

  // --------- Poisson-disc sampling (even spread) ---------
  function poisson(width, height, r, maxTries = 30) {
    const k = maxTries;
    const cell = r / Math.sqrt(2);
    const gridW = Math.ceil(width / cell);
    const gridH = Math.ceil(height / cell);
    const grid = new Array(gridW * gridH).fill(null);
    const active = [];
    const samples = [];

    const inBounds = (x, y) => x >= 0 && x < width && y >= 0 && y < height;
    const gridIndex = (x, y) => Math.floor(y / cell) * gridW + Math.floor(x / cell);
    function farEnough(x, y) {
      const gi = Math.floor(x / cell);
      const gj = Math.floor(y / cell);
      for (let j = Math.max(0, gj - 2); j <= Math.min(gridH - 1, gj + 2); j++) {
        for (let i = Math.max(0, gi - 2); i <= Math.min(gridW - 1, gi + 2); i++) {
          const s = grid[j * gridW + i];
          if (!s) continue;
          const dx = s.x - x, dy = s.y - y;
          if (dx * dx + dy * dy < r * r) return false;
        }
      }
      return true;
    }
    function addSample(x, y) {
      const s = { x, y };
      samples.push(s);
      active.push(s);
      grid[gridIndex(x, y)] = s;
      return s;
    }

    // Start from center
    addSample(width / 2, height / 2);
    while (active.length) {
      const idx = (Math.random() * active.length) | 0;
      const s = active[idx];
      let placed = false;
      for (let n = 0; n < k; n++) {
        const a = Math.random() * Math.PI * 2;
        const rr = r * (1 + Math.random());
        const x = s.x + Math.cos(a) * rr;
        const y = s.y + Math.sin(a) * rr;
        if (inBounds(x, y) && farEnough(x, y)) {
          addSample(x, y);
          placed = true;
          break;
        }
      }
      if (!placed) active.splice(idx, 1);
    }
    return samples;
  }

  // --------------- Object Pool (for pulses) ---------------
  class ObjectPool {
    constructor(createFn, resetFn, initialSize) {
      this._create = createFn;
      this._reset = resetFn;
      this._pool = new Array(initialSize);
      for (let i = 0; i < initialSize; i++) this._pool[i] = this._create();
      this._len = initialSize;
    }
    get() {
      if (this._len > 0) {
        const obj = this._pool[--this._len];
        this._pool[this._len] = null;
        return obj;
      }
      return this._create();
    }
    release(obj) {
      this._reset(obj);
      this._pool[this._len++] = obj;
    }
  }

  class NeuralNetworkEngine {
    constructor(containerId) {
      this.container = document.getElementById(containerId);
      if (!this.container) throw new Error("Container not found");

      // Read theme-based colors from CSS variables
      this.NODE_RGB = readCssRGBTuple('--nn-node-color', '96, 165, 250');
      this.LINK_RGB = readCssRGBTuple('--nn-link-color', '96, 165, 250');
      this.PULSE_RGB = readCssRGBTuple('--nn-pulse-color', '56, 189, 248');

      // Device pixel ratio (clamped)
      this.dpr = clamp(window.devicePixelRatio || 1, 1, CONFIG.DPR_MAX);

      // Create three canvas layers (background, static, dynamic) with appropriate z-index
      this.bg = this._mkLayer(0);
      this.static = this._mkLayer(1);
      this.dynamic = this._mkLayer(2);

      // Assign IDs to layers for styling (optional)
      this.bg.c.id = 'nn-layer-bg';
      this.static.c.id = 'nn-layer-static';
      this.dynamic.c.id = 'nn-layer-dynamic';

      this._resizePrevW = this.container.clientWidth || 1;
      this._resizePrevH = this.container.clientHeight || 1;

      // Preallocate collections
      this.nodes = [];
      this.bgNodes = [];
      this.links = [];
      this.dynamicLinks = [];
      this.staticLinks = [];
      this.bgLinks = [];
      this.movingFlags = [];
      this._bgDirX = Math.cos(CONFIG.BG_DRIFT_HEADING_RAD || 0);
      this._bgDirY = Math.sin(CONFIG.BG_DRIFT_HEADING_RAD || 0);

      // Responsive caps calculated per resize (remain tunable via CONFIG)
      this.nodeMax = CONFIG.NODE_COUNT;
      this.bgNodeMax = CONFIG.BG_NODE_COUNT;
      this.linkDistanceMax = CONFIG.MAX_LINK_DISTANCE;
      this.bgLinkDistanceMax = CONFIG.BG_LINK_MAX_DISTANCE;
      this.pulseMaxActive = CONFIG.PULSE_MAX_ACTIVE;

      // Initial sizing and node setup
      this._resize(true);
      window.addEventListener('resize', () => this._resize(false), { passive: true });

      // Simulation state
      // Pulses:
      this.pulsePool = new ObjectPool(
        () => ({ linkIndex: -1, t: 0, active: false, dist: 1 }),
        (o) => { o.linkIndex = -1; o.t = 0; o.active = false; o.dist = 1; return o; },
        CONFIG.PULSE_POOL_SIZE
      );
      this.pulses = new Array(CONFIG.PULSE_POOL_SIZE);
      this.pulsesLen = 0;
      this._lastPulseSpawn = 0;
      this._globalOffsetX = 0;
      this._globalOffsetY = 0;
      this._bgOffsetX = 0;
      this._bgOffsetY = 0;

      // Offscreen sprites for nodes and pulses
      this._buildSprites();

      this._loopStart = performance.now();
      this._lastTheta = Math.random() * Math.PI * 2;  // randomize initial phase

      this._startPhase = (CONFIG.INITIAL_GLOBAL_PHASE_TURNS || 0) * Math.PI * 2;

      // Initialize node positions and links
      this._setupNodesEven();
      this._buildLinks();
      this._buildBgLinks();
      this._drawBackground();
      this._drawStaticLayer();

      // Begin main loop (fixed timestep update + render)
      this._running = false;
      this._prev = performance.now();
      this._lag = 0;
      this._dt_ms = 1000 / CONFIG.UPDATE_HZ;
      this._minFrameMs = 1000 / CONFIG.RENDER_FPS_CAP;

      // Apply radial edge fades via CSS masks if enabled
      if (CONFIG.EDGE_FADE_DYNAMIC) {
        const c = this.dynamic.c;
        c.style.maskImage = `radial-gradient(circle at center, black ${CONFIG.EDGE_FADE_DYNAMIC_INNER * 100}%, transparent ${CONFIG.EDGE_FADE_DYNAMIC_OUTER * 100}%)`;
        c.style.maskRepeat = 'no-repeat';
        c.style.maskPosition = 'center';
        c.style.maskSize = 'cover';
        c.style.webkitMaskImage = c.style.maskImage;
        c.style.webkitMaskRepeat = 'no-repeat';
        c.style.webkitMaskPosition = 'center';
        c.style.webkitMaskSize = 'cover';
      }
      if (CONFIG.EDGE_FADE_STATIC) {
        const c = this.static.c;
        c.style.maskImage = `radial-gradient(circle at center, black ${CONFIG.EDGE_FADE_STATIC_INNER * 100}%, transparent ${CONFIG.EDGE_FADE_STATIC_OUTER * 100}%)`;
        c.style.maskRepeat = 'no-repeat';
        c.style.maskPosition = 'center';
        c.style.maskSize = 'cover';
        c.style.webkitMaskImage = c.style.maskImage;
        c.style.webkitMaskRepeat = 'no-repeat';
        c.style.webkitMaskPosition = 'center';
        c.style.webkitMaskSize = 'cover';
      }
      if (CONFIG.EDGE_FADE_BG) {
        const c = this.bg.c;
        c.style.maskImage = `radial-gradient(circle at center, black ${CONFIG.EDGE_FADE_BG_INNER * 100}%, transparent ${CONFIG.EDGE_FADE_BG_OUTER * 100}%)`;
        c.style.maskRepeat = 'no-repeat';
        c.style.maskPosition = 'center';
        c.style.maskSize = 'cover';
        c.style.webkitMaskImage = c.style.maskImage;
        c.style.webkitMaskRepeat = 'no-repeat';
        c.style.webkitMaskPosition = 'center';
        c.style.webkitMaskSize = 'cover';
      }
    }

    _mkLayer(zIndex) {
      const c = document.createElement('canvas');
      c.style.zIndex = String(zIndex);
      const ctx = c.getContext('2d', { alpha: true });
      this.container.appendChild(c);
      return { c, ctx };
    }

    _applyResponsiveScaling(width, height) {
      const area = Math.max(1, width * height);
      const kA = area / BASELINE.AREA;
      const kL = Math.sqrt(kA);
      this.nodeMax = clamp(Math.round(BASELINE.NODE_COUNT * kA), 16, CONFIG.NODE_COUNT);
      this.bgNodeMax = clamp(Math.round(BASELINE.BG_NODE_COUNT * kA), 12, CONFIG.BG_NODE_COUNT);
      this.linkDistanceMax = Math.max(80, Math.round(BASELINE.MAX_LINK_DISTANCE * kL));
      this.pulseMaxActive = clamp(Math.round(BASELINE.PULSE_MAX_ACTIVE * kL), 1, CONFIG.PULSE_MAX_ACTIVE);
      this.bgLinkDistanceMax = Math.max(60, Math.round(BASELINE.BG_LINK_MAX_DISTANCE * kL));
    }

    _resize(first) {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      const prevW = this._resizePrevW;
      const prevH = this._resizePrevH;
      this._resizePrevW = w;
      this._resizePrevH = h;

      this._applyResponsiveScaling(w, h);

      this.width = w;
      this.height = h;
      for (const layer of [this.bg, this.static, this.dynamic]) {
        layer.c.width = Math.floor(w * this.dpr);
        layer.c.height = Math.floor(h * this.dpr);
        layer.c.style.width = w + 'px';
        layer.c.style.height = h + 'px';
        layer.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }

      // Proportional reflow of node positions & origins on resize
      const targets = this._getTargetCounts();
      const needRebuild =
        first ||
        !this.nodes.length ||
        this.nodes.length !== targets.nodeCount ||
        this.bgNodes.length !== targets.bgCount;

      if (!needRebuild && this.nodes.length) {
        const sx = prevW ? w / prevW : 1;
        const sy = prevH ? h / prevH : 1;
        for (let i = 0; i < this.nodes.length; i++) {
          const n = this.nodes[i];
          n.x *= sx; n.y *= sy;
          n.ox *= sx; n.oy *= sy;
        }
        for (let i = 0; i < this.bgNodes.length; i++) {
          const b = this.bgNodes[i];
          b.x *= sx; b.y *= sy;
        }
        this._buildLinks();       // distances changed, rebuild edges
        this._buildBgLinks();
      } else if (!first) {
        this._setupNodesEven();
        this._buildLinks();
        this._buildBgLinks();
      }

      // Always redraw the static/background layers on resize
      this._drawBackground();
      this._drawStaticLayer();
    }

    _buildSprites() {
      const r = CONFIG.NODE_RADIUS_BASE;
      // Primary node glow sprite (radial gradient circle)
      const s = document.createElement('canvas');
      s.width = s.height = r * 2;
      const g = s.getContext('2d');
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0.0, `rgba(${this.NODE_RGB}, 1)`);
      grad.addColorStop(0.2, `rgba(${this.NODE_RGB}, 1)`);
      grad.addColorStop(1.0, `rgba(${this.NODE_RGB}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, s.width, s.height);
      this.nodeSprite = s;

      // Pulse sprite (small radial gradient circle)
      const pr = CONFIG.PULSE_RADIUS;
      const ps = document.createElement('canvas');
      ps.width = ps.height = pr * 2;
      const pg = ps.getContext('2d');
      const pgrad = pg.createRadialGradient(pr, pr, 0, pr, pr, pr);
      pgrad.addColorStop(0.0, `rgba(${this.PULSE_RGB}, 1)`);
      pgrad.addColorStop(0.5, `rgba(${this.PULSE_RGB}, 0.5)`);
      pgrad.addColorStop(1.0, `rgba(${this.PULSE_RGB}, 0)`);
      pg.fillStyle = pgrad;
      pg.fillRect(0, 0, ps.width, ps.height);
      this.pulseSprite = ps;
    }

    _bandForZ(z) {
      for (const b of CONFIG.PARALLAX_BANDS) {
        if (z >= b.zMin && z < b.zMax) return b;
      }
      return CONFIG.PARALLAX_BANDS[CONFIG.PARALLAX_BANDS.length - 1];
    }

    _getTargetCounts() {
      const scale = (Math.min(this.width, this.height) < 900) ? CONFIG.MOBILE_SCALE : 1.0;
      const nodeCount = Math.max(16, Math.round(this.nodeMax * scale));
      const bgCount = Math.max(12, Math.round(this.bgNodeMax * scale));
      return {
        nodeCount,
        bgCount
      };
    }

    _setupNodesEven() {
      const { nodeCount, bgCount } = this._getTargetCounts();

      // Foreground nodes (near + mid) using Poisson-disc for even spread
      const area = this.width * this.height;
      const spacing = Math.sqrt(area / nodeCount);
      const r = Math.max(18, spacing * 0.55);
      const pts = poisson(this.width, this.height, r);
      this.nodes.length = nodeCount;
      this.movingFlags.length = nodeCount;

      for (let i = 0; i < nodeCount; i++) {
        const basePt = pts[i % pts.length] || { x: Math.random() * this.width, y: Math.random() * this.height };
        const jitterR = spacing * 0.2 * Math.random();
        const jitterA = Math.random() * Math.PI * 2;
        const px = clamp(basePt.x + Math.cos(jitterA) * jitterR, 0, this.width);
        const py = clamp(basePt.y + Math.sin(jitterA) * jitterR, 0, this.height);
        const z = Math.random();  // depth [0,1)
        const band = this._bandForZ(z);
        this.nodes[i] = {
          id: i,
          x: px,
          y: py,
          z,
          ox: px,
          oy: py,
          seedPhase: CONFIG.RANDOMIZE_NODE_PHASES ? (Math.random() * (CONFIG.STARTING_PHASE_RANDOMIZER || 0) * Math.PI * 2) : 0,   // random start phase for motion
        };
        this.movingFlags[i] = band.move ? 1 : 0;
      }

      // Background decorative nodes (far static, larger minimum spacing)
      const bgSpacing = Math.sqrt(area / bgCount);
      const rbg = Math.max(24, bgSpacing * 0.6);
      const bgPts = poisson(this.width, this.height, rbg);
      this.bgNodes.length = bgCount;
      for (let i = 0; i < bgCount; i++) {
        const base = bgPts[i % bgPts.length] || { x: Math.random() * this.width, y: Math.random() * this.height };
        const jitterR = bgSpacing * 0.25 * Math.random();
        const jitterA = Math.random() * Math.PI * 2;
        const bx = clamp(base.x + Math.cos(jitterA) * jitterR, 0, this.width);
        const by = clamp(base.y + Math.sin(jitterA) * jitterR, 0, this.height);
        this.bgNodes[i] = { x: bx, y: by, z: 0.85 + Math.random() * 0.15 };
      }
    }

    _buildLinks() {
      const n = this.nodes.length;
      const degrees = new Int16Array(n);
      const indices = shuffleArray(Array.from({ length: n }, (_, i) => i));
      const links = [];
      const seen = new Set();
      const candidates = [];
      const maxDist = this.linkDistanceMax;

      for (const i of indices) {
        candidates.length = 0;
        const nodeA = this.nodes[i];
        const capA = this.movingFlags[i] ? CONFIG.MAX_LINKS_DYNAMIC : CONFIG.MAX_LINKS_STATIC;
        if (degrees[i] >= capA) continue;

        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const key = i < j ? `${i}-${j}` : `${j}-${i}`;
          if (seen.has(key)) continue;
          const nodeB = this.nodes[j];
          const dx = nodeA.x - nodeB.x;
          const dy = nodeA.y - nodeB.y;
          const dist = Math.hypot(dx, dy);
          if (dist > maxDist || dist === 0) continue;
          const capB = this.movingFlags[j] ? CONFIG.MAX_LINKS_DYNAMIC : CONFIG.MAX_LINKS_STATIC;
          if (degrees[j] >= capB) continue;
          const weight = (1 / Math.pow(dist, 1.2)) * (1 + Math.random() * 0.08);
          candidates.push({ j, dist, weight });
        }

        if (!candidates.length) continue;
        candidates.sort((a, b) => b.weight - a.weight);

        for (const entry of candidates) {
          const j = entry.j;
          const key = i < j ? `${i}-${j}` : `${j}-${i}`;
          if (seen.has(key)) continue;
          const capAcur = this.movingFlags[i] ? CONFIG.MAX_LINKS_DYNAMIC : CONFIG.MAX_LINKS_STATIC;
          const capBcur = this.movingFlags[j] ? CONFIG.MAX_LINKS_DYNAMIC : CONFIG.MAX_LINKS_STATIC;
          if (degrees[i] >= capAcur || degrees[j] >= capBcur) continue;
          links.push({ ai: i, bi: j, d: entry.dist });
          seen.add(key);
          degrees[i]++; degrees[j]++;
        }
      }
      this.links = links;
      this.staticLinks = [];
      this.dynamicLinks = [];
      for (let idx = 0; idx < links.length; idx++) {
        const L = links[idx];
        if (this.movingFlags[L.ai] || this.movingFlags[L.bi]) {
          this.dynamicLinks.push(idx);  // link involves at least one moving node
        } else {
          this.staticLinks.push(idx);
        }
      }
    }

    _buildBgLinks() {
      const m = this.bgNodes.length;
      const degreeCap = Math.max(1, Math.min(CONFIG.BG_LINK_MAX_DEGREE, CONFIG.MAX_LINKS_STATIC));
      const deg = new Int16Array(m);
      const edges = [];
      const maxDist = this.bgLinkDistanceMax;
      for (let i = 0; i < m; i++) {
        const a = this.bgNodes[i];
        for (let j = i + 1; j < m; j++) {
          const b = this.bgNodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist > maxDist || dist === 0) continue;
          const weight = (1 / Math.pow(dist, 1.2)) * (1 + Math.random() * 0.05);
          edges.push({ ai: i, bi: j, weight });
        }
      }
      edges.sort((a, b) => b.weight - a.weight);
      this.bgLinks = [];
      for (const edge of edges) {
        if (deg[edge.ai] >= degreeCap || deg[edge.bi] >= degreeCap) continue;
        this.bgLinks.push(edge);
        deg[edge.ai]++; deg[edge.bi]++;
      }
    }

    // ---------------- Drawing helpers ----------------
    _nodeScaleForZ(z) {
      return lerp(CONFIG.NODE_NEAR_SCALE, CONFIG.NODE_FAR_SCALE, z);
    }
    _nodeAlphaForZ(z) {
      return lerp(CONFIG.BRIGHTNESS_NEAR, CONFIG.BRIGHTNESS_FAR, z);
    }
    _lineWidthForZ(z) {
      return lerp(CONFIG.LINE_WIDTH_NEAR, CONFIG.LINE_WIDTH_FAR, z);
    }
    _lineAlphaForDist(dist) {
      const maxDist = Math.max(1, this.linkDistanceMax);
      const t = Math.min(1, Math.max(0, dist / maxDist));
      return lerp(CONFIG.LINE_ALPHA_MIN, CONFIG.LINE_ALPHA_MAX, t);
    }

    _drawNode(ctx, node, drawX, drawY) {
      const scale = this._nodeScaleForZ(node.z);
      const sprite = this.nodeSprite;
      const size = sprite.width * scale;
      const alpha = this._nodeAlphaForZ(node.z);
      ctx.globalAlpha = alpha;
      const x = (drawX !== undefined ? drawX : node.x);
      const y = (drawY !== undefined ? drawY : node.y);
      ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }

    // _drawBackground(): draw background links and nodes (no offsets applied here)
    _drawBackground() {
      const ctx = this.bg.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      // Soft background wiring (static links among bgNodes)
      ctx.beginPath();
      for (let i = 0; i < this.bgLinks.length; i++) {
        const L = this.bgLinks[i];
        const a = this.bgNodes[L.ai], b = this.bgNodes[L.bi];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.strokeStyle = `rgba(${this.LINK_RGB}, ${CONFIG.BG_LINK_ALPHA})`;
      ctx.lineWidth = CONFIG.BG_LINK_WIDTH;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Mask out lines behind background nodes (punch-through)
      if (CONFIG.DYNAMIC_LINE_PUNCH) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < this.bgNodes.length; i++) {
          const b = this.bgNodes[i];
          const radius = CONFIG.NODE_RADIUS_BASE * this._nodeScaleForZ(b.z) * CONFIG.PUNCH_THROUGH_RADIUS_SCALE;
          ctx.beginPath();
          ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Draw background nodes (static points)
      for (let i = 0; i < this.bgNodes.length; i++) {
        this._drawNode(ctx, this.bgNodes[i], this.bgNodes[i].x, this.bgNodes[i].y);
      }
    }

    // _drawStaticLayer(): draw static network links & nodes (no offsets applied here)
    _drawStaticLayer() {
      const ctx = this.static.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.lineCap = 'round';
      for (let i = 0; i < this.staticLinks.length; i++) {
        const L = this.links[this.staticLinks[i]];
        const a = this.nodes[L.ai], b = this.nodes[L.bi];
        const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        const alphaDist = this._lineAlphaForDist(dist);
        const alphaA = this._nodeAlphaForZ(a.z) * alphaDist;
        const alphaB = this._nodeAlphaForZ(b.z) * alphaDist;
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, `rgba(${this.LINK_RGB}, ${alphaA})`);
        grad.addColorStop(1, `rgba(${this.LINK_RGB}, ${alphaB})`);
        const zAvg = (a.z + b.z) * 0.5;
        ctx.strokeStyle = grad;
        ctx.lineWidth = this._lineWidthForZ(zAvg);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      // Mask out lines under static nodes
      if (CONFIG.DYNAMIC_LINE_PUNCH) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < this.nodes.length; i++) {
          if (this.movingFlags[i]) continue;  // only far/static nodes
          const x = this.nodes[i].x;
          const y = this.nodes[i].y;
          const radius = CONFIG.NODE_RADIUS_BASE * this._nodeScaleForZ(this.nodes[i].z) * CONFIG.PUNCH_THROUGH_RADIUS_SCALE;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      // Draw static nodes (far layer) on top of their links
      for (let i = 0; i < this.nodes.length; i++) {
        if (!this.movingFlags[i]) {
          this._drawNode(ctx, this.nodes[i], this.nodes[i].x, this.nodes[i].y);
        }
      }
    }

    // ---------------- Main Loop Control ----------------
    start() {
      if (this._running) return;
      this._running = true;
      this._prev = performance.now();
      this._lag = 0;
      requestAnimationFrame(t => this._loop(t));
    }
    stop() {
      this._running = false;
    }

    _loop(now) {
      if (!this._running) return;
      // Cap rendering rate
      const frameElapsed = now - this._prev;
      if (frameElapsed < this._minFrameMs) {
        requestAnimationFrame(t => this._loop(t));
        return;
      }
      let elapsed = frameElapsed;
      this._prev = now;
      this._lag += elapsed;
      // Fixed-step simulation updates (with a simple cap to avoid spiral of death)
      const dt = this._dt_ms;
      let steps = 0;
      while (this._lag >= dt && steps < 2) {
        this._update(dt, now);
        this._lag -= dt;
        steps++;
      }
      this._render();
      requestAnimationFrame(t => this._loop(t));
    }

    _update(dt_ms, now) {
      const TAU = Math.PI * 2;

      // Base loop angle + optional global start offset
      const baseTheta =
        (((now - this._loopStart) % CONFIG.LOOP_DURATION_MS) / CONFIG.LOOP_DURATION_MS) * TAU
        + (this._startPhase || 0);

      // Keep old variable name alive for global/bg drift code:
      const theta = baseTheta;

      // Per-layer angles (carry cycles, direction, and layer offsets)
      const nearTheta = baseTheta * (CONFIG.ELLIPSE_NEAR_CYCLES || 1) * (CONFIG.ELLIPSE_NEAR_DIRECTION || 1)
        + (CONFIG.NEAR_PHASE_OFFSET_TURNS || 0) * TAU;

      const midTheta = baseTheta * (CONFIG.ELLIPSE_MID_CYCLES || 1) * (CONFIG.ELLIPSE_MID_DIRECTION || 1)
        + (CONFIG.MID_PHASE_OFFSET_TURNS || 0) * TAU;

      // Precompute layer trig for this frame
      const cosNear = Math.cos(nearTheta), sinNear = Math.sin(nearTheta);
      const cosMid = Math.cos(midTheta), sinMid = Math.sin(midTheta);

      // Global drift (unchanged, now uses `theta`)
      const minDim = Math.max(1, Math.min(this.width, this.height));
      const globalAmp = CONFIG.GLOBAL_DRIFT_RATIO * minDim;
      this._globalOffsetX = globalAmp * Math.sin(theta);
      this._globalOffsetY = globalAmp * Math.cos(theta + 1.2);

      // Background drift (unchanged, now uses `theta`)
      const bgMagnitude = CONFIG.BG_DRIFT_RATIO * minDim;
      const bgPhase = theta * CONFIG.BG_DRIFT_SPEED_MULT + CONFIG.BG_DRIFT_PHASE;
      this._bgOffsetX = this._bgDirX * bgMagnitude * Math.sin(bgPhase);
      this._bgOffsetY = this._bgDirY * bgMagnitude * Math.sin(bgPhase);

      // Moving nodes: elliptical motion around origin (per layer)
      const baseScale = minDim / 900;
      // Precompute cos/sin for near and mid layer cycle frequencies
      // Orientation angles for ellipse paths
      const nearPhi = CONFIG.PARALLAX_BANDS[0].headingRad || 0;
      const cosPhiNear = Math.cos(nearPhi), sinPhiNear = Math.sin(nearPhi);
      const midPhi = CONFIG.PARALLAX_BANDS[1].headingRad || 0;
      const cosPhiMid = Math.cos(midPhi), sinPhiMid = Math.sin(midPhi);
      // Scaled ellipse radii (proportional to viewport size)
      const nearRadiusX = (CONFIG.ELLIPSE_RADIUS_NEAR_X || 0) * baseScale;
      const nearRadiusY = (CONFIG.ELLIPSE_RADIUS_NEAR_Y || 0) * baseScale;
      const midRadiusX = (CONFIG.ELLIPSE_RADIUS_MID_X || 0) * baseScale;
      const midRadiusY = (CONFIG.ELLIPSE_RADIUS_MID_Y || 0) * baseScale;
      for (let i = 0; i < this.nodes.length; i++) {
        if (!this.movingFlags[i]) continue;
        const n = this.nodes[i];

        // (optional micro-opt: cache these on the node at setup)
        const cosSeed = Math.cos(n.seedPhase);
        const sinSeed = Math.sin(n.seedPhase);

        if (n.z < (CONFIG.PARALLAX_BANDS[1].zMin || 0.35)) {
          // NEAR
          const c = cosNear * cosSeed - sinNear * sinSeed;
          const s = sinNear * cosSeed + cosNear * sinSeed;
          const xOff = nearRadiusX * c;
          const yOff = nearRadiusY * s;
          const rotX = cosPhiNear * xOff - sinPhiNear * yOff;
          const rotY = sinPhiNear * xOff + cosPhiNear * yOff;
          n.x = n.ox + rotX;
          n.y = n.oy + rotY;
        } else {
          // MID
          const c = cosMid * cosSeed - sinMid * sinSeed;
          const s = sinMid * cosSeed + cosMid * sinSeed;
          const xOff = midRadiusX * c;
          const yOff = midRadiusY * s;
          const rotX = cosPhiMid * xOff - sinPhiMid * yOff;
          const rotY = sinPhiMid * xOff + cosPhiMid * yOff;
          n.x = n.ox + rotX;
          n.y = n.oy + rotY;
        }
      }
      // (Optional) Reset pulses at loop seam if needed for continuity
      // const wrapped = theta < (this._lastTheta || 0);
      // if (wrapped) { this.pulsesLen = 0; this._lastPulseSpawn = now; }
      // this._lastTheta = theta;

      // Spawn pulses at intervals along dynamic links
      if (now - this._lastPulseSpawn >= CONFIG.PULSE_SPAWN_EVERY_MS &&
        this.pulsesLen < this.pulseMaxActive) {
        const p = this.pulsePool.get();
        if (this.dynamicLinks.length > 0) {
          p.linkIndex = this.dynamicLinks[(Math.random() * this.dynamicLinks.length) | 0];
        } else if (this.links.length > 0) {
          p.linkIndex = (Math.random() * this.links.length) | 0;
        } else {
          p.linkIndex = -1;
        }
        if (p.linkIndex !== -1) {
          const L = this.links[p.linkIndex];
          const ai = L.ai, bi = L.bi;
          const ax = this.nodes[ai].x;
          const ay = this.nodes[ai].y;
          const bx = this.nodes[bi].x;
          const by = this.nodes[bi].y;
          p.dist = Math.max(1, Math.hypot(bx - ax, by - ay));
          p.t = 0;
          p.active = true;
          this.pulses[this.pulsesLen++] = p;
          this._lastPulseSpawn = now;
        } else {
          this.pulsePool.release(p);
        }
      }

      // Advance pulses along their links
      const tInc = CONFIG.PULSE_SPEED * (dt_ms / 1000);
      let j = 0;
      for (let i = 0; i < this.pulsesLen; i++) {
        const p = this.pulses[i];
        if (!p.active) continue;
        p.t += tInc / p.dist;
        if (p.t >= 1) {
          this.pulsePool.release(p);
        } else {
          this.pulses[j++] = p;
        }
      }
      this.pulsesLen = j;
    }

    _render() {
      // Apply layer parallax via CSS transforms (global + background drift)
      this.bg.c.style.transform = `translate(${this._globalOffsetX + this._bgOffsetX}px, ${this._globalOffsetY + this._bgOffsetY}px)`;
      this.static.c.style.transform = `translate(${this._globalOffsetX}px, ${this._globalOffsetY}px)`;

      // Draw dynamic layer (moving links, pulses, nodes)
      const ctx = this.dynamic.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      // Offscreen culling bounds
      const minX = -CONFIG.CULL_MARGIN, minY = -CONFIG.CULL_MARGIN;
      const maxX = this.width + CONFIG.CULL_MARGIN, maxY = this.height + CONFIG.CULL_MARGIN;
      const offsetX = this._globalOffsetX;
      const offsetY = this._globalOffsetY;

      // Dynamic links (connecting any moving node)
      ctx.lineCap = 'round';
      for (let i = 0; i < this.dynamicLinks.length; i++) {
        const idx = this.dynamicLinks[i];
        const L = this.links[idx];
        const ai = L.ai, bi = L.bi;
        const ax = this.nodes[ai].x + offsetX;
        const ay = this.nodes[ai].y + offsetY;
        const bx = this.nodes[bi].x + offsetX;
        const by = this.nodes[bi].y + offsetY;
        const bx0 = Math.min(ax, bx), by0 = Math.min(ay, by);
        const bx1 = Math.max(ax, bx), by1 = Math.max(ay, by);
        if (bx1 < minX || bx0 > maxX || by1 < minY || by0 > maxY) continue;
        const dist = Math.max(1, Math.hypot(bx - ax, by - ay));
        const zAvg = (this.nodes[ai].z + this.nodes[bi].z) * 0.5;
        ctx.lineWidth = this._lineWidthForZ(zAvg);
        const alphaDist = this._lineAlphaForDist(dist);
        const alphaA = this._nodeAlphaForZ(this.nodes[ai].z) * alphaDist;
        const alphaB = this._nodeAlphaForZ(this.nodes[bi].z) * alphaDist;
        const grad = ctx.createLinearGradient(ax, ay, bx, by);
        grad.addColorStop(0, `rgba(${this.LINK_RGB}, ${alphaA})`);
        grad.addColorStop(1, `rgba(${this.LINK_RGB}, ${alphaB})`);
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }

      // Mask out dynamic lines behind moving nodes (punch-through circles)
      if (CONFIG.DYNAMIC_LINE_PUNCH) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < this.nodes.length; i++) {
          if (!this.movingFlags[i]) continue;  // only moving nodes
          const x = this.nodes[i].x + offsetX;
          const y = this.nodes[i].y + offsetY;
          if (x < minX || x > maxX || y < minY || y > maxY) continue;
          const radius = CONFIG.NODE_RADIUS_BASE * this._nodeScaleForZ(this.nodes[i].z) * CONFIG.PUNCH_THROUGH_RADIUS_SCALE;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Pulses (small moving orbs along links)
      const ps = this.pulseSprite;
      for (let i = 0; i < this.pulsesLen; i++) {
        const p = this.pulses[i];
        const L = this.links[p.linkIndex];
        const ai = L.ai, bi = L.bi;
        const ax = this.nodes[ai].x + offsetX;
        const ay = this.nodes[ai].y + offsetY;
        const bx = this.nodes[bi].x + offsetX;
        const by = this.nodes[bi].y + offsetY;
        const x = ax + (bx - ax) * p.t;
        const y = ay + (by - ay) * p.t;
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        ctx.drawImage(ps, x - ps.width / 2, y - ps.height / 2, ps.width, ps.height);
      }

      // Draw moving nodes on top
      for (let i = 0; i < this.nodes.length; i++) {
        if (!this.movingFlags[i]) continue;
        const n = this.nodes[i];
        const drawX = n.x + offsetX;
        const drawY = n.y + offsetY;
        // Cull by approximate sprite bounds
        if (drawX < minX || drawX > maxX || drawY < minY || drawY > maxY) continue;
        this._drawNode(ctx, n, drawX, drawY);
      }
    }
  }

  // ----------------- Theme Toggle (Dark/Light) -----------------
  function initThemeToggle(engine) {
    const btn = document.getElementById('theme-toggle');
    const stored = localStorage.getItem('nn-theme');
    if (stored === 'dark') document.body.dataset.theme = 'dark';
    else if (stored === 'light') document.body.dataset.theme = 'light';
    btn.addEventListener('click', () => {
      const cur = (document.body.dataset.theme === 'dark') ? 'light' : 'dark';
      document.body.dataset.theme = cur;
      localStorage.setItem('nn-theme', cur);
      // Update engine colors & sprites for new theme, then redraw static layers
      engine.NODE_RGB = readCssRGBTuple('--nn-node-color', engine.NODE_RGB);
      engine.LINK_RGB = readCssRGBTuple('--nn-link-color', engine.LINK_RGB);
      engine.PULSE_RGB = readCssRGBTuple('--nn-pulse-color', engine.PULSE_RGB);
      engine._buildSprites();
      engine._drawBackground();
      engine._drawStaticLayer();
    });
  }

  // ----------------- Initialize on DOM Ready -----------------
  document.addEventListener('DOMContentLoaded', () => {
    const engine = new NeuralNetworkEngine('canvas-container');
    window.nnEngine = engine; // expose for external tuning if needed
    initThemeToggle(engine);
    engine.start();

    const media = matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) engine.stop();
    media.addEventListener('change', e => e.matches ? engine.stop() : engine.start());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) engine.stop();
      else engine.start();
    }, { passive: true });
  });
})();
