/* ============================================================
   register.js — Phase 3: registration (top view), SEQUENTIAL:
   1) set a base scan (scan 1): coarse-align it to the map,
      label the targets it sees
   2) register scan 2 to scan 1 (cloud-to-cloud), then scan 3
      joins the 1-2 network, and so on — each join needs overlap
      with the network and its targets labeled
   3) bad/shaken scans are excluded and never join
   4) finish → residuals, accuracy, report
   ============================================================ */
window.G = window.G || {};

G.register = {
  canvas: null, ctx: null,
  dragScan: null, grabDX: 0, grabDY: 0,
  network: [],          // scan ids already registered into the network
  selected: null,       // scan id selected as "next to join"
  anim: null,           // {ids:[], start, dur, offs0:Map, done:fn}
  finished: false,

  enter() {
    G._regEntered = true;
    this.canvas = document.getElementById('reg-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.network = [];
    this.selected = null;
    this.anim = null;
    this.finished = false;
    this._inline = null;

    // every scan starts roughly misplaced (coarse positioning needed) —
    // EXCEPT scan 1, the reference: it is already "snapped" in place
    for (const s of G.state.scans) {
      s.off = { dx: G.rnd(-46, 46), dy: G.rnd(-46, 46), rot: G.rnd(-0.045, 0.045) };
      s.locked = false;          // coarsely aligned by the player
      s.inNetwork = false;
      s.coarseOk = false;
      s.residual = null;
    }
    if (G.state.scans[0]) {
      G.state.scans[0].off = { dx: 0, dy: 0, rot: 0 };
      G.state.scans[0].locked = true;
    }
    G.state.targetAssign = {};

    const btn = document.getElementById('btn-reg');
    btn.disabled = false;
    btn.onclick = () => this.doStep();
    document.getElementById('btn-to-report').disabled = true;
    document.getElementById('btn-to-report').onclick = () => {
      if (!G.state.results) { G.toast('Finish registration first!'); return; }
      G.report.enter();
      G.showScreen('report');
    };
    document.getElementById('reg-status').textContent = '';
    this.hideIdPopup();
    this.defaultSelect();
    this.renderLists();
    this.bindPointer();
  },

  /* ---------- helpers ---------- */
  scanById(id) { return G.state.scans.find(s => s.id === id); },
  joinable() { return G.state.scans.filter(s => !s.excluded && !s.inNetwork); },

  defaultSelect() {
    const j = this.joinable();
    if (!j.length) { this.selected = null; return; }
    // prefer the lowest-id scan that overlaps the network; else lowest id
    const withEdge = j.find(s => this.hasEdgeToNetwork(s));
    this.selected = (withEdge || j[0]).id;
  },

  hasEdgeToNetwork(s) {
    return (G.state.linkEdges || []).some(e =>
      (e.a === s.id && this.network.includes(e.b)) ||
      (e.b === s.id && this.network.includes(e.a)));
  },

  missingTargets(s) {
    if (!G.prep.has('targets')) return [];   // no ID labels packed → cannot label (counts as wrong later)
    return s.targets.filter(tid => !G.state.targetAssign[tid]);
  },

  baseResidual(s) {
    let r = 0.8 + Math.random() * 1.7;
    if (s.shaken) r += 6 + Math.random() * 8;
    if (!G.prep.has('laptop')) r += 4;
    else if (!G.prep.has('cables')) r += 3;
    return r;
  },

  /* ---------- one registration step ---------- */
  doStep() {
    if (this.anim || this.finished) return;
    const s = this.selected != null ? this.scanById(this.selected) : null;
    if (!s || s.excluded || s.inNetwork) { G.toast('Select a scan to join first.'); return; }
    this.hideIdPopup();

    if (this.network.length === 0) {
      // base scan: scan 1 becomes the reference frame
      const miss = this.missingTargets(s);
      if (miss.length) { G.toast('🏷 Label its targets first: ' + miss.join(', ') + ' (click them on the map)'); return; }
      this.startAnim([s.id], () => {
        s.off = { dx: 0, dy: 0, rot: 0 };
        s.inNetwork = true; s.coarseOk = s.locked; s.locked = true;
        s.residual = this.baseResidual(s);
        this.network.push(s.id);
        G.toast('📌 Scan ' + s.id + ' is the base scan of the network.');
        this.afterStep();
      });
      return;
    }

    // joining scan: needs cloud-to-cloud overlap with the network
    if (!this.hasEdgeToNetwork(s)) {
      G.toast('⛔ Scan ' + s.id + ' has NO cloud overlap with the network (scans ' +
        this.network.join(', ') + ') — cloud-to-cloud registration is impossible. Pick a scan on a dashed line, or mark this one as bad.');
      return;
    }
    const miss = this.missingTargets(s);
    if (miss.length) { G.toast('🏷 Label its targets first: ' + miss.join(', ')); return; }

    const wasLocked = s.locked;
    this.startAnim([s.id], () => {
      s.off = { dx: 0, dy: 0, rot: 0 };
      s.inNetwork = true; s.coarseOk = wasLocked; s.locked = true;
      let r = 0.8 + Math.random() * 1.7;
      if (s.shaken) r += 6 + Math.random() * 8;      // shaken scan left in
      if (!wasLocked) r += 18;                        // ICP did not converge
      if (!G.prep.has('laptop')) r += 4;
      else if (!G.prep.has('cables')) r += 3;
      s.residual = r;
      this.network.push(s.id);
      G.toast((wasLocked ? '✔' : '⚠') + ' Scan ' + s.id + ' registered to the network (' +
        this.network.join('–') + ') — residual ' + r.toFixed(1) + ' mm' +
        (wasLocked ? '' : ' (no coarse alignment → ICP struggled)'));
      this.afterStep();
    });
  },

  afterStep() {
    const remaining = this.joinable();
    if (remaining.length === 0) this.finished = true;   // set BEFORE renderLists so the button updates
    this.defaultSelect();
    this.renderLists();
    const status = document.getElementById('reg-status');
    status.textContent = remaining.length === 0
      ? 'All good scans are in the network. Finish to compute accuracy.'
      : remaining.length + ' scan(s) still to join.';
  },

  /* ---------- fine animation for one step ---------- */
  startAnim(ids, done) {
    const offs0 = new Map();
    for (const id of ids) offs0.set(id, { ...this.scanById(id).off });
    this.anim = { ids, start: performance.now(), dur: 1300, offs0, done };
    document.getElementById('reg-status').textContent = '⚙ Fine cloud-to-cloud registration (ICP)…';
  },

  /* ---------- final results ---------- */
  finishAll() {
    if (this.finished && G.state.results) return;
    this.anim = null;
    const scans = G.state.scans;
    const incl = scans.filter(s => s.inNetwork);
    const doorX = G.MAP.hall.door.x;

    // connections inside the network
    const edges = (G.state.linkEdges || []).filter(e =>
      incl.some(s => s.id === e.a) && incl.some(s => s.id === e.b));

    // bridge inside↔outside through the network
    const adj = new Map(incl.map(s => [s.id, []]));
    for (const e of edges) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
    let bridge = false;
    const seen = new Set();
    for (const s of incl) {
      if (seen.has(s.id)) continue;
      const stack = [s.id]; seen.add(s.id);
      let hasIn = s.x < doorX, hasOut = s.x >= doorX;
      while (stack.length) {
        const id = stack.pop();
        for (const n of adj.get(id)) {
          if (seen.has(n)) continue;
          seen.add(n);
          const ns = incl.find(q => q.id === n);
          if (ns.x < doorX) hasIn = true; else hasOut = true;
          stack.push(n);
        }
      }
      if (hasIn && hasOut) bridge = true;
    }

    // temperature / refraction drift without an inside↔outside link
    if (!bridge) for (const s of incl) if (s.x < doorX) s.residual += 28;

    const targetsOk = G.MAP.targets.filter(t => G.state.targetAssign[t.id] === t.id).length;
    const wrongIds = G.MAP.targets.length - targetsOk;
    const meanResidual = incl.reduce((a, s) => a + s.residual, 0) / Math.max(1, incl.length);

    G.state.results = {
      edges, bridge, wrongIds, targetsOk,
      meanResidual,
      maxResidual: Math.max(...incl.map(s => s.residual), 0),
      accuracy: meanResidual + wrongIds * 6,
      coverage: G.state.coverage,
      nScans: scans.length,
      nIncluded: incl.length,
      nShaken: scans.filter(s => s.shaken).length,
      shakenExcluded: scans.filter(s => s.shaken && s.excluded).length,
      goodExcluded: scans.filter(s => !s.shaken && s.excluded).length,
      coarseMissed: incl.filter(s => !s.coarseOk).length,
      networkOrder: [...this.network],
    };

    document.getElementById('reg-status').textContent =
      '✔ Registration finished: network of scans ' + this.network.join(' → ') +
      '. Mean residual ' + meanResidual.toFixed(1) + ' mm.';
    document.getElementById('btn-reg').disabled = true;
    document.getElementById('btn-to-report').disabled = false;
    this.renderLists();
  },

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
      if (this.anim || this.finished) return;
      const p = pos(e);
      // target click → ID popup
      const t = G.MAP.targets.find(t => G.dist(p.x, p.y, t.x, t.y) < 18);
      if (t) { this.showIdPopup(t, e); return; }
      // only the selected unregistered scan is on screen → grab & drag it
      const sel = this.selected != null ? this.scanById(this.selected) : null;
      if (sel && !sel.excluded && !sel.inNetwork) {
        const c = this.centroid(sel);
        if (G.dist(p.x, p.y, c.x, c.y) < 90) {
          if (!sel.locked) {
            this.dragScan = sel;
            this.grabDX = p.x - sel.x - sel.off.dx;
            this.grabDY = p.y - sel.y - sel.off.dy;
          }
          this.renderLists();
        }
      }
    };
    cv.onmousemove = (e) => {
      if (!this.dragScan || this.anim) return;
      const p = pos(e);
      const s = this.dragScan;
      s.off.dx = p.x - s.x - this.grabDX;
      s.off.dy = p.y - s.y - this.grabDY;
      // snap when close enough → coarse alignment locked (small leftover for fine reg)
      if (Math.abs(s.off.dx) < 26 && Math.abs(s.off.dy) < 26) {
        s.off = { dx: G.rnd(-4, 4), dy: G.rnd(-4, 4), rot: G.rnd(-0.012, 0.012) };
        s.locked = true;
        this.dragScan = null;
        G.toast('✔ Scan ' + s.id + ' coarsely aligned with the network clouds (fine registration will polish it)');
        this.renderLists();
      }
    };
    window.addEventListener('mouseup', () => { this.dragScan = null; });
  },

  centroid(s) { return { x: s.x + s.off.dx, y: s.y + s.off.dy }; },

  /* ---------- target ID popup ---------- */
  showIdPopup(t, e) {
    if (!G.prep.has('targets')) {
      G.toast('🏷 You forgot the target ID labels — you cannot label targets!');
      return;
    }
    const pop = document.getElementById('id-popup');
    document.getElementById('id-popup-target').textContent = t.id + ' (at ' + Math.round(t.x) + ',' + Math.round(t.y) + ')';
    const wrap = document.getElementById('id-popup-buttons');
    wrap.innerHTML = '';
    const used = new Set(Object.values(G.state.targetAssign));
    for (const tid of G.MAP.targets.map(t2 => t2.id)) {
      const b = document.createElement('button');
      b.textContent = tid;
      if (used.has(tid) && G.state.targetAssign[t.id] !== tid) b.classList.add('used');
      b.onclick = () => this.assignTarget(t, tid);
      wrap.appendChild(b);
    }
    const r = this.canvas.getBoundingClientRect();
    pop.style.left = Math.min(r.width - 220, Math.max(4, (e.clientX - r.left) * this.canvas.width / r.width + 10)) + 'px';
    pop.style.top = Math.max(4, (e.clientY - r.top) * this.canvas.height / r.height - 20) + 'px';
    pop.classList.remove('hidden');
  },
  hideIdPopup() { document.getElementById('id-popup').classList.add('hidden'); },

  /* ---------- target ID assignment (popup + inline list chooser) ---------- */
  assignTarget(t, tid) {
    if (this._inline) { this._inline.remove(); this._inline = null; }
    for (const k of Object.keys(G.state.targetAssign))
      if (G.state.targetAssign[k] === tid) delete G.state.targetAssign[k];
    G.state.targetAssign[t.id] = tid;
    this.hideIdPopup();
    this.renderLists();
  },

  toggleInlineIds(t, li) {
    if (!G.prep.has('targets')) { G.toast('🏷 You forgot the target ID labels — you cannot label targets!'); return; }
    if (this._inline && this._inline.dataset.tid === t.id) { this._inline.remove(); this._inline = null; return; }
    if (this._inline) { this._inline.remove(); this._inline = null; }
    const div = document.createElement('div');
    div.className = 'inline-ids';
    div.dataset.tid = t.id;
    div.textContent = 'Assign ID to ' + t.id + ': ';
    const used = new Set(Object.values(G.state.targetAssign));
    for (const tid of G.MAP.targets.map(t2 => t2.id)) {
      const b = document.createElement('button');
      b.className = 'mini'; b.textContent = tid;
      if (used.has(tid) && G.state.targetAssign[t.id] !== tid) b.style.opacity = .35;
      b.onclick = () => this.assignTarget(t, tid);
      div.appendChild(b);
    }
    li.after(div);
    this._inline = div;
  },

  /* ---------- lists ---------- */
  renderLists() {
    const selScan = this.selected != null ? this.scanById(this.selected) : null;

    // network status
    const net = document.getElementById('reg-network');
    net.innerHTML = this.network.length
      ? '🌐 Network: <b>' + this.network.join(' → ') + '</b>'
      : '🌐 Network: <b>empty</b> — set a base scan first.';

    // per-step checklist: what the selected scan still needs before registering
    const cl = document.getElementById('reg-checklist');
    if (!selScan || G.state.results) {
      cl.innerHTML = '';
    } else {
      const miss = this.missingTargets(selScan);
      const edge = this.network.length ? this.hasEdgeToNetwork(selScan) : null;
      cl.innerHTML = '<b>To register scan ' + selScan.id + ':</b><br>' +
        (selScan.locked ? '✔ coarsely aligned' : '⬜ drag the cloud onto the registered cloud until it snaps ✔') + '<br>' +
        (this.network.length === 0
          ? '📌 it will become the base (reference frame)'
          : (edge ? '✔ overlaps the network — cloud-to-cloud possible' : '⛔ no shared surfaces with the network — select another scan, or mark it bad')) + '<br>' +
        (miss.length
          ? '⬜ <b>label its targets first: ' + miss.join(', ') + '</b> — ⚠ rows below, or click the target on the canvas'
          : '✔ targets labeled');
    }

    // next-to-join list
    const nl = document.getElementById('reg-next-list');
    nl.innerHTML = '';
    const j = this.joinable();
    if (!j.length) {
      nl.innerHTML = '<li><span class="grow tag">No scans left to join.</span></li>';
    }
    for (const s of j) {
      const li = document.createElement('li');
      if (s.id === this.selected) li.classList.add('selected');
      const edge = this.hasEdgeToNetwork(s);
      li.innerHTML = `<span class="dot" style="background:${s.color}"></span>
        <span class="grow"><b>Scan ${s.id}</b> <span class="tag">${s.points.length} pts · sees: ${s.targets.join(' ') || '—'}</span>
        ${this.network.length ? `<span class="tag">${edge ? '🔗 overlaps network' : '⛔ no overlap'}</span>` : ''}
        ${s.locked ? '<span class="tag">✔ aligned</span>' : ''}</span>
        <button class="mini">select</button>`;
      li.querySelector('button').onclick = () => {
        this.selected = s.id;
        if (this.network.length && !this.hasEdgeToNetwork(s))
          G.toast('⛔ Scan ' + s.id + ' has no cloud overlap with the network — it cannot be registered next. Select another scan, or mark it as bad.');
        this.renderLists();
      };
      nl.appendChild(li);
    }

    // all scans (with bad-scan checkbox; network scans can't be excluded anymore)
    const ul = document.getElementById('reg-scan-list');
    ul.innerHTML = '';
    for (const s of G.state.scans) {
      const li = document.createElement('li');
      li.className = (s.locked ? 'locked ' : '') + (s.excluded ? 'excluded' : '') + (s.inNetwork ? 'locked' : '');
      li.innerHTML = `<span class="dot" style="background:${s.color}"></span>
        <span class="grow"><b>Scan ${s.id}</b>
        ${s.inNetwork ? '<span class="tag">🌐 in network</span>' : ''}
        ${s.locked && !s.inNetwork ? '<span class="tag">✔ aligned</span>' : ''}
        ${s.residual !== null ? `<span class="tag">res ${s.residual.toFixed(1)} mm</span>` : ''}</span>`;
      if (!s.inNetwork) {
        const lab = document.createElement('label');
        lab.innerHTML = `<input type="checkbox" ${s.excluded ? 'checked' : ''}> bad scan`;
        const cb = lab.querySelector('input');
        cb.onchange = () => { s.excluded = cb.checked; if (s.excluded) { s.locked = false; } this.defaultSelect(); this.renderLists(); };
        li.appendChild(lab);
      } else {
        const sp = document.createElement('span');
        sp.className = 'tag';
        sp.textContent = '🔒';
        li.appendChild(sp);
      }
      ul.appendChild(li);
    }

    // targets — with inline ID chooser and ⚠ highlight for targets the selected scan needs
    const tl = document.getElementById('reg-target-list');
    tl.innerHTML = '';
    for (const t of G.MAP.targets) {
      const li = document.createElement('li');
      const a = G.state.targetAssign[t.id];
      const needed = selScan && !selScan.inNetwork && !selScan.excluded && selScan.targets.includes(t.id) && !a;
      if (needed) li.classList.add('needed');
      li.innerHTML = `<span class="dot" style="background:#ffe066"></span>
        <span class="grow"><b>${t.id}</b> <span class="tag">@ (${Math.round(t.x)}, ${Math.round(t.y)})</span>
        ${needed ? `<span class="tag" style="color:var(--warn)">⚠ label for scan ${selScan.id}</span>` : ''}</span>
        <span class="tag">ID: <b>${a || '—'}</b></span>
        <button class="mini">label…</button>`;
      li.querySelector('button').onclick = () => this.toggleInlineIds(t, li);
      tl.appendChild(li);
    }

    // main button: disabled with a clear reason until the step's requirements are met
    const btn = document.getElementById('btn-reg');
    if (this.finished || G.state.results) {
      btn.textContent = '✔ Finish registration';
      btn.disabled = !!G.state.results;
      btn.onclick = () => this.finishAll();
    } else {
      btn.onclick = () => this.doStep();
      if (!selScan) {
        btn.disabled = true;
        btn.textContent = '— no scan selected';
      } else {
        const miss = this.missingTargets(selScan);
        if (this.network.length === 0) {
          btn.disabled = miss.length > 0;
          btn.textContent = miss.length
            ? '🏷 Label its targets first: ' + miss.join(', ')
            : '📌 Set base scan ' + selScan.id;
        } else if (!this.hasEdgeToNetwork(selScan)) {
          btn.disabled = true;
          btn.textContent = '⛔ Scan ' + selScan.id + ' has no cloud overlap — select another scan';
        } else if (miss.length) {
          btn.disabled = true;
          btn.textContent = '🏷 Label targets first: ' + miss.join(', ');
        } else {
          btn.disabled = false;
          btn.textContent = '🔗 Register scan ' + selScan.id + ' to network (' + this.network.join('–') + ')';
        }
      }
    }
  },

  /* ---------- drawing ---------- */
  draw(now) {
    const c = this.ctx, M = G.MAP;
    c.clearRect(0, 0, 960, 640);
    // Plain dark background — NO floor plan / grid here. In the real world
    // (and in registration software) you only see the point clouds and the
    // surveyed control targets. Alignment is purely cloud-to-cloud against
    // the network (scan 1 is already placed as the reference frame).
    c.fillStyle = '#0a0e13'; c.fillRect(0, 0, 960, 640);

    // dashed suggestion line: selected scan ↔ network scans it genuinely
    // overlaps (enough shared surfaces → cloud-to-cloud possible)
    const sel = this.selected != null ? this.scanById(this.selected) : null;
    if (sel && !sel.excluded && this.network.length) {
      c.strokeStyle = 'rgba(72,219,251,0.4)'; c.lineWidth = 1.5; c.setLineDash([5, 5]);
      for (const nid of this.network) {
        const e = (G.state.linkEdges || []).find(e =>
          (e.a === sel.id && e.b === nid) || (e.a === nid && e.b === sel.id));
        if (e) {
          const cs = this.centroid(sel), cn = this.centroid(this.scanById(nid));
          c.beginPath(); c.moveTo(cs.x, cs.y); c.lineTo(cn.x, cn.y); c.stroke();
        }
      }
      c.setLineDash([]);
    }

    // step animation: involved clouds glide into place
    let k = 1;
    if (this.anim) {
      k = G.ease(Math.min(1, (now - this.anim.start) / this.anim.dur));
      if (k >= 1) {
        const a = this.anim; this.anim = null;
        a.done();
      }
    }

    const animOff = (s) => {
      if (this.anim && this.anim.ids.includes(s.id)) {
        const o0 = this.anim.offs0.get(s.id);
        return { dx: o0.dx * (1 - k), dy: o0.dy * (1 - k), rot: o0.rot * (1 - k) };
      }
      return s.off;
    };
    const drawPoints = (s, off, color, alpha, size) => {
      const cs = Math.cos(off.rot), sn = Math.sin(off.rot);
      c.fillStyle = color; c.globalAlpha = alpha;
      for (const p of s.points) {
        const px = p.x - s.x, py = p.y - s.y;
        c.fillRect(s.x + px * cs - py * sn + off.dx - size / 2,
                   s.y + px * sn + py * cs + off.dy - size / 2, size, size);
      }
      c.globalAlpha = 1;
    };

    // 1) ALREADY REGISTERED scans → one merged "registered cloud"
    for (const s of G.state.scans) {
      if (!s.inNetwork) continue;
      drawPoints(s, animOff(s), '#b8e6ff', 0.85, 2);
    }
    // 2) the ONE selected unregistered scan → its own bright color
    const selScan = this.selected != null ? this.scanById(this.selected) : null;
    if (selScan && !selScan.inNetwork && !selScan.excluded) {
      drawPoints(selScan, animOff(selScan), selScan.color, 0.95, 2.6);
    }

    // station markers for every visible scan (network + selected only)
    for (const s of G.state.scans) {
      if (!s.inNetwork && s.id !== this.selected) continue;
      const off = animOff(s);
      const cx = s.x + off.dx, cy = s.y + off.dy;
      c.fillStyle = s.inNetwork ? '#b8e6ff' : s.color;
      c.beginPath(); c.arc(cx, cy, 8, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#0d1117'; c.font = 'bold 10px sans-serif';
      c.fillText(String(s.id), cx - 4, cy + 3.5);
      if (s.inNetwork) {
        c.fillStyle = '#1dd1a1'; c.font = '11px sans-serif';
        c.fillText('🌐', cx + 10, cy - 8);
      } else if (s.locked) {
        c.fillStyle = '#1dd1a1'; c.font = '11px sans-serif';
        c.fillText('✔', cx + 10, cy - 8);
      }
      if (s.id === this.selected && !s.inNetwork && !s.excluded) {
        c.strokeStyle = 'rgba(72,219,251,' + (0.5 + 0.4 * Math.sin(now / 200)) + ')';
        c.lineWidth = 2;
        c.beginPath(); c.arc(cx, cy, 14, 0, Math.PI * 2); c.stroke();
      }
    }

    // legend
    c.fillStyle = 'rgba(184,230,255,0.9)'; c.font = '12px sans-serif';
    c.fillText('● registered cloud — scans ' + (this.network.join(' → ') || '—'), 24, 24);
    if (selScan && !selScan.inNetwork && !selScan.excluded) {
      c.fillStyle = selScan.color;
      c.fillText('● selected scan ' + selScan.id + ' — drag it onto the registered cloud', 24, 42);
    }

    // network connections (solid green) — only between joined scans
    if (this.network.length > 1) {
      c.strokeStyle = 'rgba(29,209,161,0.5)'; c.lineWidth = 1.5;
      for (const e of (G.state.linkEdges || [])) {
        const a = this.scanById(e.a), b = this.scanById(e.b);
        if (!a || !b || !a.inNetwork || !b.inNetwork) continue;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
    }

    // targets with assigned labels; pulsing ring on targets the selected scan still needs
    const selS = this.selected != null ? this.scanById(this.selected) : null;
    for (const t of M.targets) {
      const a = G.state.targetAssign[t.id];
      c.fillStyle = '#ffe066';
      c.beginPath();
      c.moveTo(t.x, t.y - 12); c.lineTo(t.x + 9, t.y - 4); c.lineTo(t.x, t.y + 4); c.lineTo(t.x - 9, t.y - 4);
      c.closePath(); c.fill();
      c.fillStyle = '#ffe066'; c.font = 'bold 12px sans-serif';
      c.fillText(a ? a : '?', t.x + 7, t.y + 16);
      if (selS && !selS.inNetwork && !selS.excluded && selS.targets.includes(t.id) && !a) {
        c.strokeStyle = 'rgba(254,202,87,' + (0.5 + 0.4 * Math.sin(now / 200)) + ')';
        c.lineWidth = 2;
        c.beginPath(); c.arc(t.x, t.y, 15, 0, Math.PI * 2); c.stroke();
      }
    }

    if (this.anim) {
      c.fillStyle = '#fff'; c.font = 'bold 14px sans-serif';
      c.fillText('⚙ ICP: cloud-to-cloud fine registration…', 24, 34);
    }
  },
};
