/* ============================================================
   report.js — Phase 4: registration report + delivery + scoring
   ============================================================ */
window.G = window.G || {};

G.report = {
  enter() {
    this.buildDoc();
    this.drawMap();
    document.getElementById('btn-deliver').onclick = () => this.deliver();
  },

  /* top view of the final registered cloud + connections + targets */
  drawMap() {
    const cv = document.getElementById('report-canvas');
    if (!cv || !G.state.results) return;
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height, sy = H / 640;
    c.fillStyle = '#0a0e13'; c.fillRect(0, 0, W, H);

    // excluded (bad) scans: faint gray
    for (const s of G.state.scans) {
      if (!s.excluded) continue;
      c.fillStyle = '#8b98ab'; c.globalAlpha = 0.15;
      for (const p of s.points) c.fillRect(p.x, p.y * sy, 1.5, 1.5);
    }
    c.globalAlpha = 1;
    // registered network: one merged cloud
    for (const s of G.state.scans) {
      if (!s.inNetwork) continue;
      c.fillStyle = '#b8e6ff'; c.globalAlpha = 0.8;
      for (const p of s.points) c.fillRect(p.x, p.y * sy, 1.5, 1.5);
    }
    c.globalAlpha = 1;
    // connections between registered scans
    c.strokeStyle = 'rgba(29,209,161,0.7)'; c.lineWidth = 1.5;
    for (const e of G.state.results.edges) {
      const a = G.state.scans.find(s => s.id === e.a), b = G.state.scans.find(s => s.id === e.b);
      if (!a || !b) continue;
      c.beginPath(); c.moveTo(a.x, a.y * sy); c.lineTo(b.x, b.y * sy); c.stroke();
    }
    // scan stations
    for (const s of G.state.scans) {
      if (!s.inNetwork && !s.excluded) continue;
      c.fillStyle = s.inNetwork ? '#b8e6ff' : '#8b98ab';
      c.beginPath(); c.arc(s.x, s.y * sy, 5, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#0d1117'; c.font = 'bold 8px sans-serif';
      c.fillText(String(s.id), s.x - 3, s.y * sy + 3);
    }
    // targets with assigned IDs
    for (const t of G.MAP.targets) {
      const a = G.state.targetAssign[t.id];
      const ok = a === t.id;
      c.fillStyle = ok ? '#1dd1a1' : '#ff6b6b';
      c.beginPath();
      c.moveTo(t.x, t.y * sy - 9); c.lineTo(t.x + 7, t.y * sy - 3);
      c.lineTo(t.x, t.y * sy + 3); c.lineTo(t.x - 7, t.y * sy - 3);
      c.closePath(); c.fill();
      c.font = 'bold 10px sans-serif';
      c.fillText((a || '?') + (ok ? '✔' : '✘'), t.x + 8, t.y * sy + 4);
    }
    c.fillStyle = 'rgba(219,228,240,0.85)'; c.font = '12px sans-serif';
    c.fillText('Registered cloud (scans ' + G.state.results.networkOrder.join(' → ') + ') · green = cloud-to-cloud connections · gray = excluded bad scans', 14, 18);
  },

  buildDoc() {
    const R = G.state.results, S = G.state;
    const scans = S.scans;
    const el = document.getElementById('report-doc');
    if (!R) { el.innerHTML = '<p>No registration results.</p>'; return; }

    const rows = scans.map(s => {
      const inc = !s.excluded;
      return `<tr>
        <td><span style="color:${s.color}">●</span> Scan ${s.id}</td>
        <td>(${Math.round(s.x)}, ${Math.round(s.y)})${s.x >= G.MAP.hall.door.x ? ' 🌧 outside' : ' 🏭 inside'}</td>
        <td>${s.points.length}</td>
        <td>${s.targets.join(' ') || '—'}</td>
        <td>${s.excluded ? '<span class="err">excluded (bad)</span>' : (inc && s.residual !== null ? s.residual.toFixed(1) + ' mm' : '—')}</td>
      </tr>`;
    }).join('');

    const conn = R.edges.map(e =>
      `<tr><td>Scan ${e.a} ↔ Scan ${e.b}</td><td>${e.common} common surface cells</td><td class="ok">cloud-to-cloud link ✔</td></tr>`
    ).join('') || '<tr><td colspan="3" class="err">No scan-to-scan links!</td></tr>';

    const trows = G.MAP.targets.map(t => {
      const a = S.targetAssign[t.id];
      const ok = a === t.id;
      return `<tr><td>${t.id}</td><td>(${Math.round(t.x)}, ${Math.round(t.y)})</td>
        <td>${a || '—'}</td><td class="${ok ? 'ok' : 'err'}">${ok ? '✔ correct' : '✘ wrong'}</td></tr>`;
    }).join('');

    const missing = G.EQUIPMENT.filter(e => !S.van.includes(e.id)).map(e => e.name);

    el.innerHTML = `
      <h1>Laser Scanning — Registration Report</h1>
      <div class="meta">Project: Industrial hall survey · Date: ${new Date().toISOString().slice(0, 10)} ·
        Scanner: ${S.van.includes('scanner') ? 'laser scanner' : '—'} · Operator: student crew</div>

      <h3>Scans</h3>
      <table><tr><th>Scan</th><th>Position</th><th>Points</th><th>Targets seen</th><th>Residual</th></tr>${rows}</table>

      <h3>Scan-to-scan connections (cloud-to-cloud)</h3>
      <table><tr><th>Connection</th><th>Overlap</th><th>Status</th></tr>${conn}</table>
      ${R.bridge
        ? '<p class="ok">✔ Inside and outside clouds are linked through the door area — no refraction drift.</p>'
        : '<div class="note">⚠ <b>No cloud-to-cloud link between inside and outside scans.</b> ' +
           'Temperature differences bend the beam in air (refraction) — the indoor cloud drifts ' +
           '~28&nbsp;mm relative to the outdoor skeleton. Scan near the door to bridge the clouds!</div>'}

      <h3>Control targets (total-station skeleton)</h3>
      <table><tr><th>Target</th><th>Position</th><th>Assigned ID</th><th>Check</th></tr>${trows}</table>
      ${R.wrongIds > 0 ? `<div class="note">⚠ ${R.wrongIds} target ID(s) wrong or missing — the control network is distorted.</div>` : ''}

      <h3>Coverage & accuracy</h3>
      <p class="bigstat">Surface coverage: ${(R.coverage * 100).toFixed(1)} %</p>
      <p class="bigstat">Estimated accuracy (mean residual): ${R.accuracy.toFixed(1)} mm · max ${R.maxResidual.toFixed(1)} mm</p>
      <p>Scans: ${R.nScans} total, ${R.nIncluded} used · shaken scans found: ${R.nShaken}, excluded: ${R.shakenExcluded}
         ${R.goodExcluded ? `· ⚠ ${R.goodExcluded} good scan(s) wrongly excluded` : ''}</p>
      ${R.coverage < 0.7 ? '<div class="note">⚠ Low coverage — concrete structures cast shadows when scanning from a single position. Move the scanner between scans!</div>' : ''}
      ${missing.length ? `<h3>Not packed into the van (left on the storage shelf)</h3><p>${missing.join(', ')}</p>` : '<p>✔ All equipment packed and accounted for.</p>'}
    `;
  },

  deliver() {
    const R = G.state.results, S = G.state;
    const covScore = Math.min(R.coverage / 0.78, 1) * 30;
    const bridgeScore = R.bridge ? 15 : 0;
    const shakenScore = R.nShaken === 0 ? 15 : (R.shakenExcluded === R.nShaken && R.goodExcluded === 0 ? 15 : R.shakenExcluded > 0 ? 7 : 0);
    const idScore = (R.targetsOk / G.MAP.targets.length) * 20;
    const keyItems = ['scanner', 'tripod', 'battery', 'sdcard', 'ppe', 'laptop', 'targets'];
    const eqScore = 10 * keyItems.filter(id => S.van.includes(id)).length / keyItems.length;
    const score = Math.round(covScore + bridgeScore + shakenScore + idScore + eqScore);

    const stars = score >= 85 ? 3 : score >= 60 ? 2 : score >= 40 ? 1 : 0;

    document.getElementById('score-title').textContent =
      stars === 3 ? '🏆 Outstanding survey!' : stars === 2 ? '👍 Good job!' : stars === 1 ? '😐 Acceptable… barely' : '❌ Customer rejected the delivery';
    document.getElementById('score-stars').textContent = '★★★'.slice(0, stars) + '☆☆☆'.slice(0, 3 - stars);
    document.getElementById('score-value').textContent = score + ' / 100 · accuracy ' + R.accuracy.toFixed(1) + ' mm · coverage ' + (R.coverage * 100).toFixed(0) + ' %';

    const fb = document.getElementById('score-feedback');
    fb.innerHTML = '';
    const add = (txt, good) => {
      const li = document.createElement('li');
      li.className = good ? 'good' : 'bad';
      li.textContent = (good ? '✔ ' : '✘ ') + txt;
      fb.appendChild(li);
    };

    add(`Coverage ${(R.coverage * 100).toFixed(0)}% — ` + (R.coverage >= 0.7
      ? 'great, you moved the scanner around.'
      : 'concrete pillars cast "shadows" when you scan from one spot only. Move the scanner on every scan!'), R.coverage >= 0.7);
    add(R.bridge
      ? 'Inside and outside clouds are linked (cloud-to-cloud) — no air-refraction drift from temperature changes.'
      : 'No link between inside and outside scans! Temperature changes refract the beam in air → ~28 mm drift. Scan near the door to bridge the clouds.', R.bridge);
    if (R.nShaken > 0) add(`Found ${R.nShaken} shaken scan(s) (vibration / rain): ${R.shakenExcluded === R.nShaken ? 'all excluded — good eye!' : 'NOT all excluded — shaken scans corrupt registration. Check clouds in registration phase.'}`, R.shakenExcluded === R.nShaken);
    else add('No shaken scans — you avoided the compressor vibration zone and covered the scanner in the rain.', true);
    add(`Target IDs: ${R.targetsOk}/${G.MAP.targets.length} correct — targets form the skeleton, but you must label them right.`, R.wrongIds === 0);
    add(`Scans must overlap densely for cloud-to-cloud registration — ${R.edges.length} link(s) found.`, R.edges.length >= 2);
    const missed = G.EQUIPMENT.filter(e => !S.van.includes(e.id));
    if (missed.length) add('Not packed into the van (left on the storage shelf): ' + missed.map(e => e.name).join(', ') + ' — pack everything the job needs.', false);
    else add('Nothing forgotten — full kit packed (even with only 8 van slots!).', true);

    document.getElementById('score-overlay').classList.remove('hidden');
  },
};
