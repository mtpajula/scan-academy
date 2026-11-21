/* ============================================================
   field.js — Phase 2: top-view field work.
   Drag the scanner with the mouse, press SCAN.
   Raycast simulation: concrete structures cast "shadows",
   targets are only recognised with line of sight and within
   target range. Vibration / handheld scanning blur the cloud;
   rain adds droplet "ghost" points, and an uncovered scanner
   gets a wet window (noisy scan). The umbrella keeps it dry
   but its clamp shadows a narrow sector.
   ============================================================ */
window.G = window.G || {};

G.field = {
  canvas: null, ctx: null,
  segs: null, cells: null,
  scanner: { x: 300, y: 250 },
  lastValid: { x: 300, y: 250 },
  dragging: false,
  anim: null,          // active scan animation
  rain: [],

  enter() {
    G._fieldEntered = true;
    this.canvas = document.getElementById('field-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.segs = G.buildSegments();
    this.cells = G.buildCells(this.segs);

    // state reset for the field phase (also invalidates any later phases)
    G.state.scans = [];
    G.state.linkEdges = [];
    G.state.results = null;
    G._regEntered = false;
    G._maxScreen = 1;
    G.state.battery = 100;                              // current battery %
    G.state.spares = G.prep.has('battery') ? 2 : 0;     // swappable spare batteries
    G.state.maxScans = G.prep.has('sdcard') ? 99 : 4;
    this.scanner.x = this.lastValid.x = 300;
    this.scanner.y = this.lastValid.y = 250;
    G.state.scanner = this.scanner;
    this.anim = null;
    this.dragging = false;
    const W = G.MAP.world;
    this.rain = Array.from({ length: 160 }, () => ({
      x: W.x + Math.random() * W.w, y: Math.random() * 640, v: 3 + Math.random() * 3 }));

    // If the scanner itself was forgotten → block with a way back
    const ov = document.getElementById('field-overlay');
    if (!G.prep.has('scanner')) {
      document.getElementById('field-overlay-title').textContent = '😱 You forgot the laser scanner!';
      document.getElementById('field-overlay-text').textContent =
        'The van has limited space — and the one thing you cannot work without is still on the shelf. Go back and pack it.';
      const b = document.getElementById('field-overlay-btn');
      b.textContent = '← Back to preparation';
      b.onclick = () => { ov.classList.add('hidden'); G.showScreen('prep'); };
      ov.classList.remove('hidden');
    } else {
      ov.classList.add('hidden');
      const warn = [];
      if (!G.prep.has('tripod')) warn.push('no tripod → handheld scans will be shaken');
      if (!G.prep.has('ppe')) warn.push('no PPE → you may not leave the hall');
      if (!G.prep.has('sdcard')) warn.push('no SD card → memory holds only 4 scans');
      if (!G.prep.has('battery')) warn.push('no spare batteries → 7 scans max');
      if (warn.length) G.toast('⚠ ' + warn.join(' · '), 5000);
    }

    document.getElementById('btn-scan').onclick = () => this.tryScan();
    document.getElementById('btn-swap').onclick = () => this.swapBattery();
    document.getElementById('btn-to-register').onclick = () => {
      if (G.state.scans.length === 0) { G.toast('Do at least one scan first!'); return; }
      if (this.anim) { G.toast('Wait for the current scan to finish…'); return; }
      if (!G._regEntered) G.register.enter();
      G.showScreen('register');
    };

    this.bindPointer();
    this.updateHud();
    this.renderScanList();
  },

  /* ---------- placement rules ---------- */
  canPlace(x, y) {
    const w = G.MAP.world;
    if (x < w.x + 12 || x > w.x + w.w - 12 || y < w.y + 12 || y > w.y + w.h - 12) return 'Outside the site boundary!';
    for (const s of this.segs)
      if (s.kind === 'wall' && G.distPointSeg(x, y, s) < 10) return 'Too close to the hall wall — the tripod does not fit there.';
    for (const p of G.MAP.pillars) if (G.pointInRect(x, y, p, 10)) return 'Cannot set up inside a concrete pillar!';
    for (const o of G.MAP.outside) if (G.pointInRect(x, y, o, 10)) return 'Cannot set up inside the ' + o.label + '!';
    if (G.pointInRect(x, y, G.MAP.machine, 12)) return 'Cannot set up inside the compressor!';
    if (!G.prep.has('ppe') && !G.isInside(x, y))
      return '🔒 Site safety: no PPE packed → no access outside the hall!';
    return null;
  },

  /* ---------- scanning ---------- */
  tryScan() {
    if (this.anim || this.dragging) return;
    if (!G.prep.has('scanner')) return;
    const { x, y } = this.scanner;
    const err = this.canPlace(x, y);
    if (err) { G.toast('⛔ ' + err); return; }
    if (G.state.scans.length >= G.state.maxScans) {
      G.toast('💾 Scanner storage full (' + G.state.maxScans + ' scans) — no SD card was packed!');
      return;
    }
    if (G.state.battery < 14) {
      G.toast('🔋 Battery empty — ' + (G.state.spares > 0 ? 'swap in a spare battery!' : 'no spare batteries were packed!'));
      return;
    }
    G.state.battery -= 14;

    const outside = !G.isInside(x, y);
    const umbrella = outside && G.prep.has('weather');
    const m = G.MAP.machine;
    const issues = [];
    if (!G.prep.has('tripod')) issues.push('handheld');
    if (G.dist(x, y, m.x + m.w / 2, m.y + m.h / 2) < m.vibrR) issues.push('vibration');
    if (outside && !G.prep.has('weather')) issues.push('wet');

    const inUmbrellaShadow = (a) => umbrella && G.angDiff(a, G.UMBRELLA.dir) < G.UMBRELLA.half;
    const tnoise = issues.length ? 0.35 : 0.04;           // target centre measurement noise (px)
    const seen = G.MAP.targets.filter(t =>
      G.dist(x, y, t.x, t.y) <= G.TARGET_RANGE &&
      !inUmbrellaShadow(Math.atan2(t.y - y, t.x - x)) &&
      G.losClear(x, y, t.x, t.y, this.segs));

    const scan = {
      id: G.state.scans.length + 1,
      x, y, outside, umbrella,
      points: this.raycast(x, y, { issues, outside, umbrella: inUmbrellaShadow }),
      // detected targets: TRUE identity (hidden from the player) + measured centre
      tobs: seen.map(t => ({ tid: t.id, x: t.x + G.rnd(-tnoise, tnoise), y: t.y + G.rnd(-tnoise, tnoise) })),
      issues,
      bad: issues.length > 0,
      color: G.PALETTE[(G.state.scans.length) % G.PALETTE.length],
    };
    scan.targets = scan.tobs.map(o => o.tid);
    this.anim = { scan, start: performance.now(), dur: 1500 };
    document.getElementById('scan-status').textContent = 'Scanning…';
    this.updateHud();
  },

  /* 360 rays, nearest hit per ray = one measured point.
     - vibration: smooth angular wobble (error grows with range)
     - handheld: random-walk angular drift
     - rain: some beams hit droplets → short-range ghost points
     - wet window: blurred angles + range noise
     - umbrella clamp: a narrow sector returns nothing */
  raycast(x, y, o) {
    const N = 360, pts = [];
    const vib = o.issues.includes('vibration'), hand = o.issues.includes('handheld'), wet = o.issues.includes('wet');
    const vA = vib ? 0.011 : 0, vK = 5 + Math.floor(Math.random() * 5), vP = Math.random() * 6.28;
    const ghostRate = o.outside ? (wet ? 0.07 : 0.035) : 0;
    let walk = 0;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      if (hand) walk = G.clamp(walk + G.rnd(-0.004, 0.004), -0.022, 0.022);
      if (o.umbrella(a)) continue;
      const dx = Math.cos(a), dy = Math.sin(a);
      let best = G.SCAN_RANGE;
      for (const s of this.segs) {
        const t = G.raySeg(x, y, dx, dy, s);
        if (t !== null && t < best) best = t;
      }
      if (best >= G.SCAN_RANGE) continue;
      if (Math.random() < ghostRate) {                    // raindrop return
        const r = G.rnd(6, Math.min(70, best));
        pts.push({ x: x + dx * r, y: y + dy * r, a, ghost: true });
        continue;
      }
      const ae = a + vA * Math.sin(vK * a + vP) + walk + (wet ? G.rnd(-0.008, 0.008) : 0);
      const r = best + G.rnd(-0.4, 0.4) + (wet ? G.rnd(-2, 2) : 0);
      pts.push({ x: x + Math.cos(ae) * r, y: y + Math.sin(ae) * r, a });
    }
    return pts;
  },

  finishAnim() {
    const scan = this.anim.scan;
    this.anim = null;
    G.state.scans.push(scan);
    // a new scan invalidates any registration already done
    if (G._regEntered || G.state.results) {
      G._regEntered = false; G.state.results = null; G._maxScreen = 1;
      G.showScreen('field');
      G.toast('New scan added — registration will start over.');
    }
    document.getElementById('scan-status').textContent = '';
    this.computeLinks();
    this.renderScanList();
    this.updateHud();
    if (scan.bad) G.toast('Scan ' + scan.id + ' done — the point cloud looks a bit… off. 🤔');
    else G.toast('✔ Scan ' + scan.id + ' stored (' + scan.points.length + ' pts, ' + scan.tobs.length + ' target(s) recognised)');
  },

  /* exact surface cells hit by a scan's real (non-ghost) points */
  cellSet(sc) {
    const set = new Set();
    for (const p of sc.points) if (!p.ghost) set.add(Math.round(p.x / 12) + ',' + Math.round(p.y / 12));
    return set;
  },

  /* surface coverage of a set of scans (fraction of surface cells hit) */
  coverageOf(scans) {
    const covered = new Set();
    for (const sc of scans) for (const k of this.cellSet(sc)) if (this.cells.has(k)) covered.add(k);
    return covered.size / this.cells.size;
  },

  /* cloud-to-cloud overlap graph: two scans can be linked only if their clouds
     cover ENOUGH of the SAME surfaces: >= 25 shared cells AND >= 20% of the
     smaller cloud. A few well-spread shared points are kept for ICP. */
  computeLinks() {
    const scans = G.state.scans;
    const sets = scans.map(sc => this.cellSet(sc));
    G.state.linkEdges = [];
    for (let i = 0; i < scans.length; i++)
      for (let j = i + 1; j < scans.length; j++) {
        const common = [];
        for (const k of sets[i]) if (sets[j].has(k)) common.push(k);
        const minSize = Math.min(sets[i].size, sets[j].size);
        if (common.length >= 25 && common.length >= 0.20 * minSize) {
          const cand = common.map(k => { const [cx, cy] = k.split(',').map(Number); return { x: cx * 12, y: cy * 12 }; });
          G.state.linkEdges.push({ a: scans[i].id, b: scans[j].id, common: common.length, samples: G.spreadSample(cand, 5) });
        }
      }
  },

  /* ---------- battery swap ---------- */
  swapBattery() {
    if (this.anim) return;
    if (G.state.spares <= 0) { G.toast('🔋 No spare batteries left!'); return; }
    if (G.state.battery >= 100) { G.toast('Battery already full.'); return; }
    G.state.spares--;
    G.state.battery = 100;
    G.toast('🔋 Spare battery swapped in → 100% (' + G.state.spares + ' left)');
    this.updateHud();
  },

  /* ---------- HUD / lists ---------- */
  updateHud() {
    const f = document.getElementById('battery-fill');
    const pct = G.clamp(G.state.battery, 0, 100);
    f.style.width = pct + '%';
    f.classList.toggle('low', pct < 30);
    document.getElementById('battery-txt').textContent = Math.round(pct) + '%';
    document.getElementById('spares-txt').textContent = '🔋 × ' + G.state.spares;
    document.getElementById('btn-swap').disabled = G.state.spares <= 0 || G.state.battery >= 100;
    document.getElementById('storage-txt').textContent = G.state.scans.length + ' / ' + (G.state.maxScans > 50 ? '∞' : G.state.maxScans);
    document.getElementById('weather-txt').textContent = '🌧 rain outside' + (G.prep.has('weather') ? ' · ☂ umbrella' : '');
    document.getElementById('scan-count').textContent = G.state.scans.length;
  },

  renderScanList() {
    const ul = document.getElementById('scan-list');
    ul.innerHTML = '';
    for (const s of G.state.scans) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot" style="background:${s.color}"></span>
        <span class="grow"><b>Scan ${s.id}</b> ${s.outside ? '🌧' : '🏭'}
        <span class="tag">${s.points.length} pts · ${s.tobs.length} target(s)</span></span>`;
      ul.appendChild(li);
    }
  },

  /* ---------- pointer: drag scanner with mouse ---------- */
  bindPointer() {
    if (this._bound) return;
    this._bound = true;
    const cv = this.canvas;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
    };
    cv.onmousedown = (e) => {
      if (this.anim || !G.prep.has('scanner')) return;
      const p = pos(e);
      this.dragging = true;
      this.scanner.x = p.x; this.scanner.y = p.y;
    };
    cv.onmousemove = (e) => {
      if (!this.dragging || this.anim) return;
      const p = pos(e);
      this.scanner.x = p.x; this.scanner.y = p.y;
    };
    window.addEventListener('mouseup', () => {
      if (!this.dragging) return;
      this.dragging = false;
      const err = this.canPlace(this.scanner.x, this.scanner.y);
      if (err) {
        G.toast('⛔ ' + err);
        this.scanner.x = this.lastValid.x; this.scanner.y = this.lastValid.y;
      } else {
        this.lastValid.x = this.scanner.x; this.lastValid.y = this.scanner.y;
      }
    });
    window.addEventListener('keydown', (e) => {
      if (G.state.screen === 'field' && e.code === 'Space') { e.preventDefault(); this.tryScan(); }
    });
  },

  /* ---------- drawing ---------- */
  draw(now) {
    const c = this.ctx, M = G.MAP;
    c.clearRect(0, 0, 960, 640);

    // floors
    c.fillStyle = '#1a2230';
    c.fillRect(M.world.x, M.world.y, M.world.w, M.world.h);
    c.fillStyle = '#151d29';
    c.fillRect(M.hall.x, M.hall.y, M.hall.w, M.hall.h);
    // grid
    c.strokeStyle = 'rgba(255,255,255,0.045)'; c.lineWidth = 1;
    for (let x = M.world.x; x <= M.world.x + M.world.w; x += 40) { c.beginPath(); c.moveTo(x, M.world.y); c.lineTo(x, M.world.y + M.world.h); c.stroke(); }
    for (let y = M.world.y; y <= M.world.y + M.world.h; y += 40) { c.beginPath(); c.moveTo(M.world.x, y); c.lineTo(M.world.x + M.world.w, y); c.stroke(); }

    // rain everywhere outside the hall roof
    c.strokeStyle = 'rgba(120,170,255,0.35)';
    for (const r of this.rain) {
      const yy = M.world.y + (r.y + now / 8 * r.v) % M.world.h;
      if (G.isInside(r.x, yy) || G.isInside(r.x - 3, yy + 9)) continue;
      c.beginPath(); c.moveTo(r.x, yy); c.lineTo(r.x - 3, yy + 9); c.stroke();
    }

    // hall label + door
    c.fillStyle = 'rgba(219,228,240,0.5)'; c.font = '13px sans-serif';
    c.fillText('INDUSTRIAL HALL (concrete)', M.hall.x + 12, M.hall.y + 20);
    c.fillStyle = 'rgba(120,170,255,0.8)';
    c.fillText('DOOR → outside 🌧', M.hall.door.x - 112, (M.hall.door.y1 + M.hall.door.y2) / 2 - 10);
    c.fillStyle = 'rgba(120,170,255,0.25)';
    c.fillRect(M.hall.door.x - 3, M.hall.door.y1, 6, M.hall.door.y2 - M.hall.door.y1);

    // pillars
    c.fillStyle = '#3d4a5c';
    for (const p of M.pillars) c.fillRect(p.x, p.y, p.w, p.h);
    // outside objects
    for (const o of M.outside) {
      c.fillStyle = '#46536b';
      c.fillRect(o.x, o.y, o.w, o.h);
      c.fillStyle = 'rgba(219,228,240,0.55)'; c.font = '11px sans-serif';
      c.fillText(o.label, o.x + 6, o.y + o.h / 2 + 4);
    }
    // compressor (vibrating machine — shakes nearby scans, no warning!)
    const m = M.machine, wob = Math.sin(now / 90) * 1.2;
    c.fillStyle = '#6b4a2f';
    c.fillRect(m.x + wob, m.y, m.w, m.h);
    c.fillStyle = 'rgba(255,180,80,0.9)'; c.font = '11px sans-serif';
    c.fillText('⚙ compressor', m.x - 8 + wob, m.y - 6);

    // walls (segments)
    c.lineCap = 'round';
    for (const s of this.segs) {
      if (s.kind === 'machine') continue;
      c.strokeStyle = s.kind === 'fence' ? '#5a6a80' : '#8fa3bd';
      c.lineWidth = s.kind === 'wall' ? 6 : s.kind === 'fence' ? 3 : 5;
      c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
    }

    // accumulated point clouds (shadows become visible as gaps — no explicit hint!)
    for (const sc of G.state.scans) {
      c.fillStyle = sc.color;
      c.globalAlpha = 0.55;
      for (const p of sc.points) { c.fillRect(p.x - 1, p.y - 1, 2, 2); }
      c.globalAlpha = 1;
    }

    // active scan animation: rotating sweep + points appearing + pulse ring
    if (this.anim) {
      const k = Math.min(1, (now - this.anim.start) / this.anim.dur);
      const sweep = k * Math.PI * 2;
      const sc = this.anim.scan, sx = sc.x, sy = sc.y;
      c.fillStyle = sc.color;
      for (const p of sc.points) {
        if (p.a <= sweep) c.fillRect(p.x - 1.4, p.y - 1.4, 2.8, 2.8);
      }
      c.strokeStyle = sc.color; c.lineWidth = 2;
      c.beginPath(); c.moveTo(sx, sy);
      c.lineTo(sx + Math.cos(sweep) * 60, sy + Math.sin(sweep) * 60); c.stroke();
      c.globalAlpha = 0.5 * (1 - k) + 0.1;
      c.beginPath(); c.arc(sx, sy, 20 + k * 90, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = '#fff'; c.font = 'bold 13px sans-serif';
      c.fillText('SCANNING ' + Math.round(k * 100) + '%', sx + 14, sy - 14);
      if (k >= 1) this.finishAnim();
    }

    // targets (total-station control points)
    for (const t of M.targets) {
      c.fillStyle = '#ffe066';
      c.beginPath();
      c.moveTo(t.x, t.y - 12); c.lineTo(t.x + 9, t.y - 4); c.lineTo(t.x, t.y + 4); c.lineTo(t.x - 9, t.y - 4);
      c.closePath(); c.fill();
      c.strokeStyle = '#0d1117'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(t.x, t.y + 4); c.lineTo(t.x, t.y + 14); c.stroke();
      c.fillStyle = '#ffe066'; c.font = 'bold 11px sans-serif';
      c.fillText(t.id, t.x + 6, t.y + 16);
    }

    // scanner (draggable); red ring while hovering an invalid spot
    const s = this.scanner;
    const bad = this.dragging && this.canPlace(s.x, s.y);
    const out = !G.isInside(s.x, s.y);
    if (out && G.prep.has('weather')) {                 // umbrella + its clamp
      c.fillStyle = 'rgba(120,170,255,0.18)';
      c.beginPath(); c.arc(s.x, s.y, 16, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(120,170,255,0.7)'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(s.x, s.y);
      c.lineTo(s.x + Math.cos(G.UMBRELLA.dir) * 18, s.y + Math.sin(G.UMBRELLA.dir) * 18); c.stroke();
    }
    c.strokeStyle = '#e8eef7'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x - 9, s.y + 14); c.stroke();
    c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + 9, s.y + 14); c.stroke();
    c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x, s.y + 15); c.stroke();
    c.fillStyle = this.anim ? '#ff6b6b' : '#48dbfb';
    c.beginPath(); c.arc(s.x, s.y, 7, 0, Math.PI * 2); c.fill();
    if (bad) {
      c.strokeStyle = '#ff6b6b'; c.lineWidth = 2;
      c.beginPath(); c.arc(s.x, s.y, 13, 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = '#062b36'; c.font = 'bold 9px sans-serif';
    c.fillText('S', s.x - 3, s.y + 3);
    c.fillStyle = 'rgba(232,238,247,0.75)'; c.font = '11px sans-serif';
    c.fillText('scanner (drag me)', s.x + 12, s.y + 18);
  },
};
