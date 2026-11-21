/* ============================================================
   main.js — shared state, screen manager, main loop
   ============================================================ */
window.G = window.G || {};

G.state = {
  screen: 'prep',
  van: [],
  scans: [],
  battery: 100, spares: 0, maxScans: 99,
  coverage: 0, linkEdges: [], bridge: false,
  targetAssign: {},
  results: null,
};

G.showScreen = function (name) {
  G.state.screen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.phase-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === name);
  });
  // unlock phase buttons progressively
  const order = ['prep', 'field', 'register', 'report'];
  const maxReached = Math.max(order.indexOf(name), G._maxScreen ?? 0);
  G._maxScreen = maxReached;
  document.querySelectorAll('.phase-btn').forEach(b => {
    b.classList.toggle('locked', order.indexOf(b.dataset.screen) > maxReached);
  });
};

document.querySelectorAll('.phase-btn').forEach(b => {
  b.onclick = () => {
    const target = b.dataset.screen;
    const order = ['prep', 'field', 'register', 'report'];
    if (order.indexOf(target) > (G._maxScreen ?? 0)) { G.toast('Finish the current phase first!'); return; }
    if (target === 'field' && !G._fieldEntered) G.field.enter();
    if (target === 'register') { if (!G.state.scans.length) { G.toast('Do field work first!'); return; } if (!G._regEntered) G.register.enter(); }
    if (target === 'report') { if (!G.state.results) { G.toast('Run registration first!'); return; } G.report.enter(); }
    if (target === 'prep') G.prep.render();
    G.showScreen(target);
  };
});

/* main loop */
function loop(now) {
  if (G.state.screen === 'field') G.field.draw(now);
  if (G.state.screen === 'register') G.register.draw(now);
  requestAnimationFrame(loop);
}

G.prep.init();
G.showScreen('prep');
requestAnimationFrame(loop);
