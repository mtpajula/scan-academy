/* ============================================================
   utils.js — geometry helpers
   ============================================================ */
window.G = window.G || {};

G.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/* Intersect ray (o + t*d, t>0) with segment s. Returns t or null. */
G.raySeg = function (ox, oy, dx, dy, s) {
  const rx = s.x2 - s.x1, ry = s.y2 - s.y1;
  const den = dx * ry - dy * rx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((s.x1 - ox) * ry - (s.y1 - oy) * rx) / den;
  const u = ((s.x1 - ox) * dy - (s.y1 - oy) * dx) / den;
  if (t > 0.001 && u >= -1e-9 && u <= 1 + 1e-9) return t;
  return null;
};

/* Do segments a and b properly cross each other? (epsilon avoids endpoint touches) */
G.segsCross = function (a, b) {
  const o1 = (a.x2 - a.x1) * (b.y1 - a.y1) - (a.y2 - a.y1) * (b.x1 - a.x1);
  const o2 = (a.x2 - a.x1) * (b.y2 - a.y1) - (a.y2 - a.y1) * (b.x2 - a.x1);
  const o3 = (b.x2 - b.x1) * (a.y1 - b.y1) - (b.y2 - b.y1) * (a.x1 - b.x1);
  const o4 = (b.x2 - b.x1) * (a.y2 - b.y1) - (b.y2 - b.y1) * (a.x2 - b.x1);
  const eps = 0.5;
  return (o1 * o2 < -eps) && (o3 * o4 < -eps);
};

/* Line of sight between two points, blocked by any segment */
G.losClear = function (ax, ay, bx, by, segs) {
  const q = { x1: ax, y1: ay, x2: bx, y2: by };
  for (const s of segs) {
    if (G.segsCross(q, s)) return false;
  }
  return true;
};

/* Distance from point to segment */
G.distPointSeg = function (px, py, s) {
  const vx = s.x2 - s.x1, vy = s.y2 - s.y1;
  const L = vx * vx + vy * vy;
  const t = L ? G.clamp(((px - s.x1) * vx + (py - s.y1) * vy) / L, 0, 1) : 0;
  return Math.hypot(px - (s.x1 + vx * t), py - (s.y1 + vy * t));
};

/* Smallest absolute difference between two angles */
G.angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/* Pick n well-spread points (farthest-point sampling) */
G.spreadSample = function (pts, n) {
  if (pts.length <= n) return pts.slice();
  const out = [pts[0]];
  while (out.length < n) {
    let best = null, bd = -1;
    for (const p of pts) {
      let d = Infinity;
      for (const q of out) d = Math.min(d, (p.x - q.x) ** 2 + (p.y - q.y) ** 2);
      if (d > bd) { bd = d; best = p; }
    }
    out.push(best);
  }
  return out;
};

G.pointInRect = function (x, y, r, pad = 0) {
  return x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad;
};

G.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
G.lerp = (a, b, t) => a + (b - a) * t;
G.ease = (t) => t * t * (3 - 2 * t);
G.rnd = (lo, hi) => lo + Math.random() * (hi - lo);

/* One-shot toast message */
G.toast = function (msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(G._toastTimer);
  G._toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
};
