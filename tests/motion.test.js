'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const FS = require('../motion.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);

/* The original single-file calculator's model (no jerk, no torque), kept verbatim as a reference. */
function legacyModel(q) {
  function moveTime(S, vm, a) { if (S <= 0) return 0; const s2 = vm * vm / a; return S >= s2 ? S / vm + vm / a : 2 * Math.sqrt(S / a); }
  const v = q.mpm * 1000 / 60, P = q.len / v;
  const vc = q.cRpm / q.cGear * q.cLead / 60, ac = q.cAcc;
  const vz = q.zRpm / q.zGear * q.zLead / 60, az = q.zAcc;
  const ta = v / ac, sa = v * v / (2 * ac);
  const feedEff = Math.min(q.feed, vz);
  const A = q.approach, C = q.cutDist;
  const tApp = moveTime(A, vz, az), tCut = moveTime(C, feedEff, az), tRet = moveTime(A + C, vz, az);
  const ts = q.settle + tApp + tCut + tRet;
  const Sof = t => 2 * sa + v * t;
  const Tof = t => 2 * ta + t + moveTime(Sof(t), vc, ac) + q.dwell;
  const S = Sof(ts), T = Tof(ts);
  let tsTime = null;
  if (Tof(0) <= P) { let lo = 0, hi = P; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (Tof(m) <= P) lo = m; else hi = m; } tsTime = lo; }
  const tsTravel = (q.travel - 2 * sa) / v;
  const tsLim = tsTime == null ? null : Math.min(tsTime, tsTravel);
  const okSpeed = v <= vc + 1e-9;
  let feedMin = null;
  if (okSpeed && tsLim != null) {
    const availCut = tsLim - q.settle - tApp - tRet;
    if (!(availCut <= 0 || moveTime(C, vz, az) > availCut)) {
      let lo = 1e-3, hi = vz; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (moveTime(C, m, az) <= availCut) hi = m; else lo = m; } feedMin = hi;
    }
  }
  return { T, S, P, ts, feedMin, ok: T <= P + 1e-9 && S <= q.travel + 1e-9 && okSpeed };
}

test('defaults reproduce the original calculator', () => {
  const q = { ...FS.DEFAULTS };
  const M = FS.model(q), L = legacyModel(q);
  close(M.T, L.T, 1e-9, 'cycle time');
  close(M.S, L.S, 1e-9, 'stroke');
  close(M.ts, L.ts, 1e-9, 'sync time');
  close(M.feedMin, L.feedMin, 1e-6, 'min feed');
  assert.equal(M.ok, L.ok);
});

test('matches the original model across random setups without jerk', () => {
  let seed = 7;
  const rnd = (a, b) => { seed = (seed * 16807) % 2147483647; return a + (b - a) * (seed / 2147483647); };
  for (let i = 0; i < 300; i++) {
    const q = {
      ...FS.DEFAULTS, mass: 0,
      mpm: rnd(2, 60), len: rnd(100, 4000), approach: rnd(0, 50), cutDist: rnd(5, 150), feed: rnd(20, 400),
      settle: rnd(0, 0.1), dwell: rnd(0, 0.1), cRpm: rnd(1000, 6000), cGear: rnd(1, 20), cLead: rnd(20, 200),
      cAcc: rnd(2000, 50000), travel: rnd(200, 3000), zRpm: rnd(1000, 6000), zGear: rnd(1, 5), zLead: rnd(5, 40), zAcc: rnd(2000, 50000),
    };
    const M = FS.model(q), L = legacyModel(q);
    close(M.T, L.T, 1e-9, `T #${i}`);
    close(M.S, L.S, 1e-9, `S #${i}`);
    assert.equal(M.okTime && M.okTravel && M.okSpeed, L.ok, `ok #${i}`);
    if (L.feedMin != null) close(M.feedMin, L.feedMin, 1e-3, `feedMin #${i}`);
    else assert.equal(M.feedMin, null, `feedMin #${i}`);
  }
});

test('rest-to-rest moves land exactly, with and without jerk limit', () => {
  const cases = [
    [100, 500, 5000, 0], [2, 500, 5000, 0],                // trapezoid, triangle
    [100, 500, 5000, 1e6], [10, 500, 5000, 1e6],           // jerk-limited with and without cruise
    [1, 500, 5000, 1e5], [0.01, 500, 5000, 1e6],           // pure jerk ramps
    [300, 250, 10000, 2e5],
  ];
  for (const [d, V, A, J] of cases) {
    const prof = FS.buildProfile(FS.moveSegs(d, V, A, J, 'm'));
    close(prof.pEnd, d, 1e-9 * Math.max(1, d), `distance ${d}/${J}`);
    close(prof.vEnd, 0, 1e-9, `end speed ${d}/${J}`);
    close(prof.T, FS.moveTime(d, V, A, J), 1e-12, `duration ${d}/${J}`);
    for (const s of prof.segs) {
      assert.ok(Math.abs(s.a0) <= A + 1e-9, 'acceleration limit');
      if (J > 0) assert.ok(Math.abs(s.j) <= J * (1 + 1e-9), 'jerk limit');
    }
    let vmax = 0;
    for (let i = 0; i <= 400; i++) vmax = Math.max(vmax, Math.abs(FS.sampleProfile(prof, prof.T * i / 400).v));
    assert.ok(vmax <= V + 1e-9, 'speed limit');
  }
});

