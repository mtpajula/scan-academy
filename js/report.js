/* ============================================================
   report.js — Phase 4: registration report + delivery + scoring.
   The customer checks the result against an independent survey,
   so the report reveals the TRUE error of every scan next to the
   error the adjustment reported.
   ============================================================ */
window.G = window.G || {};

G.report = {
  enter() {
    this.buildDoc();
    this.drawMap();
    document.getElementById('btn-deliver').onclick = () => this.deliver();
  },

  /* top view of the final registered cloud */
  drawMap() {
    const cv = document.getElementById('report-canvas');
    if (!cv || !G.state.results) return;
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height, k = H / 640, ox = (W - 960 * k) / 2;
    const P = (x, y) => [ox + x * k, y * k];
    c.fillStyle = '#0a0e13'; c.fillRect(0, 0, W, H);
    const R = G.state.results, reg = G.register;
    const rowOf = (s) => R.perScan.find(r => r.id === s.id);

    for (const s of G.state.scans) {
      const row = rowOf(s);
      if (row.trueErr == null) continue;
      const e = row.trueErr;
      c.fillStyle = e > 30 ? '#ff6b6b' : e > 10 ? '#feca57' : '#b8e6ff';
      c.globalAlpha = 0.75;
      for (const p of s.points) { const w = reg.xf(s, p); const [x, y] = P(w.x, w.y); c.fillRect(x, y, 1.5, 1.5); }
    }
    c.globalAlpha = 1;
    for (const t of G.MAP.targets) {
      const [x, y] = P(t.x, t.y);
      c.strokeStyle = '#fff'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x - 5, y); c.lineTo(x + 5, y); c.moveTo(x, y - 5); c.lineTo(x, y + 5); c.stroke();
      c.fillStyle = '#fff'; c.font = '10px sans-serif'; c.fillText(t.id, x + 6, y - 4);
    }
    for (const s of G.state.scans) {
      const row = rowOf(s);
      if (row.trueErr == null) continue;
      const w = reg.xf(s, s), [x, y] = P(w.x, w.y);
      c.fillStyle = '#e8eef7';
      c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#0d1117'; c.font = 'bold 8px sans-serif';
      c.fillText(String(s.id), x - 3, y + 3);
    }
    c.fillStyle = 'rgba(219,228,240,0.85)'; c.font = '12px sans-serif';
    c.fillText('Delivered cloud, coloured by TRUE error (independent check): blue < 10 mm · yellow 10–30 mm · red > 30 mm', 14, 18);
  },

  buildDoc() {
    const R = G.state.results, S = G.state;
    const el = document.getElementById('report-doc');
    if (!R) { el.innerHTML = '<p>No registration results.</p>'; return; }
    const f = (v) => v == null ? '—' : v.toFixed(1) + ' mm';
    const errCls = (v) => v == null ? '' : v > 3 * G.SPEC_MM ? 'err' : v > G.SPEC_MM ? 'warnc' : 'ok';

    const rows = R.perScan.map(r => {
      const s = S.scans.find(q => q.id === r.id);
      const status = r.status === 'excluded' ? '<span class="err">excluded</span>'
        : r.status === 'free' ? '<span class="err">not connected</span>'
        : r.status === 'weak' ? '<span class="warnc">under-constrained</span>'
        : r.status === 'datum' ? 'datum' : 'registered';
      return `<tr><td><span style="color:${s.color}">●</span> Scan ${r.id} ${r.outside ? '🌧' : '🏭'}</td>
        <td>${status}</td><td>${s.tobs.map(o => s.names[o.tid] || '?').join(' ') || '—'}</td>
        <td>${f(r.reported)}</td><td class="${errCls(r.trueErr)}">${f(r.trueErr)}</td></tr>`;
    }).join('');

    const cons = R.constraints.filter(c => c.enabled).sort((a, b) => (b.error ?? 0) - (a.error ?? 0)).map(c =>
      `<tr><td>${c.type === 'c2c' ? '☁ cloud-to-cloud' : '◆ target'}</td>
       <td>${c.type === 'c2c' ? `Scan ${c.a} ↔ Scan ${c.b} (ICP ${c.icpRms.toFixed(1)} mm)` : `Scan ${c.a} · named ${c.name}`}</td>
       <td class="${c.error > 15 ? 'err' : c.error > 6 ? 'warnc' : 'ok'}">${f(c.error)}</td></tr>`
    ).join('') || '<tr><td colspan="3" class="err">No constraints!</td></tr>';

    const wrong = R.names.filter(n => !n.ok);
    const missing = G.EQUIPMENT.filter(e => e.effect && !S.van.includes(e.id)).map(e => e.name + ' → ' + e.effect);
    const hidden = R.reportedRms < 10 && R.maxTrue > 30;

    el.innerHTML = `
      <h1>Laser Scanning — Registration Report</h1>
      <div class="meta">Project: Industrial hall + yard survey · Date: ${new Date().toISOString().slice(0, 10)} · Operator: student crew</div>

      <h3>Summary</h3>
      <p class="bigstat">Reported error (adjustment): RMS ${R.reportedRms.toFixed(1)} mm · redundancy ${R.redundancy}</p>
      <p class="bigstat">True error (customer's independent check): mean ${R.meanTrue.toFixed(1)} mm · max ${R.maxTrue.toFixed(1)} mm</p>
      <p>${R.georef ? '✔ Georeferenced to the total-station control points.' : '⚠ <b>Not georeferenced</b> — fewer than two control points named; the cloud is in a local frame only.'}
         Surface coverage: <b>${(R.coverage * 100).toFixed(1)} %</b> usable (within ${G.SPEC_MM} mm) of ${(R.coverageAll * 100).toFixed(1)} % registered.</p>
      ${hidden ? `<div class="note">⚠ <b>The adjustment looked fine, but the true error is large.</b>
        A wrong target name or a failed ICP link was not checked by any other constraint (no redundancy),
        so the error was invisible. Cross-register: link each scan to two or more neighbours and name every target.</div>` : ''}

      <h3>Scans</h3>
      <table><tr><th>Scan</th><th>Status</th><th>Target names</th><th>Reported error</th><th>True error</th></tr>${rows}</table>

      <h3>Constraints used in the adjustment</h3>
      <table><tr><th>Type</th><th>Constraint</th><th>Error</th></tr>${cons}</table>

      <h3>Target naming</h3>
      <p>${R.names.length} target observations named, <b class="${wrong.length ? 'err' : 'ok'}">${wrong.length} wrong</b>.</p>
      ${wrong.length ? '<p>' + wrong.map(n => `Scan ${n.scan}: named <b>${n.name}</b>, was really <b>${n.tid}</b>`).join(' · ') + '</p>' : ''}

      <h3>Data quality</h3>
      <p>Bad scans (vibration / handheld / wet window): ${R.nBad}, excluded ${R.badExcluded}
        ${R.goodExcluded ? ` · ⚠ ${R.goodExcluded} good scan(s) excluded` : ''}
        ${R.notConnected ? ` · ⚠ ${R.notConnected} scan(s) not connected to the network` : ''}</p>
      ${R.ghostPts ? `<p>🌧 ${R.ghostPts} rain-droplet points in the delivered cloud — remove them with a noise filter before delivery.</p>` : ''}
      ${missing.length ? `<h3>Stayed at the office</h3><p>${missing.join('; ')}</p>` : ''}
    `;
  },

  /* Score = how much of the site was delivered at the required accuracy.
     Coverage (70) counts only scans within G.SPEC_MM true error;
     accuracy (30) is full at ≤ spec and falls to 0 at 3 × spec. */
  score() {
    const R = G.state.results, SP = G.SPEC_MM;
    const parts = {
      coverage: 70 * Math.min(R.coverage / 0.95, 1),
      accuracy: R.nRegistered ? 30 * G.clamp((3 * SP - R.meanTrue) / (2 * SP), 0, 1) : 0,
    };
    return { parts, total: Math.round(parts.coverage + parts.accuracy) };
  },

  deliver() {
    const R = G.state.results, S = G.state, SP = G.SPEC_MM;
    const { parts, total: score } = this.score();
    const stars = score >= 85 ? 3 : score >= 60 ? 2 : score >= 40 ? 1 : 0;

    document.getElementById('score-title').textContent =
      stars === 3 ? '🏆 Outstanding survey!' : stars === 2 ? '👍 Good job!' : stars === 1 ? '😐 Acceptable… barely' : '❌ Customer rejected the delivery';
    document.getElementById('score-stars').textContent = '★★★'.slice(0, stars) + '☆☆☆'.slice(0, 3 - stars);
    document.getElementById('score-value').innerHTML = `${score} / 100<br><span class="score-parts">coverage ${Math.round(parts.coverage)}/70 · accuracy ${Math.round(parts.accuracy)}/30</span>`;

    const fb = document.getElementById('score-feedback');
    fb.innerHTML = '';
    const add = (txt, kind) => {           // kind: good | bad | warn | info
      const li = document.createElement('li');
      li.className = kind;
      li.textContent = ({ good: '✔ ', bad: '✘ ', warn: '⚠ ', info: 'ℹ ' })[kind] + txt;
      fb.appendChild(li);
    };

    // the two things that are scored
    const cov = (R.coverage * 100).toFixed(0), covAll = (R.coverageAll * 100).toFixed(0);
    add(`Usable coverage ${cov}% of the site surfaces (within ${SP} mm)` +
      (R.coverageAll - R.coverage > 0.03 ? ` — ${covAll}% was scanned, but part of it is not accurate enough.` :
       R.coverage < 0.8 ? ' — shadows behind pillars and objects remain: more scan positions, hall AND yard.' : ' — great, the site is well covered.'),
      R.coverage >= 0.8 ? 'good' : 'bad');
    add(`True accuracy ${R.meanTrue.toFixed(1)} mm (requirement ${SP} mm; the adjustment claimed ${R.reportedRms.toFixed(1)} mm).`,
      R.meanTrue <= SP ? 'good' : 'bad');

    // why — only the things that actually cost coverage or accuracy
    if (R.reportedRms < 10 && R.maxTrue > 3 * SP)
      add('The adjustment looked fine but the true error is large — without redundancy (cross-registration) mistakes stay hidden.', 'warn');
    if (R.reportedRms > 15)
      add('The adjustment showed large errors — fix target names / disable failed links before delivering.', 'warn');
    if (R.namesWrong)
      add(`${R.namesWrong} target(s) named wrong — a wrong name ties the scan to the wrong control point.`, 'warn');
    if (R.nOutOfSpec)
      add(`${R.nOutOfSpec} registered scan(s) outside the ${SP} mm requirement do not count as coverage.`, 'warn');
    if (R.nBad > R.badExcluded)
      add(`${R.nBad - R.badExcluded} bad scan(s) delivered (vibration, handheld or wet window) — they are too fuzzy to meet the requirement.`, 'warn');
    if (R.notConnected)
      add(`${R.notConnected} scan(s) never got connected to the network — their area is missing.`, 'warn');
    if (R.goodExcluded)
      add(`${R.goodExcluded} good scan(s) were excluded — their area is missing.`, 'warn');
    if (!R.georef)
      add('Not georeferenced: name at least two (better three) control targets to deliver in site coordinates.', 'warn');

    // what stayed at the office — only things that had an effect, no blame
    const missed = G.EQUIPMENT.filter(e => e.effect && !S.van.includes(e.id));
    if (missed.length)
      add('Stayed at the office (no room in the van): ' + missed.map(e => `${e.name} → ${e.effect}`).join('; ') + '.', 'info');

    document.getElementById('score-overlay').classList.remove('hidden');
  },
};
