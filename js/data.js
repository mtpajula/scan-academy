/* ============================================================
   data.js — static game data: map, targets, equipment
   ============================================================ */
window.G = window.G || {};

/* World coordinates = canvas pixels. 1 px = 5 cm  →  1 px = 50 mm */
G.MM_PER_PX = 50;

G.MAP = {
  world: { x: 20, y: 20, w: 920, h: 600 },          // outer boundary of the site
  hall:  { x: 80, y: 80, w: 560, h: 440,              // industrial hall (concrete)
           door: { x: 640, y1: 260, y2: 340 } },       // door to the outside on the east wall
  pillars: [                                          // concrete structures → cause shadows
    { x: 200, y: 180, w: 40, h: 40 },
    { x: 340, y: 300, w: 40, h: 40 },
    { x: 480, y: 160, w: 40, h: 40 },
    { x: 260, y: 420, w: 40, h: 40 },
    { x: 520, y: 420, w: 40, h: 40 },
  ],
  machine: { x: 545, y: 105, w: 40, h: 34, vibrR: 85, label: 'compressor' }, // vibrating machine
  outside: [                                          // yard east of the door
    { x: 700, y: 120, w: 130, h: 60,  label: 'loading dock' },
    { x: 690, y: 300, w: 95,  h: 42,  label: 'truck' },
    { x: 760, y: 440, w: 110, h: 55,  label: 'container' },
    { x: 872, y: 190, w: 18,  h: 18,  label: 'pole' },
  ],
  // Control targets already placed by the total station crew (the "skeleton")
  targets: [
    { id: 'T1', x: 140, y: 140 },
    { id: 'T2', x: 600, y: 140 },
    { id: 'T3', x: 300, y: 480 },
    { id: 'T4', x: 560, y: 490 },
    { id: 'T5', x: 700, y: 200 },   // outside, near the door
    { id: 'T6', x: 870, y: 540 },   // outside, far corner
  ],
};

/* Equipment shelf. Van has limited slots → easy to forget things. */
G.EQUIPMENT = [
  { id: 'scanner',  name: 'Laser scanner',        desc: 'The scanner unit itself. Obviously essential.' },
  { id: 'tripod',   name: 'Tripod',               desc: 'Handheld scanning shakes every scan.' },
  { id: 'battery',  name: 'Spare batteries ×2',   desc: 'Each scan drains 14%. Swap a spare in when the current one runs empty.' },
  { id: 'sdcard',   name: 'SD card',              desc: 'Without it the scanner stores only 4 scans.' },
  { id: 'targets',  name: 'Target ID labels',     desc: 'Without labels you cannot ID targets in registration.' },
  { id: 'laptop',   name: 'Field laptop',         desc: 'Needed for on-site registration. No laptop = work back at the office.' },
  { id: 'cables',   name: 'Cables & charger',     desc: 'Transfer cables. Without them data transfer is unreliable.' },
  { id: 'ppe',      name: 'PPE (helmet, vest, boots)', desc: 'Site safety. No PPE → no access outside the hall!' },
  { id: 'weather',  name: 'Weather cover',        desc: 'It is raining outside. Uncovered outside scans get noisy.' },
  { id: 'tape',     name: 'Measuring tape',       desc: 'For target heights and checks.' },
  { id: 'notebook', name: 'Notebook & pen',       desc: 'Paper backup of scan log. Customers like it.' },
  { id: 'coffee',   name: 'Coffee thermos',       desc: 'Morale. The customer notices.' },
];
G.VAN_SLOTS = 8;

G.PALETTE = ['#ff6b6b','#feca57','#48dbfb','#1dd1a1','#f368e0','#ff9f43',
             '#a29bfe','#55efc4','#74b9ff','#e17055','#fd79a8','#00cec9'];

/* Build all line segments: blockers (rays stop) + surfaces (coverage is measured on them) */
G.buildSegments = function () {
  const segs = [];
  const addRect = (r) => {
    segs.push({ x1: r.x,     y1: r.y,     x2: r.x + r.w, y2: r.y,     kind: 'wall' });
    segs.push({ x1: r.x + r.w, y1: r.y,   x2: r.x + r.w, y2: r.y + r.h, kind: 'wall' });
    segs.push({ x1: r.x + r.w, y1: r.y + r.h, x2: r.x,   y2: r.y + r.h, kind: 'wall' });
    segs.push({ x1: r.x,     y1: r.y + r.h, x2: r.x,     y2: r.y,     kind: 'wall' });
  };
  const w = G.MAP.world;
  addRect(w);                                   // site boundary
  const h = G.MAP.hall;
  const d = h.door;
  // hall walls (east wall split by the door opening)
  segs.push({ x1: h.x, y1: h.y, x2: h.x + h.w, y2: h.y, kind: 'wall' });
  segs.push({ x1: h.x, y1: h.y + h.h, x2: h.x + h.w, y2: h.y + h.h, kind: 'wall' });
  segs.push({ x1: h.x, y1: h.y, x2: h.x, y2: h.y + h.h, kind: 'wall' });
  segs.push({ x1: h.x + h.w, y1: h.y, x2: h.x + h.w, y2: d.y1, kind: 'wall' });
  segs.push({ x1: h.x + h.w, y1: d.y2, x2: h.x + h.w, y2: h.y + h.h, kind: 'wall' });
  G.MAP.pillars.forEach(p => addRect({ ...p, kind: 'pillar' }));
  G.MAP.outside.forEach(o => addRect({ ...o, kind: 'outside' }));
  return segs;
};

/* Discretized surface cells used for the coverage measurement */
G.buildCells = function (segs, step = 6, cell = 12) {
  const cells = new Map();
  for (const s of segs) {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const n = Math.max(1, Math.floor(len / step));
    for (let i = 0; i <= n; i++) {
      const x = s.x1 + (s.x2 - s.x1) * (i / n);
      const y = s.y1 + (s.y2 - s.y1) * (i / n);
      const key = Math.round(x / cell) + ',' + Math.round(y / cell);
      if (!cells.has(key)) cells.set(key, { x, y });
    }
  }
  return cells;
};
