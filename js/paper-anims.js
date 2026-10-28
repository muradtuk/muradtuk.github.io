/* paper-anims.js — cinematic concept animations, one per paper thumbnail.
   Dark tiles, glowing particles, light trails. Each piece is drawn in a
   160x100 logical space scaled to cover its plate. Only tiles near the
   viewport run; hovering a card speeds its tile up.
   URL flags: ?anim=off keeps the static figures; ?animt=<seconds> freezes
   every tile at that moment (used for review screenshots). */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  if (q.get('anim') === 'off') return;
  var fixedT = q.get('animt') !== null ? parseFloat(q.get('animt')) : null;
  if (fixedT !== null && isNaN(fixedT)) fixedT = null;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 160, H = 100, TAU = Math.PI * 2;
  var P = { teal: '#2dd4bf', cyan: '#38bdf8', amber: '#fbbf24', pink: '#fb7185', violet: '#a78bfa', lime: '#d9f05a', white: '#e2e8f0' };

  /* ---------- helpers ---------- */
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(str) { var h = 2166136261, i; for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function ease(u) { u = clamp(u, 0, 1); return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
  function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }
  function hexa(hex, a) { return 'rgba(' + parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) + ',' + parseInt(hex.slice(5, 7), 16) + ',' + clamp(a, 0, 1).toFixed(3) + ')'; }
  function noise(k, j, seed) { var n = Math.sin(k * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return n - Math.floor(n); }
  function dot(ctx, x, y, r, fill) { if (r <= 0) return; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
  function ring(ctx, x, y, r, color, lw, dash) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = color; ctx.lineWidth = lw || 1; if (dash) ctx.setLineDash(dash); ctx.stroke(); if (dash) ctx.setLineDash([]); }
  function line(ctx, x1, y1, x2, y2, color, lw, dash) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = lw || 1; if (dash) ctx.setLineDash(dash); ctx.stroke(); if (dash) ctx.setLineDash([]); }
  function glow(ctx, x, y, r, color, a) { if (r <= 0 || a <= 0) return; var g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, hexa(color, a)); g.addColorStop(1, hexa(color, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function neon(ctx, pts, color, w, a) { if (pts.length < 2) return; a = a === undefined ? 1 : a; var i; ctx.beginPath(); for (i = 0; i < pts.length; i++) { i ? ctx.lineTo(pts[i][0], pts[i][1]) : ctx.moveTo(pts[i][0], pts[i][1]); } ctx.strokeStyle = hexa(color, 0.22 * a); ctx.lineWidth = w * 4; ctx.stroke(); ctx.strokeStyle = hexa(color, 0.95 * a); ctx.lineWidth = w; ctx.stroke(); }
  function poly(ctx, pts, fill, stroke, lw) { ctx.beginPath(); pts.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); } }
  function comet(ctx, x, y, color) { glow(ctx, x, y, 7, color, 0.9); dot(ctx, x, y, 1.8, P.white); }
  function walk(pts, cum, d) { var i, out = [pts[0]]; for (i = 1; i < pts.length; i++) { if (cum[i] <= d) out.push(pts[i]); else { var f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); out.push([lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)]); break; } } return out; }
  function cumlen(pts) { var c = [0], i; for (i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; }

  var A = {};
  /* Each piece: period (s), still (review moment), fade (per-frame darkening:
     1 = clear, smaller = light trails), init(r) -> state, draw(ctx, s, t, dt, u, T)
     where t = time inside the cycle, u = t/period, T = total running time. */

  /* 1. Submodular maximization: a drifting constellation; greedy lights up a
        chain of picks while the objective curve climbs with diminishing returns. */
  A.submodular = {
    period: 8, still: 5.4, fade: 1,
    init: function (r) {
      var pts = [], i, k = 9;
      for (i = 0; i < 90; i++) pts.push({ a: r() * TAU, rad: 8 + Math.pow(r(), 0.6) * 46, sp: (0.05 + r() * 0.12) * (r() < 0.5 ? 1 : -1), tw: r() * TAU, gain: r() });
      var order = pts.map(function (_, j) { return j; }).sort(function (a, b) { return pts[b].gain - pts[a].gain; }).slice(0, k);
      var f = [0], g = 1, tot = 0, gains = [], acc = 0;
      for (i = 0; i < k; i++) { g *= 0.72 + 0.1 * (i % 2); gains.push(g); tot += g; }
      gains.forEach(function (x) { acc += x; f.push(acc / (tot * 1.5)); });
      return { pts: pts, order: order, f: f, k: k };
    },
    draw: function (ctx, s, t, dt, u, T) {
      var k = s.k, picks = u < 0.86 ? clamp(Math.floor((u - 0.1) / 0.07) + 1, 0, k) : 0, fr = u < 0.1 ? 0 : ((u - 0.1) % 0.07) / 0.07, i;
      var pos = s.pts.map(function (p) { var a = p.a + T * p.sp; return [58 + Math.cos(a) * p.rad, 50 + Math.sin(a) * p.rad * 0.62]; });
      ctx.globalCompositeOperation = 'lighter';
      s.pts.forEach(function (p, j) { var q2 = pos[j]; dot(ctx, q2[0], q2[1], 1.1, hexa(P.cyan, 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(T * 2 + p.tw)))); });
      var picked = s.order.slice(0, picks);
      for (i = 1; i < picked.length; i++) { var a1 = pos[picked[i - 1]], b1 = pos[picked[i]], fl = i === picked.length - 1 ? ease(fr) : 1; line(ctx, a1[0], a1[1], lerp(a1[0], b1[0], fl), lerp(a1[1], b1[1], fl), hexa(P.amber, 0.5), 1); }
      picked.forEach(function (idx, n) { var q2 = pos[idx], last = n === picks - 1, pulse = last ? Math.sin(Math.PI * clamp(fr * 1.5, 0, 1)) : 0; glow(ctx, q2[0], q2[1], 7 + 6 * pulse, P.amber, 0.5 + 0.4 * pulse); dot(ctx, q2[0], q2[1], 2 + pulse, P.amber); if (last && fr < 0.7) ring(ctx, q2[0], q2[1], 4 + 16 * fr, hexa(P.amber, 0.6 * (1 - fr / 0.7)), 1); });
      ctx.globalCompositeOperation = 'source-over';
      var x0 = 118, x1 = 152, y0 = 84, y1 = 18, pts2 = [];
      line(ctx, x0, y0, x1, y0, hexa(P.white, 0.25), 1); line(ctx, x0, y0, x0, y1, hexa(P.white, 0.25), 1); line(ctx, x0, y1 + 3, x1, y1 + 3, hexa(P.white, 0.35), 1, [2, 3]);
      for (i = 0; i <= picks; i++) pts2.push([x0 + (x1 - x0) * i / k, y0 - (y0 - y1) * s.f[i]]);
      neon(ctx, pts2, P.teal, 1.2);
      pts2.forEach(function (p2, i2) { if (i2) dot(ctx, p2[0], p2[1], 1.6, P.teal); });
    }
  };

  /* 2. Drifters: a living current field; floaters released at the computed
        spots ride it straight through the segment centres. */
  A.drifters = {
    period: 9, still: 4.3, fade: 0.1,
    init: function (r) {
      function v(x, y) { return [9 * Math.sin(y * 0.075 + 1.2) + 5 * Math.cos(x * 0.05 + 0.4), 7 * Math.cos(x * 0.06 + 0.3) - 4.5 * Math.sin(y * 0.08 + 0.7)]; }
      var flow = [], i, centers = [[42, 30], [112, 26], [64, 72], [126, 70]], T = 3.2, dt = 1 / 60, drifters = [];
      for (i = 0; i < 170; i++) flow.push({ x: r() * W, y: r() * H, age: r() * 4, life: 2 + r() * 3 });
      centers.forEach(function (c) { var x = c[0], y = c[1], n = Math.round(T / dt), j; for (j = 0; j < n; j++) { var f = v(x, y); x -= f[0] * dt; y -= f[1] * dt; } var pth = [], px = x, py = y; n = Math.round(6.8 / dt); for (j = 0; j <= n; j++) { pth.push([px, py]); var g = v(px, py); px += g[0] * dt; py += g[1] * dt; } drifters.push({ x0: x, y0: y, path: pth }); });
      return { v: v, flow: flow, centers: centers, drifters: drifters, T: T, dt: dt, r: r };
    },
    draw: function (ctx, s, t, dt) {
      s.flow.forEach(function (p) { var f = s.v(p.x, p.y), nx = p.x + f[0] * dt * 2.2, ny = p.y + f[1] * dt * 2.2; p.age += dt; var a = Math.sin(Math.PI * clamp(p.age / p.life, 0, 1)); line(ctx, p.x, p.y, nx, ny, hexa(P.teal, 0.55 * a), 1); p.x = nx; p.y = ny; if (p.age > p.life || nx < -2 || nx > W + 2 || ny < -2 || ny > H + 2) { p.x = s.r() * W; p.y = s.r() * H; p.age = 0; p.life = 2 + s.r() * 3; } });
      var tau = t - 1.0;
      s.centers.forEach(function (c) { var hit = tau > s.T - 0.3 && tau < s.T + 1.0, pulse = hit ? 0.5 + 0.5 * Math.sin(t * 10) : 0; glow(ctx, c[0], c[1], 9 + 6 * pulse, P.teal, 0.25 + 0.5 * pulse); ring(ctx, c[0], c[1], 3.5, hexa(P.white, 0.85), 1); });
      s.drifters.forEach(function (d) { if (tau < 0) { var a = ease(t / 1.0); glow(ctx, d.x0, d.y0, 6 * a, P.amber, 0.5); dot(ctx, d.x0, d.y0, 2 * a, P.amber); return; } var idx = Math.min(d.path.length - 1, Math.floor(tau / s.dt)), q2 = d.path[idx]; comet(ctx, q2[0], q2[1], P.amber); });
    }
  };

  /* 3. General vs down-closed convex sets: a comet performs Frank-Wolfe steps
        inside the neon body; the down-closed part glows teal. */
  A.bridging = {
    period: 8, still: 5.6, fade: 0.14,
    init: function () {
      var o = [16, 86]; function Pt(x, y) { return [o[0] + x, o[1] - y]; }
      var K = [Pt(0, 0), Pt(70, 0), Pt(118, 18), Pt(132, 52), Pt(108, 72), Pt(60, 70), Pt(0, 44)], D = [Pt(0, 0), Pt(70, 0), Pt(70, 26), Pt(44, 44), Pt(0, 44)];
      var target = Pt(96, 48), x = Pt(2, 2), pth = [x], steps = [], i;
      for (i = 0; i < 12; i++) { var g = [target[0] - x[0], target[1] - x[1]], best = null, bv = -Infinity; K.forEach(function (vtx) { var val = (vtx[0] - x[0]) * g[0] + (vtx[1] - x[1]) * g[1]; if (val > bv) { bv = val; best = vtx; } }); var gm = 2 / (i + 2); x = [x[0] + gm * (best[0] - x[0]), x[1] + gm * (best[1] - x[1])]; steps.push(best); pth.push(x); }
      return { K: K, D: D, target: target, path: pth, steps: steps };
    },
    draw: function (ctx, s, t, dt, u) {
      poly(ctx, s.D, 'rgba(45,212,191,0.12)', null);
      neon(ctx, s.K.concat([s.K[0]]), P.amber, 0.9); neon(ctx, s.D.concat([s.D[0]]), P.teal, 0.8);
      var n = s.steps.length, prog = clamp((u - 0.08) / 0.8, 0, 1) * n, k = Math.floor(prog), f = prog - k, cur = s.path[k];
      if (k < n) { var nx = s.path[k + 1], v = s.steps[k]; cur = [lerp(s.path[k][0], nx[0], ease(f)), lerp(s.path[k][1], nx[1], ease(f))]; line(ctx, s.path[k][0], s.path[k][1], v[0], v[1], hexa(P.white, 0.3 * (1 - f)), 0.8, [2, 3]); glow(ctx, v[0], v[1], 7, P.white, 0.6 * (1 - f)); }
      glow(ctx, s.target[0], s.target[1], 9, P.cyan, 0.3 + 0.2 * Math.sin(t * 3)); ring(ctx, s.target[0], s.target[1], 3, hexa(P.cyan, 0.9), 1);
      comet(ctx, cur[0], cur[1], P.amber);
    }
  };

  /* 4. Size and error of distilled datasets: a sample cloud streams into six
        synthetic points along curved paths while the regression curve stays. */
  A['distill-theory'] = {
    period: 9, still: 5.0, fade: 0.12,
    init: function (r) {
      function f(x) { return 54 + 22 * Math.sin((x - 10) / 24) * Math.cos((x - 10) / 61); }
      var pts = [], syn = [], curve = [], i, m = 6;
      for (i = 0; i < m; i++) { var sx = 20 + i * (120 / (m - 1)); syn.push({ x: sx, y: f(sx) }); }
      for (i = 0; i < 72; i++) { var x = 10 + r() * 140, y = f(x) + gauss(r) * 6, best = 0, bd = 1e9; syn.forEach(function (q2, j) { var d = Math.abs(x - q2.x); if (d < bd) { bd = d; best = j; } }); pts.push({ x: x, y: y, rep: best, bulge: (r() - 0.5) * 26, tw: r() * TAU }); }
      for (i = 0; i <= 70; i++) curve.push([10 + i * 2, f(10 + i * 2)]);
      return { pts: pts, syn: syn, curve: curve };
    },
    draw: function (ctx, s, t, dt, u, T) {
      var c = u < 0.3 ? 0 : u < 0.5 ? ease((u - 0.3) / 0.2) : u < 0.78 ? 1 : 1 - ease((u - 0.78) / 0.22);
      neon(ctx, s.curve, P.teal, 0.9, 0.9);
      s.pts.forEach(function (p) { var q2 = s.syn[p.rep], mx = lerp(p.x, q2.x, c), my = lerp(p.y, q2.y, c) + Math.sin(Math.PI * c) * p.bulge, a = 1 - 0.85 * c; dot(ctx, mx, my, 1.3, hexa(P.cyan, a * (0.6 + 0.4 * Math.sin(T * 3 + p.tw)))); });
      if (c > 0) s.syn.forEach(function (q2) { glow(ctx, q2.x, q2.y, 5 + 5 * c, P.amber, 0.55 * c); ctx.fillStyle = hexa(P.amber, c); ctx.fillRect(q2.x - 2.5, q2.y - 2.5, 5, 5); });
    }
  };

  /* 5. Coresets for RBF networks: weighted centres bloom as radial fields that
        cover the data; the amber suns are the coreset. */
  A.rbfnn = {
    period: 8, still: 5.6, fade: 1,
    init: function (r) {
      var centers = [{ x: 36, y: 44, w: 1.0, rad: 26 }, { x: 78, y: 30, w: 0.7, rad: 20 }, { x: 118, y: 56, w: 1.1, rad: 28 }, { x: 60, y: 76, w: 0.5, rad: 16 }, { x: 100, y: 80, w: 0.6, rad: 17 }], pts = [], i;
      for (i = 0; i < 72; i++) { var c = centers[i % centers.length]; pts.push({ x: clamp(c.x + gauss(r) * c.rad * 0.6, 3, 157), y: clamp(c.y + gauss(r) * c.rad * 0.6, 3, 97), tw: r() * TAU }); }
      return { centers: centers, pts: pts };
    },
    draw: function (ctx, s, t, dt, u, T) {
      var n = s.centers.length, prog = clamp((u - 0.15) / 0.5, 0, 1) * n, fadeOut = u > 0.9 ? 1 - 0.75 * (u - 0.9) / 0.1 : 1;
      ctx.globalCompositeOperation = 'lighter';
      s.centers.forEach(function (c, j) { var a = clamp(prog - j, 0, 1) * fadeOut; if (a > 0) glow(ctx, c.x, c.y, c.rad * 1.6 * (1 + 0.08 * Math.sin(T * 2 + j)), P.teal, 0.45 * a * c.w); });
      s.pts.forEach(function (p) { var covered = s.centers.some(function (c, j) { return clamp(prog - j, 0, 1) > 0.5 && Math.hypot(p.x - c.x, p.y - c.y) < c.rad; }); dot(ctx, p.x, p.y, 1.2, hexa(P.white, (covered ? 0.95 : 0.35) * (0.7 + 0.3 * Math.sin(T * 4 + p.tw)))); });
      s.centers.forEach(function (c, j) { var a = clamp(prog - j, 0, 1) * fadeOut; if (a <= 0) return; glow(ctx, c.x, c.y, 8, P.amber, 0.8 * a); dot(ctx, c.x, c.y, 1.6 + 2 * c.w * a, P.amber); ring(ctx, c.x, c.y, c.rad * a, hexa(P.amber, 0.45 * a), 0.8); });
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  /* 6. AutoCoreset: loss vectors chain tip to tail like lightning; two weighted
        vectors then strike the very same endpoint. */
  A.autocoreset = {
    period: 8, still: 6.3, fade: 0.16,
    init: function (r) {
      var vecs = [], i;
      for (i = 0; i < 10; i++) { var ang = -0.5 + (r() - 0.5) * 1.5, len = 8 + r() * 7; vecs.push([Math.cos(ang) * len, Math.sin(ang) * len]); }
      var tot = vecs.reduce(function (a, v) { return [a[0] + v[0], a[1] + v[1]]; }, [0, 0]), ta = Math.atan2(tot[1], tot[0]), lo = null, hi = null;
      vecs.forEach(function (v, j) { var a = Math.atan2(v[1], v[0]) - ta; if (a <= 0 && (!lo || a > lo.a)) lo = { j: j, a: a }; if (a > 0 && (!hi || a < hi.a)) hi = { j: j, a: a }; });
      if (!lo || !hi) { lo = { j: 0 }; hi = { j: 1 }; }
      var v1 = vecs[lo.j], v2 = vecs[hi.j], det = v1[0] * v2[1] - v1[1] * v2[0] || 1e-6, w1 = (tot[0] * v2[1] - tot[1] * v2[0]) / det, w2 = (v1[0] * tot[1] - v1[1] * tot[0]) / det;
      var o = [22, 86], chain = [o]; vecs.forEach(function (v) { var l = chain[chain.length - 1]; chain.push([l[0] + v[0], l[1] + v[1]]); });
      var s1 = [o[0] + v1[0] * w1, o[1] + v1[1] * w1], sub = [o, s1, [s1[0] + v2[0] * w2, s1[1] + v2[1] * w2]];
      return { chain: chain, cum: cumlen(chain), sub: sub, cum2: cumlen(sub), tot: [o[0] + tot[0], o[1] + tot[1]] };
    },
    draw: function (ctx, s, t, dt, u) {
      var p1 = clamp(u / 0.42, 0, 1), pts = walk(s.chain, s.cum, p1 * s.cum[s.cum.length - 1]);
      neon(ctx, pts, P.cyan, 0.8);
      var h = pts[pts.length - 1]; if (p1 < 1) comet(ctx, h[0], h[1], P.cyan);
      if (p1 >= 1) { glow(ctx, s.tot[0], s.tot[1], 9, P.cyan, 0.5); ring(ctx, s.tot[0], s.tot[1], 3, hexa(P.white, 0.9), 1); }
      var p2 = clamp((u - 0.5) / 0.3, 0, 1);
      if (p2 > 0) { var pts2 = walk(s.sub, s.cum2, p2 * s.cum2[s.cum2.length - 1]); neon(ctx, pts2, P.amber, 1.6); var h2 = pts2[pts2.length - 1]; if (p2 < 1) comet(ctx, h2[0], h2[1], P.amber); }
      if (p2 >= 1) ring(ctx, s.tot[0], s.tot[1], 6 + 1.5 * Math.sin(t * 4), hexa(P.amber, 0.75), 1, [2, 3]);
    }
  };

  /* 7. Pruning: signal pulses stream through a network; low-importance neurons
        go dark while the survivors burn amber and accuracy holds. */
  A.pruning = {
    period: 9, still: 6.6, fade: 0.25,
    init: function (r) {
      var L = [[], [], []], edges = [], i, j;
      for (i = 0; i < 5; i++) L[0].push([22, 18 + i * 16]); for (i = 0; i < 8; i++) L[1].push([80, 10 + i * 11.4]); for (i = 0; i < 3; i++) L[2].push([138, 30 + i * 20]);
      for (i = 0; i < 5; i++) for (j = 0; j < 8; j++) edges.push({ a: L[0][i], b: L[1][j], h: j });
      for (j = 0; j < 8; j++) for (i = 0; i < 3; i++) edges.push({ a: L[1][j], b: L[2][i], h: j });
      var imp = L[1].map(function () { return r(); }), order = imp.map(function (_, j2) { return j2; }).sort(function (a, b) { return imp[a] - imp[b]; });
      return { L: L, edges: edges, order: order.slice(0, 5), keep: order.slice(5), pulses: [], r: r, spawn: 0 };
    },
    draw: function (ctx, s, t, dt, u) {
      var pruned = u >= 0.85 ? 5 : clamp(Math.floor((u - 0.2) / 0.11) + 1, 0, 5), f = u < 0.2 ? 0 : clamp(((u - 0.2) % 0.11) / 0.11, 0, 1), alpha = s.L[1].map(function () { return 1; });
      s.order.forEach(function (idx, n) { if (n < pruned - 1) alpha[idx] = 0.08; else if (n === pruned - 1) alpha[idx] = 1 - 0.92 * ease(f); });
      s.edges.forEach(function (e) { line(ctx, e.a[0], e.a[1], e.b[0], e.b[1], hexa(P.cyan, 0.16 * alpha[e.h]), 0.7); });
      s.spawn += dt * 16;
      while (s.spawn > 1) { s.spawn -= 1; var e = s.edges[Math.floor(s.r() * s.edges.length)]; if (alpha[e.h] > 0.5) s.pulses.push({ e: e, p: 0, sp: 0.6 + s.r() * 0.5 }); }
      s.pulses = s.pulses.filter(function (pl) { pl.p += dt * pl.sp; return pl.p < 1; });
      s.pulses.forEach(function (pl) { if (alpha[pl.e.h] < 0.5) return; var x = lerp(pl.e.a[0], pl.e.b[0], pl.p), y = lerp(pl.e.a[1], pl.e.b[1], pl.p), kept = s.keep.indexOf(pl.e.h) >= 0 && pruned >= 5; dot(ctx, x, y, 1.1, hexa(kept ? P.amber : P.cyan, 0.95)); });
      s.L[0].forEach(function (p) { dot(ctx, p[0], p[1], 2.2, hexa(P.white, 0.85)); }); s.L[2].forEach(function (p) { dot(ctx, p[0], p[1], 2.2, hexa(P.white, 0.85)); });
      s.L[1].forEach(function (p, j) { var kept = s.keep.indexOf(j) >= 0 && pruned >= 5, col = kept ? P.amber : P.teal; glow(ctx, p[0], p[1], 6, col, 0.6 * alpha[j]); dot(ctx, p[0], p[1], kept ? 3 : 2.4, hexa(col, alpha[j])); });
      line(ctx, 118, 93, 152, 93, hexa(P.white, 0.15), 3); line(ctx, 118, 93, 118 + 34 * (0.98 - 0.012 * pruned), 93, P.teal, 3);
    }
  };

  /* 8. Obstacle-aware sampling: samples rain down, enclosing ellipsoids snap
        around the obstacles, an RRT tree grows and the path lights up. */
  A.obstacle = {
    period: 10, still: 8.6, fade: 0.2,
    init: function (r) {
      var obs = [[[30, 22], [58, 16], [66, 40], [44, 52], [26, 44]], [[84, 58], [112, 50], [124, 74], [102, 92], [80, 82]], [[112, 12], [146, 18], [140, 40], [118, 36]]], i;
      function inside(p, pg) { var c = false, a, b, k, j; for (k = 0, j = pg.length - 1; k < pg.length; j = k++) { a = pg[k]; b = pg[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
      var ell = obs.map(function (pg) { var n = pg.length, mx = 0, my = 0; pg.forEach(function (p) { mx += p[0] / n; my += p[1] / n; }); var sxx = 0, syy = 0, sxy = 0; pg.forEach(function (p) { var dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx / n; syy += dy * dy / n; sxy += dx * dy / n; }); var tr = (sxx + syy) / 2, d = Math.sqrt(((sxx - syy) / 2) * ((sxx - syy) / 2) + sxy * sxy); return { x: mx, y: my, a: 1.6 * Math.sqrt(tr + d), b: 1.6 * Math.sqrt(Math.max(1e-6, tr - d)), ang: 0.5 * Math.atan2(2 * sxy, sxx - syy) }; });
      function inEll(p) { return ell.some(function (e) { var dx = p[0] - e.x, dy = p[1] - e.y, c = Math.cos(e.ang), sn = Math.sin(e.ang), xr = dx * c + dy * sn, yr = -dx * sn + dy * c; return (xr * xr) / (e.a * e.a) + (yr * yr) / (e.b * e.b) < 1.15; }); }
      var samples = []; for (i = 0; i < 60; i++) { var p = [6 + r() * 148, 6 + r() * 88]; samples.push({ p: p, hit: obs.some(function (o) { return inside(p, o); }) }); }
      var start = [8, 92], goal = [154, 10], nodes = [{ p: start, parent: -1 }], tries = 0, goalIdx = -1;
      while (nodes.length < 110 && tries < 700) {
        tries++;
        var sm = r() < 0.1 ? goal : [r() * W, r() * H], best = 0, bd = 1e9;
        nodes.forEach(function (nd, j) { var d = Math.hypot(nd.p[0] - sm[0], nd.p[1] - sm[1]); if (d < bd) { bd = d; best = j; } });
        var np = nodes[best].p, dx = sm[0] - np[0], dy = sm[1] - np[1], Ld = Math.hypot(dx, dy) || 1, step = Math.min(11, Ld), q2 = [np[0] + dx / Ld * step, np[1] + dy / Ld * step];
        if (q2[0] < 2 || q2[0] > 158 || q2[1] < 2 || q2[1] > 98) continue;
        if (inEll(q2) || inEll([(np[0] + q2[0]) / 2, (np[1] + q2[1]) / 2])) continue;
        nodes.push({ p: q2, parent: best });
        if (goalIdx < 0 && Math.hypot(q2[0] - goal[0], q2[1] - goal[1]) < 12) goalIdx = nodes.length - 1;
      }
      if (goalIdx < 0) { var bd2 = 1e9; nodes.forEach(function (nd, j) { var d = Math.hypot(nd.p[0] - goal[0], nd.p[1] - goal[1]); if (d < bd2) { bd2 = d; goalIdx = j; } }); }
      var pth = [goal], cur = goalIdx; while (cur >= 0) { pth.push(nodes[cur].p); cur = nodes[cur].parent; } pth.reverse();
      return { obs: obs, ell: ell, samples: samples, nodes: nodes, path: pth, plen: cumlen(pth), start: start, goal: goal };
    },
    draw: function (ctx, s, t, dt, u) {
      s.obs.forEach(function (o) { poly(ctx, o, 'rgba(148,163,184,0.14)', hexa(P.white, 0.4), 0.8); });
      var ns = Math.floor(clamp(u / 0.26, 0, 1) * s.samples.length), fadeHits = clamp((u - 0.28) / 0.12, 0, 1), i;
      for (i = 0; i < ns; i++) { var sm = s.samples[i]; if (sm.hit) { var a = 1 - 0.92 * fadeHits; glow(ctx, sm.p[0], sm.p[1], 4, P.pink, 0.5 * a); dot(ctx, sm.p[0], sm.p[1], 1.2, hexa(P.pink, a)); } else dot(ctx, sm.p[0], sm.p[1], 1.1, hexa(P.teal, 0.8)); }
      var eg = clamp((u - 0.3) / 0.14, 0, 1);
      if (eg > 0) s.ell.forEach(function (e) { ctx.beginPath(); ctx.ellipse(e.x, e.y, e.a * eg, e.b * eg, e.ang, 0, TAU); ctx.strokeStyle = hexa(P.amber, 0.85); ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]); });
      var tg = clamp((u - 0.45) / 0.3, 0, 1) * (s.nodes.length - 1), kn = Math.floor(tg);
      for (i = 1; i <= kn; i++) { var nd = s.nodes[i], pp = s.nodes[nd.parent].p; line(ctx, pp[0], pp[1], nd.p[0], nd.p[1], hexa(P.teal, 0.4), 0.8); }
      if (kn > 0 && kn < s.nodes.length - 1) { var nn = s.nodes[kn]; glow(ctx, nn.p[0], nn.p[1], 5, P.teal, 0.9); }
      var d = clamp((u - 0.76) / 0.18, 0, 1) * s.plen[s.plen.length - 1];
      if (d > 0) { var pts = walk(s.path, s.plen, d); neon(ctx, pts, P.amber, 1.3); var h = pts[pts.length - 1]; if (u < 0.94) comet(ctx, h[0], h[1], P.amber); }
      glow(ctx, s.start[0], s.start[1], 6, P.white, 0.6); dot(ctx, s.start[0], s.start[1], 2, P.white);
      glow(ctx, s.goal[0], s.goal[1], 8, P.cyan, 0.5 + 0.3 * Math.sin(t * 4)); ring(ctx, s.goal[0], s.goal[1], 3, hexa(P.cyan, 0.9), 1);
    }
  };

  /* 9. Projective clustering: a rotating 3D point cloud living on two lines;
        the coreset points burn amber. */
  A.projective = {
    period: 12, still: 4, fade: 1,
    init: function (r) {
      var pts = [], i, dirs = [[0.8, 0.3, 0.5], [-0.4, 0.85, 0.3]];
      dirs = dirs.map(function (d) { var L = Math.hypot(d[0], d[1], d[2]); return [d[0] / L, d[1] / L, d[2] / L]; });
      dirs.forEach(function (d, li) { for (i = 0; i < 42; i++) { var sp = (r() - 0.5) * 2; pts.push({ p: [d[0] * sp + gauss(r) * 0.04, d[1] * sp + gauss(r) * 0.04, d[2] * sp + gauss(r) * 0.04], c: li, s: Math.abs(sp) }); } });
      for (i = 0; i < 10; i++) pts.push({ p: [(r() - 0.5) * 1.6, (r() - 0.5) * 1.6, (r() - 0.5) * 1.6], c: -1, s: 0 });
      var core = pts.map(function (_, j) { return j; }).sort(function (a, b) { return pts[b].s - pts[a].s; }).slice(0, 10);
      return { pts: pts, dirs: dirs, core: core };
    },
    draw: function (ctx, s, t, dt, u, T) {
      var ry = T * 0.5, rx = 0.45 + 0.15 * Math.sin(T * 0.3), cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
      function proj(p) { var x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy, y = p[1] * cx - z * sx; z = p[1] * sx + z * cx; var f = 2.4 / (2.4 + z); return [80 + x * 44 * f, 50 + y * 44 * f, z]; }
      ctx.globalCompositeOperation = 'lighter';
      s.dirs.forEach(function (d, li) { var a = proj([-d[0], -d[1], -d[2]]), b = proj(d); neon(ctx, [a, b], li ? P.teal : P.cyan, 0.8, 0.8); });
      var pulse = 0.5 + 0.5 * Math.sin(T * 2);
      s.pts.forEach(function (p, j) { var q2 = proj(p.p), depth = clamp((q2[2] + 1.2) / 2.4, 0, 1), rad = 0.9 + 1.1 * (1 - depth), col = p.c === 0 ? P.cyan : p.c === 1 ? P.teal : P.white; dot(ctx, q2[0], q2[1], rad, hexa(col, 0.35 + 0.6 * (1 - depth))); if (s.core.indexOf(j) >= 0) { glow(ctx, q2[0], q2[1], 5 + 2 * pulse, P.amber, 0.6); dot(ctx, q2[0], q2[1], rad + 0.6, hexa(P.amber, 0.95)); } });
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  /* 10. Sine wave fitting: an oscilloscope with phosphor afterglow; the
         frequency sweeps until the trace locks onto the samples. */
  A.sine = {
    period: 9, still: 7.3, fade: 0.22,
    init: function (r) {
      var N = 48, pts = [], used = {};
      while (pts.length < 16) { var p = Math.floor(r() * N); if (used[p]) continue; used[p] = 1; pts.push(p); }
      pts.sort(function (a, b) { return a - b; });
      return { N: N, cstar: 3, pts: pts, core: pts.slice().sort(function () { return r() - 0.5; }).slice(0, 6) };
    },
    draw: function (ctx, s, t, dt, u) {
      var x0 = 8, x1 = 152, mid = 50, amp = 28, i, pts = [];
      function X(p) { return x0 + (x1 - x0) * p / (s.N - 1); } function Y(p, c) { return mid + amp - 2 * amp * Math.pow(Math.sin(Math.PI * p * c / s.N), 2); }
      for (i = 0; i <= 8; i++) line(ctx, x0 + (x1 - x0) * i / 8, 12, x0 + (x1 - x0) * i / 8, 88, hexa(P.white, 0.07), 0.6);
      for (i = 0; i <= 4; i++) line(ctx, x0, 12 + 19 * i, x1, 12 + 19 * i, hexa(P.white, 0.07), 0.6);
      var c = u < 0.25 ? 1 : u < 0.65 ? lerp(1, s.cstar, ease((u - 0.25) / 0.4)) : s.cstar;
      for (i = 0; i <= 144; i++) pts.push([x0 + (x1 - x0) * i / 144, Y((s.N - 1) * i / 144, c)]);
      neon(ctx, pts, P.teal, 1.0);
      var shown = Math.floor(clamp(u / 0.25, 0, 1) * s.pts.length), coreOn = clamp((u - 0.68) / 0.12, 0, 1);
      for (i = 0; i < shown; i++) { var p2 = s.pts[i], x = X(p2), y = Y(p2, s.cstar); dot(ctx, x, y, 1.6, P.white); if (s.core.indexOf(p2) >= 0 && coreOn > 0) { glow(ctx, x, y, 6, P.amber, 0.85 * coreOn); dot(ctx, x, y, 2, hexa(P.amber, coreOn)); } }
      var cost = 0; s.pts.forEach(function (p3) { var d = Y(p3, c) - Y(p3, s.cstar); cost += d * d; }); cost = Math.min(1, cost / (s.pts.length * amp * amp * 0.8));
      line(ctx, 118, 8, 152, 8, hexa(P.white, 0.15), 3); line(ctx, 118, 8, 118 + 34 * cost, 8, P.pink, 3);
    }
  };

  /* 11. SVM coresets: a neon blade swings into the margin; the support set
         flares amber and every other point dissolves into dust. */
  A.svm = {
    period: 9, still: 7.6, fade: 0.18,
    init: function (r) {
      var pts = [], i, n = 26;
      for (i = 0; i < n; i++) pts.push({ x: 52 + gauss(r) * 14, y: 62 + gauss(r) * 11, c: 0 });
      for (i = 0; i < n; i++) pts.push({ x: 108 + gauss(r) * 14, y: 36 + gauss(r) * 11, c: 1 });
      pts = pts.filter(function (p) { return p.x > 3 && p.x < 157 && p.y > 3 && p.y < 97; });
      var mid = [80, 49], nrm = [56, -26], L = Math.hypot(nrm[0], nrm[1]); nrm = [nrm[0] / L, nrm[1] / L];
      pts.forEach(function (p) { p.d = Math.abs((p.x - mid[0]) * nrm[0] + (p.y - mid[1]) * nrm[1]); p.vx = (p.x - mid[0]) * 0.3 + gauss(r) * 2; p.vy = (p.y - mid[1]) * 0.3 + gauss(r) * 2; });
      var core = pts.map(function (_, j) { return j; }).sort(function (a, b) { return pts[a].d - pts[b].d; }).slice(0, 7);
      return { pts: pts, mid: mid, ang: Math.atan2(-nrm[0], nrm[1]), core: core, margin: 9 };
    },
    draw: function (ctx, s, t, dt, u) {
      var shown = Math.floor(clamp(u / 0.25, 0, 1) * s.pts.length), fit = ease(clamp((u - 0.18) / 0.32, 0, 1)), coreOn = clamp((u - 0.55) / 0.1, 0, 1), dis = clamp((u - 0.68) / 0.22, 0, 1), i;
      var a = lerp(s.ang + 0.8, s.ang, fit), ox = lerp(s.mid[0] - 16, s.mid[0], fit), oy = lerp(s.mid[1] + 12, s.mid[1], fit), dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
      for (i = 0; i < shown; i++) { var p = s.pts[i], isCore = s.core.indexOf(i) >= 0, col = p.c ? P.pink : P.cyan, x = p.x, y = p.y, al = 0.85; if (!isCore && dis > 0) { x += p.vx * dis * 2.5; y += p.vy * dis * 2.5; al = 0.85 * (1 - dis); } if (al <= 0.01) continue; dot(ctx, x, y, 1.5, hexa(col, al)); if (isCore && coreOn > 0) { glow(ctx, x, y, 6, P.amber, 0.8 * coreOn); dot(ctx, x, y, 2, hexa(P.amber, coreOn)); } }
      neon(ctx, [[ox - dx * 90, oy - dy * 90], [ox + dx * 90, oy + dy * 90]], P.white, 1.1);
      [1, -1].forEach(function (sg) { var m = s.margin * fit * sg; line(ctx, ox + nx * m - dx * 90, oy + ny * m - dy * 90, ox + nx * m + dx * 90, oy + ny * m + dy * 90, hexa(P.white, 0.35), 0.8, [3, 3]); });
    }
  };

  /* 12. Sets clustering: each input is a small drifting constellation; two
         amber suns migrate to the closest star of every set. */
  A.sets = {
    period: 9, still: 6.8, fade: 0.15,
    init: function (r) {
      var sets = [], hubs = [[46, 40], [116, 58]], i, j, it;
      for (i = 0; i < 10; i++) { var h = hubs[i % 2], S = { cx: h[0] + gauss(r) * 16, cy: h[1] + gauss(r) * 13, off: [], rot: (r() - 0.5) * 0.5, dx: (r() - 0.5) * 3, dy: (r() - 0.5) * 3, ph: r() * TAU }; for (j = 0; j < 3; j++) S.off.push([gauss(r) * 7, gauss(r) * 6]); sets.push(S); }
      function members(S, T) { var c = Math.cos(S.rot * T), sn = Math.sin(S.rot * T), x = S.cx + Math.sin(T * 0.5 + S.ph) * S.dx, y = S.cy + Math.cos(T * 0.4 + S.ph) * S.dy; return S.off.map(function (o) { return [clamp(x + o[0] * c - o[1] * sn, 3, 157), clamp(y + o[0] * sn + o[1] * c, 3, 97)]; }); }
      var centers = [[80, 18], [84, 86]], hist = [centers.map(function (c) { return c.slice(); })];
      for (it = 0; it < 6; it++) {
        var acc = centers.map(function () { return [0, 0, 0]; });
        sets.forEach(function (S) { var best = null, bd = 1e9; members(S, 0).forEach(function (p) { centers.forEach(function (c, k) { var d = (p[0] - c[0]) * (p[0] - c[0]) + (p[1] - c[1]) * (p[1] - c[1]); if (d < bd) { bd = d; best = { p: p, k: k }; } }); }); acc[best.k][0] += best.p[0]; acc[best.k][1] += best.p[1]; acc[best.k][2]++; });
        centers = centers.map(function (c, k) { return acc[k][2] ? [acc[k][0] / acc[k][2], acc[k][1] / acc[k][2]] : c; });
        hist.push(centers.map(function (c) { return c.slice(); }));
      }
      return { sets: sets, hist: hist, members: members };
    },
    draw: function (ctx, s, t, dt, u, T) {
      var n = s.hist.length - 1, prog = clamp((u - 0.1) / 0.7, 0, 1) * n, k = Math.floor(prog), f = ease(prog - k);
      var cur = s.hist[k].map(function (c, j) { var nx = s.hist[Math.min(n, k + 1)][j]; return [lerp(c[0], nx[0], f), lerp(c[1], nx[1], f)]; });
      s.sets.forEach(function (S) {
        var M = s.members(S, T), best = null, bd = 1e9;
        poly(ctx, M, 'rgba(226,232,240,0.05)', hexa(P.white, 0.3), 0.6);
        M.forEach(function (p) { cur.forEach(function (c, kk) { var d = (p[0] - c[0]) * (p[0] - c[0]) + (p[1] - c[1]) * (p[1] - c[1]); if (d < bd) { bd = d; best = { p: p, k: kk }; } }); });
        var col = best.k ? P.cyan : P.teal;
        line(ctx, best.p[0], best.p[1], cur[best.k][0], cur[best.k][1], hexa(col, 0.35), 0.9);
        M.forEach(function (p) { dot(ctx, p[0], p[1], 1.5, hexa(P.white, 0.9)); });
        glow(ctx, best.p[0], best.p[1], 4, col, 0.8); dot(ctx, best.p[0], best.p[1], 1.9, col);
      });
      cur.forEach(function (c) { glow(ctx, c[0], c[1], 10, P.amber, 0.8); dot(ctx, c[0], c[1], 3, P.amber); dot(ctx, c[0], c[1], 1.3, P.white); });
    }
  };

  /* 13. Near-convex functions: a holographic loss surface rotating in 3D,
         sandwiched by convexity; the sampled points glow by sensitivity. */
  A.nearconvex = {
    period: 10, still: 3, fade: 1,
    init: function (r) { var samp = [], i; for (i = 0; i < 14; i++) samp.push([(r() - 0.5) * 1.8, (r() - 0.5) * 1.8]); return { n: 16, samp: samp }; },
    draw: function (ctx, s, t, dt, u, T) {
      var n = s.n, ry = T * 0.35, rx = 0.95, cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx), grid = [], i, j;
      function f(x, y) { return 0.55 * (x * x + y * y) + 0.08 * Math.sin(5 * x + T * 1.5) * Math.cos(4 * y) + 0.06 * Math.sin(3 * y + T); }
      function proj(x, y, z) { var X = x * cy + y * sy, Y0 = -x * sy + y * cy, Z = z - 0.45, Yp = Y0 * cx - Z * sx, Zp = Y0 * sx + Z * cx, k = 2.6 / (2.6 + Zp); return [80 + X * 50 * k, 52 + Yp * 50 * k, Zp]; }
      for (i = 0; i <= n; i++) { grid.push([]); for (j = 0; j <= n; j++) { var x = -1 + 2 * i / n, y = -1 + 2 * j / n; grid[i].push(proj(x, y, f(x, y))); } }
      ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 0.7;
      for (i = 0; i <= n; i++) for (j = 0; j < n; j++) {
        var a = grid[i][j], b = grid[i][j + 1], c = grid[j][i], d = grid[j + 1][i];
        ctx.strokeStyle = hexa(P.teal, 0.3); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.strokeStyle = hexa(P.violet, 0.3); ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.stroke();
      }
      s.samp.forEach(function (p, idx) { var z = f(p[0], p[1]), q2 = proj(p[0], p[1], z), w = 1.2 + 2.2 * Math.min(1, z / 1.1), pulse = 0.8 + 0.2 * Math.sin(T * 3 + idx); glow(ctx, q2[0], q2[1], w * 3, P.amber, 0.6 * pulse); dot(ctx, q2[0], q2[1], w * 0.8, hexa(P.amber, 0.95)); });
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  /* 14. SpurAudio: two live spectrograms scroll by; same foreground event,
         different background, and the query embedding drifts out of its cluster. */
  A.spuraudio = {
    period: 9, still: 6.0, fade: 1,
    init: function (r) { var fg = [], i; for (i = 0; i < 5; i++) fg.push({ y: 0.12 + r() * 0.72, h: 0.05 + r() * 0.07, ph: r() * 9 }); return { fg: fg, sup: [[104, 30], [112, 24], [98, 22]], other: [[138, 70], [146, 62], [132, 64]] }; },
    draw: function (ctx, s, t, dt, u, T) {
      var ood = u < 0.42 ? 0 : u < 0.52 ? ease((u - 0.42) / 0.1) : u < 0.9 ? 1 : 1 - ease((u - 0.9) / 0.1);
      function panel(x, y, w, h, mix, seed) {
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.fillStyle = '#1a1140'; ctx.fillRect(x, y, w, h);
        var cols = 26, cw = w / cols, rows = 9, rh = h / rows, k0 = Math.floor(T * 9), off = (T * 9) % 1, i, j;
        for (i = -1; i <= cols; i++) {
          var k = k0 - i, px = x + w - (i + off) * cw;
          for (j = 0; j < rows; j++) {
            var nA = noise(k, j, seed), nB = noise(k * 3 + 7, j * 5 + 1, seed + 2), vA = (j % 2 === 0 ? 0.7 : 0.25) * (0.5 + 0.5 * nA), vB = nB > 0.6 ? 0.95 : 0.12, v = lerp(vA, vB, mix);
            ctx.fillStyle = hexa(mix > 0.5 ? P.teal : P.violet, 0.1 + 0.65 * v); ctx.fillRect(px - cw, y + j * rh, cw + 0.4, rh + 0.4);
          }
        }
        s.fg.forEach(function (b) { var wob = 0.75 + 0.25 * Math.sin(T * 6 + b.ph); ctx.fillStyle = hexa(P.lime, 0.95 * wob); ctx.fillRect(x, y + b.y * h, w, b.h * h); });
        ctx.restore();
        ctx.strokeStyle = hexa(P.white, 0.5); ctx.lineWidth = 0.8; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
      panel(8, 12, 54, 32, 0, 1);
      panel(8, 56, 54, 32, ood, 5);
      glow(ctx, 69, 28, 5, P.teal, 0.8); dot(ctx, 69, 28, 2, P.teal);
      glow(ctx, 69, 72, 5, P.amber, 0.8); dot(ctx, 69, 72, 2, P.amber);
      ctx.strokeStyle = hexa(P.white, 0.25); ctx.lineWidth = 0.8; ctx.strokeRect(84, 10, 68, 80);
      glow(ctx, 105, 26, 22, P.teal, 0.35); glow(ctx, 139, 66, 20, P.pink, 0.3);
      s.sup.forEach(function (p) { dot(ctx, p[0], p[1], 2.2, P.teal); });
      s.other.forEach(function (p) { dot(ctx, p[0], p[1], 2.2, P.pink); });
      var qx = lerp(108, 126, ood), qy = lerp(30, 50, ood);
      if (ood > 0.05) line(ctx, 108, 30, qx, qy, hexa(P.white, 0.4), 0.8, [2, 2]);
      glow(ctx, qx, qy, 9, P.amber, 0.8); dot(ctx, qx, qy, 3, P.amber); dot(ctx, qx, qy, 1.3, P.white);
    }
  };

  /* 15. Dataset distillation meets subset selection: three galaxies; the
         important stars flare, the rest dim, and light threads condense them
         into the distilled set. */
  A['distill-select'] = {
    period: 9, still: 7.0, fade: 0.14,
    init: function (r) {
      var hubs = [[40, 34], [110, 30], [84, 74]], pts = [], i;
      for (i = 0; i < 66; i++) { var h = hubs[i % 3], ang = r() * TAU, rad = 4 + Math.pow(r(), 0.7) * 22; pts.push({ h: i % 3, a: ang, rad: rad, ry: 0.75, sp: (0.08 + r() * 0.1) * (r() < 0.5 ? 1 : -1), imp: 0.4 + rad / 22 + r() * 0.3, tw: r() * TAU }); }
      var sel = pts.map(function (_, j) { return j; }).sort(function (a, b) { return pts[b].imp - pts[a].imp; }).slice(0, 9);
      var syn = sel.map(function (j) { var p = pts[j], h = hubs[p.h]; return { j: j, x1: h[0] + Math.cos(p.a) * p.rad * 0.45 + gauss(r) * 3, y1: h[1] + Math.sin(p.a) * p.rad * 0.45 * p.ry + gauss(r) * 3 }; });
      return { hubs: hubs, pts: pts, sel: sel, syn: syn };
    },
    draw: function (ctx, s, t, dt, u, T) {
      var rev = clamp((u - 0.25) / 0.15, 0, 1), train = ease(clamp((u - 0.48) / 0.3, 0, 1)), end = u > 0.9 ? 1 - (u - 0.9) / 0.1 : 1, i;
      var pos = s.pts.map(function (p) { var a = p.a + T * p.sp, h = s.hubs[p.h]; return [h[0] + Math.cos(a) * p.rad, h[1] + Math.sin(a) * p.rad * p.ry]; });
      for (i = 0; i < s.pts.length; i++) { var p = s.pts[i], q2 = pos[i], isSel = s.sel.indexOf(i) >= 0, a = isSel ? 1 : 1 - 0.85 * rev; dot(ctx, q2[0], q2[1], 1.2, hexa(P.cyan, a * (0.5 + 0.5 * Math.sin(T * 3 + p.tw)))); if (isSel && rev > 0) { glow(ctx, q2[0], q2[1], 6 * rev, P.amber, 0.7 * rev * end); dot(ctx, q2[0], q2[1], 1.8 * rev, hexa(P.amber, end)); } }
      if (train > 0) s.syn.forEach(function (q3) { var src = pos[q3.j], x = lerp(src[0], q3.x1, train), y = lerp(src[1], q3.y1, train); line(ctx, src[0], src[1], x, y, hexa(P.amber, 0.45 * end), 0.8); glow(ctx, x, y, 5, P.teal, 0.8 * end); ctx.strokeStyle = hexa(P.teal, end); ctx.lineWidth = 1.2; ctx.strokeRect(x - 2.5, y - 2.5, 5, 5); });
    }
  };

  /* ---------- harness ---------- */
  var items = [], running = false, staticMode = reduce || fixedT !== null;
  window.__animErrors = [];

  function sizeItem(it) {
    var r = it.el.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    it.dpr = Math.min(window.devicePixelRatio || 1, 2); it.w = w; it.h = h;
    it.cv.width = Math.round(w * it.dpr); it.cv.height = Math.round(h * it.dpr);
    it.cv.style.width = w + 'px'; it.cv.style.height = h + 'px';
    it.first = true;
  }
  function drawFrame(it, dt) {
    var ctx = it.ctx, A1 = it.A, T = A1.period, s = Math.max(it.w / W, it.h / H), ox = (it.w - W * s) / 2, oy = (it.h - H * s) / 2;
    ctx.setTransform(it.dpr * s, 0, 0, it.dpr * s, it.dpr * ox, it.dpr * oy);
    ctx.save(); ctx.beginPath(); ctx.rect(-2, -2, W + 4, H + 4); ctx.clip();
    ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.fillStyle = it.first || A1.fade >= 1 ? '#0b1020' : 'rgba(11,16,32,' + A1.fade + ')'; ctx.fillRect(-2, -2, W + 4, H + 4);
    it.first = false;
    var t = it.time % T;
    try { A1.draw(ctx, it.st, t, dt, t / T, it.time); } catch (e) { if (!it.err) { it.err = true; window.__animErrors.push(it.key + ': ' + e.message); if (window.console) console.warn('paper-anims', it.key, e); } }
    ctx.restore();
  }
  function simulate(it, target) {
    it.st = it.A.init(rng(hash(it.key))); it.time = 0; it.first = true;
    var steps = Math.min(900, Math.round(target * 60)), i, dt = 1 / 60;
    for (i = 0; i < steps; i++) { it.time += dt; drawFrame(it, dt); }
  }
  function renderStatic(it) { simulate(it, fixedT !== null ? fixedT : (it.A.still !== undefined ? it.A.still : it.A.period * 0.6)); }
  function frame(now) {
    var any = false;
    items.forEach(function (it) {
      if (!it.visible) { it.last = now; return; }
      any = true;
      var dt = clamp((now - it.last) / 1000, 0, 0.05) * it.speed; it.last = now; it.time += dt;
      drawFrame(it, dt);
    });
    if (any) requestAnimationFrame(frame); else running = false;
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { var it = e.target.__anim; if (!it) return; it.visible = e.isIntersecting; if (it.visible) { if (staticMode) renderStatic(it); else { it.last = performance.now(); kick(); } } });
  }, { rootMargin: '160px 0px' }) : null;
  var ro = 'ResizeObserver' in window ? new ResizeObserver(function (entries) {
    entries.forEach(function (e) { var it = e.target.__anim; if (it) { sizeItem(it); if (staticMode) renderStatic(it); } });
  }) : null;

  function setup(el) {
    var key = el.getAttribute('data-anim'), A1 = A[key];
    if (!A1) return;
    var cv = document.createElement('canvas'); cv.className = 'anim-canvas'; cv.setAttribute('aria-hidden', 'true');
    el.appendChild(cv); el.classList.add('anim');
    var r = rng(hash(key)), st;
    try { st = A1.init(r); } catch (e) { window.__animErrors.push(key + ' init: ' + e.message); el.classList.remove('anim'); el.removeChild(cv); return; }
    var it = { key: key, el: el, cv: cv, ctx: cv.getContext('2d'), A: A1, st: st, w: 0, h: 0, dpr: 1, visible: !io, time: r() * A1.period, last: performance.now(), speed: 1, first: true };
    el.__anim = it; items.push(it); sizeItem(it);
    var card = el.closest('.pub') || el;
    card.addEventListener('pointerenter', function () { it.speed = 1.8; });
    card.addEventListener('pointerleave', function () { it.speed = 1; });
    if (io) io.observe(el); else if (staticMode) renderStatic(it);
    if (ro) ro.observe(el);
  }
  function start() { document.querySelectorAll('.pub-thumb[data-anim]').forEach(setup); if (!io && !staticMode) kick(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