test('jerk limit makes moves slower, never faster', () => {
  for (const d of [0.5, 5, 50, 500]) {
    const t0 = FS.moveTime(d, 400, 8000, 0), tj = FS.moveTime(d, 400, 8000, 2e5);
    assert.ok(tj > t0, `d=${d}`);
  }
  close(FS.rampTime(300, 5000, 1e5), 300 / 5000 + 5000 / 1e5, 1e-12, 'ramp with full acceleration');
  close(FS.rampTime(10, 5000, 1e6), 2 * Math.sqrt(10 / 1e6), 1e-12, 'ramp without full acceleration');
});

test('both axes end the cycle where they started', () => {
  for (const extra of [{}, { cJerk: 5e6, zJerk: 5e5 }, { mpm: 30, len: 2000, cAcc: 8000 }]) {
    const M = FS.model({ ...FS.DEFAULTS, ...extra });
    close(M.carriage.pEnd, 0, 1e-6, 'carriage home');
    close(M.saw.pEnd, 0, 1e-6, 'blade up');
    close(M.carriage.T, M.period, 1e-9, 'carriage profile spans one period');
    const sMid = FS.sampleProfile(M.carriage, M.ta + M.ts / 2);
    close(sMid.v, M.v, 1e-9, 'synchronized at line speed');
  }
});

test('maximum line speed is the feasibility edge', () => {
  const q = { ...FS.DEFAULTS };
  const vmax = FS.maxLineSpeed(q);
  assert.ok(vmax > q.mpm, 'defaults have reserve');
  assert.ok(FS.check({ ...q, mpm: vmax * 0.999 }).ok);
  assert.ok(!FS.check({ ...q, mpm: vmax * 1.01 }).ok);
});

test('shortest part length makes the cycle exactly fit', () => {
  const q = { ...FS.DEFAULTS };
  const len = FS.minPartLength(q, FS.model(q));
  close(FS.model({ ...q, len }).reserve, 0, 1e-9);
  const qr = { ...q, tRated: 5 };
  const lenR = FS.minPartLength(qr, FS.model(qr));
  const Mr = FS.model({ ...qr, len: lenR * 1.0001 });
  assert.ok(Mr.okRms && Mr.okTime, 'fits once the RMS limit is respected');
});

test('torque follows F·lead / (2π·i·η) for a plain trapezoid', () => {
  const q = { ...FS.DEFAULTS, mass: 50, eff: 80, inertia: 0, cAcc: 4000, mpm: 6, len: 2000 };
  const M = FS.model(q);
  const expected = 50 * 4 * 0.1 / (2 * Math.PI * 10) / 0.8;
  close(M.tq.peak, expected, 1e-9, 'peak torque');
  assert.ok(M.tq.rms > 0 && M.tq.rms < M.tq.peak);
  const withInertia = FS.model({ ...q, inertia: 10 });
  const alpha = 4 / (0.1 / (2 * Math.PI * 10));
  close(withInertia.tq.peak, expected + 10e-4 * alpha, 1e-9, 'rotor inertia adds J·α');
});

test('torque limits switch the verdict', () => {
  const q = { ...FS.DEFAULTS, cAcc: 8000, mpm: 10, len: 1500 };
  const M = FS.model(q);
  assert.ok(M.ok);
  assert.ok(!FS.model({ ...q, tPeak: M.tq.peak * 0.9 }).ok, 'peak torque');
  assert.ok(!FS.model({ ...q, tRated: M.tq.rms * 0.9 }).ok, 'RMS torque');
  assert.ok(FS.model({ ...q, tRated: M.tq.rms * 1.1, tPeak: M.tq.peak * 1.1 }).ok);
});

test('phase list adds up to the cycle time', () => {
  for (const extra of [{}, { cJerk: 1e6 }, { mpm: 40 }]) {
    const M = FS.model({ ...FS.DEFAULTS, ...extra });
    close(M.phases.reduce((s, p) => s + p.t, 0), M.T, 1e-12);
  }
});
