/* ============================================================
   register.js — Phase 3: registration as in real software.

   Every scan arrives in its own (wrong) position. The targets
   the scanner recognised travel WITH the scan cloud. You:
     • name the targets in each scan (T1…T6) → each name ties
       that scan to the surveyed control point of that name
       (and, through it, to every other scan that saw it)
     • add cloud-to-cloud (ICP) links between overlapping scans —
       cross-linking gives redundancy. ICP only converges when
       the pair is already roughly aligned.
     • run the least-squares adjustment → every constraint gets
       an error. A wrongly named target pulls its scan to the
       wrong place: with redundancy (cross links) it shows up as
       a red error, in a plain chain it stays INVISIBLE.
     • disable / fix bad constraints, exclude bad scans, re-run.
   ============================================================ */
window.G = window.G || {};

const MM = () => G.MM_PER_PX;

G.register = {
  canvas: null, ctx: null,
  selected: null,
  links: [],            // cloud-to-cloud links {key,a,b,pts:[{q,delta}],icpRms,converged}
  disabled: new Set(),  // keys of disabled constraints
  solution: null,       // result of the last adjustment
  stale: true,          // something changed since the last adjustment
  anim: null,
  drag: null,
  inlineChooser: null,

  enter() {
    G._regEntered = true;
    G.state.results = null;
    this.canvas = document.getElementById('reg-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.links = [];
    this.disabled = new Set();
    this.solution = null;
    this.stale = true;
    this.anim = null;
    this.drag = null;
    this.inlineChooser = null;

    // every scan arrives in its own frame: shifted and rotated. Scan 1 defines
    // the project frame until control points are used.
    G.state.scans.forEach((s, i) => {
      s.off = i === 0 ? { dx: 0, dy: 0, rot: 0 }
                      : { dx: G.rnd(-55, 55), dy: G.rnd(-55, 55), rot: G.rnd(-0.22, 0.22) };
      s.names = {};        // true target id → name given by the player
      s.excluded = false;
    });
    this.selected = G.state.scans[0] ? G.state.scans[0].id : null;

    document.getElementById('btn-solve').onclick = () => this.solve(true);
    document.getElementById('btn-to-report').onclick = () => {
      if (!this.solution || this.stale) { G.toast('Run the registration first (it is out of date).'); return; }
      this.finish();
      G.report.enter();
      G.showScreen('report');
    };
    this.hidePopup();
    this.bindPointer();
    this.render();
  },

  /* ---------- geometry ---------- */
  scanById(id) { return G.state.scans.find(s => s.id === id); },
  active() { return G.state.scans.filter(s => !s.excluded); },
  xf(s, p, off = s.off) {
    const c = Math.cos(off.rot), sn = Math.sin(off.rot);
    const px = p.x - s.x, py = p.y - s.y;
    return { x: s.x + px * c - py * sn + off.dx, y: s.y + px * sn + py * c + off.dy };
  },
  control(name) { return G.MAP.targets.find(t => t.id === name); },
  markStale() { this.stale = true; },

  /* ---------- constraints ---------- */
  // target constraints are derived from the names given in each scan
  buildConstraints() {
    const act = this.active();
    const named = [];
    for (const s of act) for (const o of s.tobs) {
      const name = s.names[o.tid];
      if (name) named.push({ s, o, name });
    }
    const enabledNamed = named.filter(n => !this.disabled.has('t:' + n.s.id + ':' + n.o.tid));
    const georef = new Set(enabledNamed.map(n => n.name)).size >= 2;

    const cons = named.map(n => ({
      key: 't:' + n.s.id + ':' + n.o.tid, type: 'target',
      a: n.s.id, name: n.name, tid: n.o.tid, obs: n.o,
      enabled: !this.disabled.has('t:' + n.s.id + ':' + n.o.tid),
    }));
    const links = this.links
      .filter(l => !this.scanById(l.a).excluded && !this.scanById(l.b).excluded)
      .map(l => ({ ...l, type: 'c2c', enabled: !this.disabled.has(l.key) }));
    return { cons: cons.concat(links), georef };
  },

  // turn constraints into 2-D point equations  r = xf_a(p) − (xf_b(q) | target) − delta
  equations(cons, georef) {
    const eqs = [];
    const W_T = 1 / (0.05 ** 2), W_C = 1 / (0.04 ** 2);
    const firstObs = new Map();
    for (const c of cons) {
      if (!c.enabled) continue;
      if (c.type === 'target') {
        if (georef) {
          const t = this.control(c.name);
          eqs.push({ c, a: c.a, p: c.obs, b: null, target: { x: t.x, y: t.y }, delta: { x: 0, y: 0 }, w: W_T });
        } else {
          // no control frame → equal names only tie scans to each other
          const f = firstObs.get(c.name);
          if (!f) firstObs.set(c.name, c);
          else eqs.push({ c, a: c.a, p: c.obs, b: f.a, q: f.obs, delta: { x: 0, y: 0 }, w: W_T });
        }
      } else {
        for (const pt of c.pts) eqs.push({ c, a: c.a, p: pt.q, b: c.b, q: pt.q, delta: pt.delta, w: W_C });
      }
    }
    return eqs;
  },

  // which scans are tied (directly or indirectly) to the datum
  connectivity(cons, georef, datum) {
    const adj = new Map(this.active().map(s => [s.id, new Set()]));
    adj.set('CTRL', new Set());
    const firstByName = new Map();
    for (const c of cons) {
      if (!c.enabled) continue;
      if (c.type === 'c2c') { adj.get(c.a).add(c.b); adj.get(c.b).add(c.a); }
      else if (georef) { adj.get(c.a).add('CTRL'); adj.get('CTRL').add(c.a); }
      else {
        const f = firstByName.get(c.name);
        if (f == null) firstByName.set(c.name, c.a);
        else { adj.get(c.a).add(f); adj.get(f).add(c.a); }
      }
    }
    const start = georef ? 'CTRL' : datum;
    const seen = new Set([start]), st = [start];
    while (st.length) { const n = st.pop(); for (const m of adj.get(n) || []) if (!seen.has(m)) { seen.add(m); st.push(m); } }
    return seen;
  },

  /* ---------- least-squares adjustment (Gauss–Newton) ---------- */
  solve(animate) {
    if (this.anim) return;
    const act = this.active();
    if (!act.length) { G.toast('All scans are excluded.'); return; }
    const { cons, georef } = this.buildConstraints();
    const datum = georef ? null : act[0].id;
    const reach = this.connectivity(cons, georef, datum);
    const unknown = act.filter(s => s.id !== datum && reach.has(s.id));
    const idx = new Map(unknown.map((s, i) => [s.id, i * 3]));
    const eqs = this.equations(cons, georef).filter(e => reach.has(e.a) && (e.b == null || reach.has(e.b)));

    const before = new Map(act.map(s => [s.id, { ...s.off }]));
    const pose = new Map(act.map(s => [s.id, { ...s.off }]));
    const n = unknown.length * 3;
    for (let it = 0; it < 40 && n; it++) {
      const N = Array.from({ length: n }, () => new Float64Array(n));
      const b = new Float64Array(n);
      for (const e of eqs) {
        const sa = this.scanById(e.a), pa = this.xf(sa, e.p, pose.get(e.a));
        let rx = pa.x - e.delta.x, ry = pa.y - e.delta.y, sb = null;
        if (e.b == null) { rx -= e.target.x; ry -= e.target.y; }
        else { sb = this.scanById(e.b); const pb = this.xf(sb, e.q, pose.get(e.b)); rx -= pb.x; ry -= pb.y; }
        const blocks = [];
        const jac = (s, p, off, sign) => {
          const c = Math.cos(off.rot), sn = Math.sin(off.rot), px = p.x - s.x, py = p.y - s.y;
          return [[sign, 0, sign * -(px * sn + py * c)], [0, sign, sign * (px * c - py * sn)]];
        };
        if (idx.has(e.a)) blocks.push([idx.get(e.a), jac(sa, e.p, pose.get(e.a), 1)]);
        if (sb && idx.has(e.b)) blocks.push([idx.get(e.b), jac(sb, e.q, pose.get(e.b), -1)]);
        for (const [i0, Ji] of blocks) {
          for (let r = 0; r < 3; r++) b[i0 + r] -= e.w * (Ji[0][r] * rx + Ji[1][r] * ry);
          for (const [j0, Jj] of blocks)
            for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++)
              N[i0 + r][j0 + q] += e.w * (Ji[0][r] * Jj[0][q] + Ji[1][r] * Jj[1][q]);
        }
      }
      // light damping keeps under-determined unknowns where they are
      for (let i = 0; i < n; i++) N[i][i] += (i % 3 === 2 ? 50 : 1e-3) + N[i][i] * 1e-6;
      const x = G.solveLinear(N, b);
      let step = 0;
      for (const s of unknown) {
        const i0 = idx.get(s.id), o = pose.get(s.id);
        o.dx += x[i0]; o.dy += x[i0 + 1]; o.rot += G.clamp(x[i0 + 2], -0.6, 0.6);
        step = Math.max(step, Math.abs(x[i0]), Math.abs(x[i0 + 1]), Math.abs(x[i0 + 2]) * 300);
      }
      if (step < 1e-5) break;
    }

    // per-constraint errors (mm) at the solution
    const err = (e) => {
      const sa = this.scanById(e.a), pa = this.xf(sa, e.p, pose.get(e.a));
      const t = e.b == null ? e.target : this.xf(this.scanById(e.b), e.q, pose.get(e.b));
      return Math.hypot(pa.x - e.delta.x - t.x, pa.y - e.delta.y - t.y) * MM();
    };
    const acc = new Map();
    for (const e of eqs) { const a = acc.get(e.c.key) || []; a.push(err(e)); acc.set(e.c.key, a); }
    for (const c of cons) {
      const a = acc.get(c.key);
      c.error = a ? Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length) : null;
    }

    // per-scan degrees of constraint (target = 2, c2c link = 3)
    const dims = new Map(act.map(s => [s.id, 0]));
    const counted = new Set();
    for (const c of cons) if (c.enabled) {
      if (c.type === 'c2c') { dims.set(c.a, dims.get(c.a) + 3); dims.set(c.b, dims.get(c.b) + 3); }
      else if (georef || counted.has(c.name)) dims.set(c.a, dims.get(c.a) + 2);
      if (!georef && c.type === 'target') counted.add(c.name);
    }
    const nEq = cons.filter(c => c.enabled && c.error != null).reduce((s, c) => s + (c.type === 'c2c' ? 3 : 2), 0);
    const redundancy = nEq - unknown.length * 3;

    this.solution = {
      cons, georef, datum, reach, dims, redundancy,
      status: new Map(act.map(s => [s.id,
        !reach.has(s.id) ? 'free' : (s.id === datum ? 'datum' : (dims.get(s.id) < 3 ? 'weak' : 'ok'))])),
    };
    this.stale = false;

    if (animate) {
      this.anim = { start: performance.now(), dur: 900, from: before, to: pose };
      document.getElementById('reg-status').textContent = '⚙ Adjusting…';
    } else {
      for (const s of act) s.off = pose.get(s.id);
    }
    this.render();
  },

  /* ---------- cloud-to-cloud link (ICP from the CURRENT positions) ---------- */
  addLink(aId, bId) {
    const a = this.scanById(Math.min(aId, bId)), b = this.scanById(Math.max(aId, bId));
    const edge = G.state.linkEdges.find(e => e.a === a.id && e.b === b.id);
    if (!edge) return;
    let mis = 0;
    const raw = edge.samples.map(q => {
      const pa = this.xf(a, q), pb = this.xf(b, q);
      const m = { x: pa.x - pb.x, y: pa.y - pb.y };
      mis += Math.hypot(m.x, m.y) / edge.samples.length;
      return { q, m };
    });
    const drot = Math.abs(a.off.rot - b.off.rot);
    if (mis > 60 || drot > 0.25) {          // > 3 m apart: ICP finds nothing to match
      G.toast('⛔ ICP did not converge (' + a.id + '↔' + b.id + ' are ~' + (mis * MM() / 1000).toFixed(1) +
        ' m apart) — drag/rotate the clouds roughly onto each other first, or register by targets.');
      return;
    }
    const converged = mis < 16 && drot < 0.08;
    const sig = (a.bad || b.bad) ? 0.25 : 0.03;
    const pts = raw.map(({ q, m }) => ({
      q,
      // ICP stuck in a local minimum "freezes" most of the current misfit
      delta: { x: (converged ? 0 : 0.7 * m.x) + G.rnd(-sig, sig), y: (converged ? 0 : 0.7 * m.y) + G.rnd(-sig, sig) },
    }));
    const icpRms = converged ? (G.rnd(1, 2.5) + ((a.bad || b.bad) ? G.rnd(8, 14) : 0)) : mis * 0.3 * MM();
    this.links.push({ key: 'c:' + a.id + ':' + b.id, a: a.id, b: b.id, pts, icpRms, converged, common: edge.common });
    this.markStale();
    G.toast('🔗 Cloud-to-cloud link ' + a.id + '↔' + b.id + ' — ICP RMS ' + icpRms.toFixed(1) + ' mm' +
      (icpRms > 15 ? '  ⚠ high: were the clouds aligned first?' : ''));
    this.render();
  },
  removeLink(key) {
    this.links = this.links.filter(l => l.key !== key);
    this.disabled.delete(key);
    this.markStale();
    this.render();
  },

  /* ---------- target naming ---------- */
  setName(s, tid, name) {
    if (name) for (const k of Object.keys(s.names)) if (s.names[k] === name) delete s.names[k];
    if (name) s.names[tid] = name; else delete s.names[tid];
    this.disabled.delete('t:' + s.id + ':' + tid);
    this.markStale();
    this.hidePopup();
    this.render();
  },

  showPopup(s, o, cx, cy) {
    if (!G.prep.has('targets')) { G.toast('🏷 No target ID plates were packed — the targets cannot be identified.'); return; }
    const pop = document.getElementById('id-popup');
    document.getElementById('id-popup-target').textContent = 'in scan ' + s.id;
    const wrap = document.getElementById('id-popup-buttons');
    wrap.innerHTML = '';
    for (const t of G.MAP.targets) {
      const b = document.createElement('button');
      b.textContent = t.id;
      if (s.names[o.tid] === t.id) b.classList.add('current');
      b.onclick = () => this.setName(s, o.tid, t.id);
      wrap.appendChild(b);
    }
    const clr = document.createElement('button');
    clr.textContent = '✕'; clr.title = 'clear name';
    clr.onclick = () => this.setName(s, o.tid, null);
    wrap.appendChild(clr);
    const r = this.canvas.getBoundingClientRect(), k = r.width / this.canvas.width;
    pop.style.left = Math.min(r.width - 300, cx * k + 12) + 'px';
    pop.style.top = Math.max(4, cy * k - 20) + 'px';
    pop.classList.remove('hidden');
  },
  hidePopup() { document.getElementById('id-popup').classList.add('hidden'); },

  /* ---------- pointer ---------- */
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
      this.hidePopup();
      // 1) a recognised target (selected scan first)
      const order = this.active().sort((a, b) => (b.id === this.selected) - (a.id === this.selected));
      for (const s of order) for (const o of s.tobs) {
        const w = this.xf(s, o);
        if (G.dist(p.x, p.y, w.x, w.y - 4) < 11) {
          this.selected = s.id; this.render();
          this.showPopup(s, o, w.x, w.y);
          return;
        }
      }
      // 2) a station marker → select that scan
      for (const s of this.active()) {
        const w = this.xf(s, s);
        if (G.dist(p.x, p.y, w.x, w.y) < 11) { this.selected = s.id; this.render(); return; }
      }
      // 3) drag the selected scan
      const sel = this.selected != null ? this.scanById(this.selected) : null;
      if (sel && !sel.excluded) this.drag = { s: sel, gx: p.x - sel.off.dx, gy: p.y - sel.off.dy };
    };
    cv.onmousemove = (e) => {
      if (!this.drag || this.anim) return;
      const p = pos(e);
      this.drag.s.off.dx = p.x - this.drag.gx;
      this.drag.s.off.dy = p.y - this.drag.gy;
      if (!this.stale) { this.markStale(); this.renderSummary(); }
    };
    window.addEventListener('mouseup', () => { this.drag = null; });
    cv.addEventListener('wheel', (e) => {
      if (G.state.screen !== 'register') return;
      e.preventDefault();
      this.rotateSelected(Math.sign(e.deltaY) * 0.01);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (G.state.screen !== 'register') return;
      if (e.key === 'q' || e.key === 'Q') this.rotateSelected(-0.01);
      if (e.key === 'e' || e.key === 'E') this.rotateSelected(0.01);
    });
  },
  rotateSelected(d) {
    const s = this.selected != null ? this.scanById(this.selected) : null;
    if (!s || s.excluded || this.anim) return;
    s.off.rot += d;
    if (!this.stale) { this.markStale(); this.renderSummary(); }
  },

  /* ---------- side panel ---------- */
  render() {
    this.renderScanList();
    this.renderCard();
    this.renderSummary();
    this.renderConstraints();
  },

  statusChip(s) {
    if (s.excluded) return '<span class="chip dim">excluded</span>';
    if (!this.solution) return '';
    const st = this.solution.status.get(s.id);
    return st === 'ok' ? '<span class="chip ok">registered</span>'
         : st === 'datum' ? '<span class="chip ok">datum</span>'
         : st === 'weak' ? '<span class="chip warn">under-constrained</span>'
         : '<span class="chip bad">not connected</span>';
  },

  renderScanList() {
    const ul = document.getElementById('reg-scan-list');
    ul.innerHTML = '';
    for (const s of G.state.scans) {
      const li = document.createElement('li');
      li.className = (s.id === this.selected ? 'selected ' : '') + (s.excluded ? 'excluded' : '');
      const names = s.tobs.map(o => s.names[o.tid] || '?').join(' ') || '—';
      li.innerHTML = `<span class="dot" style="background:${s.color}"></span>
        <span class="grow"><b>Scan ${s.id}</b> <span class="tag">targets: ${names}</span> ${this.statusChip(s)}</span>`;
      const lab = document.createElement('label');
      lab.title = 'Exclude a bad scan from the registration';
      lab.innerHTML = `<input type="checkbox" ${s.excluded ? 'checked' : ''}> bad`;
      lab.onclick = (e) => e.stopPropagation();
      lab.querySelector('input').onchange = (e) => {
        s.excluded = e.target.checked;
        this.markStale(); this.render();
      };
      li.appendChild(lab);
      li.onclick = () => { this.selected = s.id; this.hidePopup(); this.render(); };
      ul.appendChild(li);
    }
  },

  renderCard() {
    const el = document.getElementById('reg-card');
    const s = this.selected != null ? this.scanById(this.selected) : null;
    if (!s) { el.innerHTML = ''; return; }
    if (s.excluded) { el.innerHTML = `<b>Scan ${s.id}</b> is excluded.`; return; }
    el.innerHTML = '';

    const h = document.createElement('div');
    h.innerHTML = `<b style="color:${s.color}">Scan ${s.id}</b> <span class="tag">drag on canvas · wheel or Q/E rotates</span>`;
    el.appendChild(h);

    // targets recognised in this scan
    const tt = document.createElement('div');
    tt.className = 'card-row';
    tt.innerHTML = '<span class="lbl">Targets</span>';
    if (!s.tobs.length) tt.innerHTML += '<span class="tag">none recognised</span>';
    s.tobs.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'chip-btn' + (s.names[o.tid] ? '' : ' unnamed');
      b.textContent = (i + 1) + ': ' + (s.names[o.tid] || '?');
      b.title = 'Name this target';
      b.onclick = () => {
        if (!G.prep.has('targets')) { G.toast('🏷 No target ID plates were packed — the targets cannot be identified.'); return; }
        const w = this.xf(s, o); this.showPopup(s, o, w.x, w.y);
      };
      tt.appendChild(b);
    });
    el.appendChild(tt);

    // cloud-to-cloud partners
    const partners = G.state.linkEdges.filter(e => e.a === s.id || e.b === s.id)
      .map(e => ({ e, other: this.scanById(e.a === s.id ? e.b : e.a) }))
      .filter(x => !x.other.excluded);
    const cc = document.createElement('div');
    cc.className = 'card-col';
    cc.innerHTML = '<span class="lbl">Cloud-to-cloud</span>' +
      (partners.length ? '' : '<span class="tag">no overlapping scan — cannot link by clouds</span>');
    for (const { e, other } of partners) {
      const key = 'c:' + e.a + ':' + e.b;
      const link = this.links.find(l => l.key === key);
      const row = document.createElement('div');
      row.className = 'link-row';
      row.innerHTML = `<span class="dot" style="background:${other.color}"></span><span class="grow">Scan ${other.id} <span class="tag">${e.common} shared cells</span>` +
        (link ? ` <span class="chip ${link.icpRms > 15 ? 'bad' : 'ok'}">ICP ${link.icpRms.toFixed(1)} mm</span>` : '') + '</span>';
      const b = document.createElement('button');
      b.className = 'mini';
      b.textContent = link ? 'remove' : '+ link';
      b.onclick = () => link ? this.removeLink(key) : this.addLink(s.id, other.id);
      row.appendChild(b);
      cc.appendChild(row);
    }
    el.appendChild(cc);
  },

  renderSummary() {
    const el = document.getElementById('reg-summary');
    const fin = document.getElementById('btn-to-report');
    const S = this.solution;
    if (!S) {
      el.innerHTML = 'Not adjusted yet. Name targets and/or add cloud-to-cloud links, then <b>Run registration</b>.';
      fin.disabled = true;
      return;
    }
    const en = S.cons.filter(c => c.enabled && c.error != null);
    const rms = en.length ? Math.sqrt(en.reduce((a, c) => a + c.error ** 2, 0) / en.length) : 0;
    const maxE = en.reduce((a, c) => Math.max(a, c.error), 0);
    const free = [...S.status.values()].filter(v => v === 'free').length;
    const weak = [...S.status.values()].filter(v => v === 'weak').length;
    el.innerHTML =
      (this.stale ? '<span style="color:var(--warn)">⚠ Changed since the last run — run again.</span><br>' : '') +
      (S.georef ? '📍 Tied to control points (georeferenced)' : '📍 Local frame of scan ' + S.datum + ' — fewer than 2 control points named') + '<br>' +
      `Error RMS <b>${rms.toFixed(1)} mm</b> · max <b class="${maxE > 15 ? 'bad' : ''}">${maxE.toFixed(1)} mm</b><br>` +
      `Redundancy <b>${S.redundancy}</b>` + (S.redundancy <= 0 ? ' — <span style="color:var(--warn)">nothing is checked twice: errors stay hidden!</span>' : '') +
      (free ? `<br><span style="color:var(--bad)">${free} scan(s) not connected</span>` : '') +
      (weak ? `<br><span style="color:var(--warn)">${weak} scan(s) under-constrained</span>` : '');
    fin.disabled = this.stale;
  },

  renderConstraints() {
    const tb = document.getElementById('reg-cons');
    tb.innerHTML = '';
    const { cons } = this.solution && !this.stale ? this.solution : this.buildConstraints();
    if (!cons.length) { tb.innerHTML = '<tr><td class="tag">No constraints yet.</td></tr>'; return; }
    const sorted = cons.slice().sort((a, b) => (b.error ?? -1) - (a.error ?? -1));
    for (const c of sorted) {
      const tr = document.createElement('tr');
      if (!c.enabled) tr.className = 'off';
      const desc = c.type === 'c2c'
        ? `☁ Scan ${c.a} ↔ ${c.b}`
        : `◆ Scan ${c.a} · ${c.name}`;
      const e = c.error;
      const cls = e == null ? '' : e > 15 ? 'bad' : e > 6 ? 'warn' : 'ok';
      tr.innerHTML = `<td><input type="checkbox" ${c.enabled ? 'checked' : ''} title="use this constraint"></td>
        <td>${desc}</td><td class="${cls}">${e == null ? '—' : e.toFixed(1) + ' mm'}</td>`;
      tr.querySelector('input').onchange = (ev) => {
        if (ev.target.checked) this.disabled.delete(c.key); else this.disabled.add(c.key);
        this.markStale(); this.render();
      };
      tr.onclick = (ev) => { if (ev.target.tagName !== 'INPUT') { this.selected = c.a; this.render(); } };
      tb.appendChild(tr);
    }
  },

  /* ---------- final results (true errors are revealed in the report) ---------- */
  finish() {
    const S = this.solution;
    const reg = this.active().filter(s => S.status.get(s.id) !== 'free');
    const datumScan = S.datum != null ? this.scanById(S.datum) : null;
    // true error of a scan: where its points end up vs where they really are
    // (in the local case the datum's own placement defines the frame)
    const trueErr = (s) => {
      let sum = 0, n = 0;
      for (let i = 0; i < s.points.length; i += 8) {
        const p = s.points[i];
        if (p.ghost) continue;
        let w = this.xf(s, p);
        if (datumScan) {      // undo the datum transform
          const o = datumScan.off, c = Math.cos(-o.rot), sn = Math.sin(-o.rot);
          const px = w.x - o.dx - datumScan.x, py = w.y - o.dy - datumScan.y;
          w = { x: datumScan.x + px * c - py * sn, y: datumScan.y + px * sn + py * c };
        }
        sum += Math.hypot(w.x - p.x, w.y - p.y); n++;
      }
      return (n ? sum / n : 0) * MM() + (s.bad ? 12 + (s.id % 5) * 2 : 0);   // shaken/wet cloud itself is fuzzy
    };
    const perScan = G.state.scans.map(s => {
      const st = s.excluded ? 'excluded' : S.status.get(s.id);
      const mine = S.cons.filter(c => c.enabled && c.error != null && (c.a === s.id || c.b === s.id));
      return {
        id: s.id, status: st, bad: s.bad, issues: s.issues, outside: s.outside,
        reported: mine.length ? Math.max(...mine.map(c => c.error)) : null,
        trueErr: st === 'excluded' || st === 'free' ? null : trueErr(s),
        dims: S.dims.get(s.id) || 0,
      };
    });
    const regRows = perScan.filter(r => r.trueErr != null);
    const names = [];
    for (const s of this.active()) for (const o of s.tobs) if (s.names[o.tid])
      names.push({ scan: s.id, tid: o.tid, name: s.names[o.tid], ok: s.names[o.tid] === o.tid });
    const en = S.cons.filter(c => c.enabled && c.error != null);
    const scans = G.state.scans;

    G.state.results = {
      georef: S.georef, redundancy: S.redundancy,
      constraints: S.cons.map(c => ({ type: c.type, a: c.a, b: c.b, name: c.name, tid: c.tid, enabled: c.enabled, error: c.error, icpRms: c.icpRms })),
      perScan,
      // only data meeting the customer's accuracy requirement counts as coverage
      coverage: G.field.coverageOf(reg.filter(s => { const r = perScan.find(q => q.id === s.id); return r.trueErr != null && r.trueErr <= G.SPEC_MM; })),
      coverageAll: G.field.coverageOf(reg),
      nScans: scans.length, nRegistered: regRows.length,
      reportedRms: en.length ? Math.sqrt(en.reduce((a, c) => a + c.error ** 2, 0) / en.length) : 0,
      meanTrue: regRows.length ? regRows.reduce((a, r) => a + r.trueErr, 0) / regRows.length : 0,
      maxTrue: regRows.reduce((a, r) => Math.max(a, r.trueErr), 0),
      nOutOfSpec: regRows.filter(r => r.trueErr > G.SPEC_MM).length,
      names, namesWrong: names.filter(n => !n.ok).length,
      crossChecked: regRows.filter(r => r.dims >= 6 || r.status === 'datum' && r.dims >= 3).length,
      nBad: scans.filter(s => s.bad).length,
      badExcluded: scans.filter(s => s.bad && s.excluded).length,
      goodExcluded: scans.filter(s => !s.bad && s.excluded).length,
      notConnected: perScan.filter(r => r.status === 'free').length,
      yard: reg.some(s => s.outside) && reg.some(s => !s.outside),
      ghostPts: reg.reduce((a, s) => a + s.points.filter(p => p.ghost).length, 0),
    };
  },

  /* ---------- drawing ---------- */
  draw(now) {
    const c = this.ctx;
    c.fillStyle = '#0a0e13'; c.fillRect(0, 0, 960, 640);

    // adjustment animation
    if (this.anim) {
      const k = G.ease(Math.min(1, (now - this.anim.start) / this.anim.dur));
      for (const s of this.active()) {
        const a = this.anim.from.get(s.id), b = this.anim.to.get(s.id);
        if (a && b) s.off = { dx: G.lerp(a.dx, b.dx, k), dy: G.lerp(a.dy, b.dy, k), rot: G.lerp(a.rot, b.rot, k) };
      }
      if (k >= 1) {
        this.anim = null;
        document.getElementById('reg-status').textContent = '✔ Adjustment done — check the errors.';
      }
    }

    const sel = this.selected != null ? this.scanById(this.selected) : null;
    const act = this.active();

    // control points from the total-station crew (known coordinates)
    for (const t of G.MAP.targets) {
      c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(t.x - 7, t.y); c.lineTo(t.x + 7, t.y); c.moveTo(t.x, t.y - 7); c.lineTo(t.x, t.y + 7); c.stroke();
      c.beginPath(); c.arc(t.x, t.y, 4, 0, Math.PI * 2); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.8)'; c.font = 'bold 11px sans-serif';
      c.fillText(t.id, t.x + 8, t.y - 6);
    }

    // point clouds: others faint, selected bright on top
    const drawCloud = (s, alpha, size) => {
      const cs = Math.cos(s.off.rot), sn = Math.sin(s.off.rot);
      c.fillStyle = s.color; c.globalAlpha = alpha;
      for (const p of s.points) {
        const px = p.x - s.x, py = p.y - s.y;
        c.fillRect(s.x + px * cs - py * sn + s.off.dx - size / 2, s.y + px * sn + py * cs + s.off.dy - size / 2, size, size);
      }
      c.globalAlpha = 1;
    };
    for (const s of act) if (s !== sel) drawCloud(s, 0.38, 1.7);
    if (sel && !sel.excluded) drawCloud(sel, 0.95, 2.4);

    // cloud-to-cloud links
    const S = this.solution && !this.stale ? this.solution : null;
    for (const l of this.links) {
      const a = this.scanById(l.a), b = this.scanById(l.b);
      if (a.excluded || b.excluded) continue;
      const pa = this.xf(a, a), pb = this.xf(b, b);
      const cc = S && S.cons.find(x => x.key === l.key);
      const e = cc ? cc.error : null;
      c.strokeStyle = this.disabled.has(l.key) ? 'rgba(139,152,171,0.35)'
        : e == null ? 'rgba(72,219,251,0.6)' : e > 15 ? '#ff6b6b' : e > 6 ? '#feca57' : '#1dd1a1';
      c.lineWidth = 2; c.setLineDash(e == null ? [5, 4] : []);
      c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
      c.setLineDash([]);
    }

    // recognised targets travel with their scan; name or "?"
    for (const s of act) {
      const isSel = s === sel;
      for (const o of s.tobs) {
        const w = this.xf(s, o), name = s.names[o.tid];
        // after an adjustment: show the pull towards the named control point
        if (S && name && S.georef) {
          const cc = S.cons.find(x => x.key === 't:' + s.id + ':' + o.tid);
          const t = this.control(name);
          if (cc && cc.enabled && cc.error > 6) {
            c.strokeStyle = cc.error > 15 ? '#ff6b6b' : '#feca57'; c.lineWidth = 1.5; c.setLineDash([3, 3]);
            c.beginPath(); c.moveTo(w.x, w.y - 4); c.lineTo(t.x, t.y); c.stroke(); c.setLineDash([]);
          }
        }
        const r = isSel ? 8 : 5.5;
        c.fillStyle = name ? '#ffe066' : (isSel ? '#ff9f43' : 'rgba(255,159,67,0.7)');
        c.beginPath();
        c.moveTo(w.x, w.y - 4 - r); c.lineTo(w.x + r, w.y - 4); c.lineTo(w.x, w.y - 4 + r); c.lineTo(w.x - r, w.y - 4);
        c.closePath(); c.fill();
        c.strokeStyle = s.color; c.lineWidth = isSel ? 2 : 1; c.stroke();
        if (isSel || name) {
          c.fillStyle = name ? '#ffe066' : '#ff9f43'; c.font = (isSel ? 'bold 12px' : '10px') + ' sans-serif';
          c.fillText(name || '?', w.x + r + 2, w.y + 8);
        }
        if (isSel && !name) {
          c.strokeStyle = 'rgba(255,159,67,' + (0.45 + 0.4 * Math.sin(now / 200)) + ')'; c.lineWidth = 2;
          c.beginPath(); c.arc(w.x, w.y - 4, 14, 0, Math.PI * 2); c.stroke();
        }
      }
    }

    // station markers
    for (const s of act) {
      const w = this.xf(s, s);
      c.fillStyle = s.color;
      c.beginPath(); c.arc(w.x, w.y, 8, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#0d1117'; c.font = 'bold 10px sans-serif';
      c.fillText(String(s.id), w.x - (s.id > 9 ? 6 : 3), w.y + 3.5);
      if (s === sel) {
        c.strokeStyle = 'rgba(255,255,255,' + (0.5 + 0.4 * Math.sin(now / 200)) + ')'; c.lineWidth = 2;
        c.beginPath(); c.arc(w.x, w.y, 13, 0, Math.PI * 2); c.stroke();
      }
    }

    // legend
    c.fillStyle = 'rgba(219,228,240,0.85)'; c.font = '12px sans-serif';
    c.fillText('✛ control point (total station)   ◆ target recognised in a scan — moves with its scan   — cloud-to-cloud link', 16, 22);
    if (sel && !sel.excluded) {
      c.fillStyle = sel.color;
      c.fillText('Scan ' + sel.id + ' selected — drag to move, wheel / Q E to rotate, click ◆ to name a target', 16, 40);
    }
    if (this.anim) {
      c.fillStyle = '#fff'; c.font = 'bold 14px sans-serif';
      c.fillText('⚙ Least-squares adjustment…', 16, 62);
    }
  },
};

/* Gaussian elimination with partial pivoting: solves N x = b */
G.solveLinear = function (N, b) {
  const n = b.length, A = N.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    const d = A[i][i] || 1e-12;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / d;
      if (!f) continue;
      for (let q = i; q <= n; q++) A[r][q] -= f * A[i][q];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = A[i][n];
    for (let q = i + 1; q < n; q++) s -= A[i][q] * x[q];
    x[i] = s / (A[i][i] || 1e-12);
  }
  return x;
};
