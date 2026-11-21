/* ============================================================
   field.js — Phase 2: top-view field work.
   Drag the scanner with the mouse, press SCAN.
   Raycast simulation: concrete structures cast "shadows",
   targets are only visible with line of sight, vibrating
   machines / rain outside make shaken (bad) scans.
   ============================================================ */
window.G = window.G || {};

G.field = {
  canvas: null, ctx: null,
  segs: null, cells: null,
  scanner: { x: 300, y: 250 },
  dragging: false,
  anim: null,          // active scan animation
  rain: [],

  enter() {
    G._fieldEntered = true;
    this.canvas = document.getElementById('field-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.segs = G.buildSegments();
    this.cells = G.buildCells(this.segs);

    // state reset for the field phase
    G.state.scans = [];
    G.state.battery = 100;                              // current battery %
    G.state.spares = G.prep.has('battery') ? 2 : 0;     // swappable spare batteries
    G.state.maxScans = G.prep.has('sdcard') ? 99 : 4;
    G.state.scanner = this.scanner;
    G.state.anim = null;
    this.anim = null;
    this.rain = Array.from({ length: 90 }, () => ({ x: 640 + Math.random() * 300, y: Math.random() * 640, v: 3 + Math.random() * 3 }));

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
      if (!G.prep.has('tripod')) G.toast('⚠ No tripod packed — handheld scans will be shaken!');
      if (!G.prep.has('ppe')) G.toast('⚠ No PPE packed — the door to outside is locked for you (site safety).');
      if (!G.prep.has('sdcard')) G.toast('⚠ No SD card — scanner memory holds only 4 scans!');
      if (!G.prep.has('battery')) G.toast('⚠ No spare batteries — 100% only, each scan uses 14%.');
      else G.toast('🔋 2 spare batteries packed — press "Swap spare battery" when the current one runs low.');
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
    for (const p of G.MAP.pillars) if (G.pointInRect(x, y, p, 14)) return 'Cannot set up inside a concrete pillar!';
    for (const o of G.MAP.outside) if (G.pointInRect(x, y, o, 14)) return 'Cannot set up inside an object!';
    const m = G.MAP.machine;
    if (G.pointInRect(x, y, m, 16)) return 'Cannot set up inside the compressor!';
    if (!G.prep.has('ppe') && x > G.MAP.hall.door.x - 6)
      return '🔒 Site safety: no PPE packed → no access outside the hall!';
    return null;
  },

  /* ---------- scanning ---------- */
  tryScan() {
    if (this.anim) return;
    if (G.state.scans.length >= G.state.maxScans) {
      G.toast('💾 Scanner storage full (' + G.state.maxScans + ' scans) — no SD card was packed!');
      return;
    }
    if (G.state.battery < 14) {
      G.toast('🔋 Battery empty — ' + (G.state.spares > 0 ? 'swap in a spare battery!' : 'no spare batteries were packed!'));
      return;
    }
    G.state.battery -= 14;

    const { x, y } = this.scanner;
    const shaken =
      !G.prep.has('tripod') ||
      G.dist(x, y, G.MAP.machine.x + G.MAP.machine.w / 2, G.MAP.machine.y + G.MAP.machine.h / 2) < G.MAP.machine.vibrR ||
      (x > G.MAP.hall.door.x && !G.prep.has('weather'));

    const scan = {
      id: G.state.scans.length + 1,
      x, y,
      points: this.raycast(x, y, shaken),
      targets: G.MAP.targets.filter(t => G.losClear(x, y, t.x, t.y, this.segs)).map(t => t.id),
      shaken,
      excluded: false,
      color: G.PALETTE[(G.state.scans.length) % G.PALETTE.length],
      off: { dx: 0, dy: 0, rot: 0 },
      locked: false,
      residual: null,
    };
    this.anim = { scan, start: performance.now(), dur: 1500, sweep: 0 };
    document.getElementById('scan-status').textContent = 'Scanning…';
    this.updateHud();
  },

  /* 360 rays, nearest hit per ray = one measured point */
  raycast(x, y, shaken) {
    const RANGE = 520, N = 360;
    const pts = [];
    const noise = shaken ? 3.2 : 1.1;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      let best = RANGE;
      for (const s of this.segs) {
        const t = G.raySeg(x, y, dx, dy, s);
        if (t !== null && t < best) best = t;
      }
      if (best >= RANGE) continue;
      const r = best + G.rnd(-noise, noise);
      pts.push({ x: x + dx * r, y: y + dy * r, a });
    }
    return pts;
  },

  finishAnim() {
    const scan = this.anim.scan;
    this.anim = null;
    G.state.scans.push(scan);
    document.getElementById('scan-status').textContent = '';
    G.field.computeStats();
    this.renderScanList();
    this.updateHud();
    if (scan.shaken) G.toast('Scan ' + scan.id + ' done — the point cloud looks a bit… shaky. 🤔');
    else G.toast('✔ Scan ' + scan.id + ' stored (' + scan.points.length + ' pts, targets: ' +
      (scan.targets.join(' ') || 'none') + ')');
  },

  /* coverage + cloud-to-cloud link graph over all scans */
  computeStats() {
    const scans = G.state.scans;
    const covered = new Set();
    const cellSets = scans.map(sc => {
      const set = new Set();
      for (const p of sc.points) {
        const cx = Math.round(p.x / 12), cy = Math.round(p.y / 12);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
          set.add((cx + i) + ',' + (cy + j));
      }
      for (const k of set) covered.add(k);
      return set;
    });
    // count only cells that actually exist on a surface (points mark 3x3 neighbourhoods)
    let covCount = 0;
    for (const k of covered) if (this.cells.has(k)) covCount++;
    G.state.coverage = covCount / this.cells.size;

    // link edges: two scans are cloud-to-cloud registrable only if their point
    // clouds cover ENOUGH of the SAME surfaces (exact shared cells, not just
    // grazing overlap): >= 25 shared cells AND >= 20% of the smaller cloud
    const exactSets = scans.map(sc => {
      const set = new Set();
      for (const p of sc.points) set.add(Math.round(p.x / 12) + ',' + Math.round(p.y / 12));
      return set;
    });
    G.state.linkEdges = [];
    for (let i = 0; i < scans.length; i++)
      for (let j = i + 1; j < scans.length; j++) {
        let common = 0;
        for (const k of exactSets[i]) if (exactSets[j].has(k)) common++;
        const minSize = Math.min(exactSets[i].size, exactSets[j].size);
        if (common >= 25 && common >= 0.20 * minSize)
          G.state.linkEdges.push({ a: scans[i].id, b: scans[j].id, common });
      }

    // is there a cloud-to-cloud chain linking INSIDE and OUTSIDE scans?
    const doorX = G.MAP.hall.door.x;
    const adj = new Map();
    for (const s of scans) adj.set(s.id, []);
    for (const e of G.state.linkEdges) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
    let bridge = false;
    const seen = new Set();
    for (const s of scans) {
      if (seen.has(s.id)) continue;
      const comp = [], stack = [s.id];
      seen.add(s.id);
      let hasIn = s.x < doorX, hasOut = s.x >= doorX;
      while (stack.length) {
        const id = stack.pop(); comp.push(id);
        for (const n of adj.get(id)) {
          if (seen.has(n)) continue;
          seen.add(n);
          const ns = scans.find(q => q.id === n);
          if (ns.x < doorX) hasIn = true; else hasOut = true;
          stack.push(n);
        }
      }
      if (hasIn && hasOut) bridge = true;
    }
    G.state.bridge = bridge;
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
    document.getElementById('weather-txt').textContent = '🌧 rain outside' + (G.prep.has('weather') ? ' (covered)' : '');
    document.getElementById('scan-count').textContent = G.state.scans.length;
  },

  renderScanList() {
    const ul = document.getElementById('scan-list');
    ul.innerHTML = '';
    for (const s of G.state.scans) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot" style="background:${s.color}"></span>
        <span class="grow"><b>Scan ${s.id}</b> @ (${Math.round(s.x)}, ${Math.round(s.y)})
        <span class="tag">${s.points.length} pts · targets: ${s.targets.join(' ') || '—'}</span></span>`;
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
      if (this.anim) return;
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
        this.scanner.x = G.clamp(this.scanner.x, G.MAP.world.x + 12, G.MAP.world.x + G.MAP.world.w - 12);
        this.scanner.y = G.clamp(this.scanner.y, G.MAP.world.y + 12, G.MAP.world.y + G.MAP.world.h - 12);
        if (!G.prep.has('ppe')) this.scanner.x = Math.min(this.scanner.x, G.MAP.hall.door.x - 10);
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

    // rain outside
    c.strokeStyle = 'rgba(120,170,255,0.35)';
    for (const r of this.rain) {
      const yy = (r.y + now / 8 * r.v) % 640;
      c.beginPath(); c.moveTo(r.x, yy); c.lineTo(r.x - 3, yy + 9); c.stroke();
    }

    // hall label + door
    c.fillStyle = 'rgba(219,228,240,0.5)'; c.font = '13px sans-serif';
    c.fillText('INDUSTRIAL HALL (concrete)', M.hall.x + 12, M.hall.y + 20);
    c.fillStyle = 'rgba(120,170,255,0.8)';
    c.fillText('DOOR → outside 🌧', M.hall.door.x - 92, (M.hall.door.y1 + M.hall.door.y2) / 2 - 10);
    c.fillStyle = 'rgba(120,170,255,0.25)';
    c.fillRect(M.hall.door.x - 3, M.hall.door.y1, 6, M.hall.door.y2 - M.hall.door.y1);

    // pillars
    c.fillStyle = '#3d4a5c';
    for (const p of M.pillars) c.fillRect(p.x, p.y, p.w, p.h);
    // outside objects
    c.fillStyle = '#46536b';
    for (const o of M.outside) {
      c.fillRect(o.x, o.y, o.w, o.h);
      c.fillStyle = 'rgba(219,228,240,0.55)'; c.font = '11px sans-serif';
      c.fillText(o.label, o.x + 6, o.y + o.h / 2 + 4);
      c.fillStyle = '#46536b';
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
      c.strokeStyle = s.kind === 'wall' ? '#8fa3bd' : '#8fa3bd';
      c.lineWidth = s.kind === 'wall' ? 6 : 5;
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

    // scanner (draggable)
    const s = this.scanner;
    c.strokeStyle = '#e8eef7'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x - 9, s.y + 14); c.stroke();
    c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + 9, s.y + 14); c.stroke();
    c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x, s.y + 15); c.stroke();
    c.fillStyle = this.anim ? '#ff6b6b' : '#48dbfb';
    c.beginPath(); c.arc(s.x, s.y, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#062b36'; c.font = 'bold 9px sans-serif';
    c.fillText('S', s.x - 3, s.y + 3);
    c.fillStyle = 'rgba(232,238,247,0.75)'; c.font = '11px sans-serif';
    c.fillText('scanner (drag me)', s.x + 12, s.y + 18);
  },
};
