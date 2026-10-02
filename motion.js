/*
 * Flying saw motion model: pure maths, no DOM.
 * Units throughout: mm, s, mm/s, mm/s², mm/s³, kg, N·m.
 * Loads as a classic script in the browser (global `FlyingSaw`) and through require() in Node tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlyingSaw = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    // line
    mpm: 18, len: 500,
    // cut
    approach: 20, cutDist: 60, feed: 150, settle: 0.05, dwell: 0.05,
    // carriage drive
    cRpm: 3000, cGear: 10, cLead: 100, cAcc: 500000, cJerk: 0, travel: 600,
    // saw axis drive
    zRpm: 3000, zGear: 1, zLead: 5, zAcc: 10000, zJerk: 0,
    // carriage load, only used for the torque check
    mass: 60, eff: 90, inertia: 0, tRated: 0, tPeak: 0,
  });

  /* ---------- speed ramps and rest-to-rest moves ---------- */

  // J <= 0 (or not finite) means no jerk limit: acceleration steps instantly.
  const jerkLimited = J => J > 0 && isFinite(J);

  // Time to change speed by V with max acceleration A and jerk J.
  function rampTime(V, A, J) {
    if (!(V > 0)) return 0;
    if (!jerkLimited(J)) return V / A;
    return V >= A * A / J ? V / A + A / J : 2 * Math.sqrt(V / J);
  }
  // The ramp is point-symmetric in time, so its average speed is V/2.
  function rampDist(V, A, J) { return V * rampTime(V, A, J) / 2; }

  // Segments are {dt, a0, a1, tag}: acceleration changes linearly from a0 to a1 over dt.
  function rampSegs(dv, A, J, tag) {
    const s = Math.sign(dv), V = Math.abs(dv);
    if (!(V > 0)) return [];
    if (!jerkLimited(J)) return [{ dt: V / A, a0: s * A, a1: s * A, tag }];
    if (V >= A * A / J) {
      const tj = A / J;
      return [
        { dt: tj, a0: 0, a1: s * A, tag },
        { dt: V / A - tj, a0: s * A, a1: s * A, tag },
        { dt: tj, a0: s * A, a1: 0, tag },
      ];
    }
    const ap = Math.sqrt(V * J), tj = ap / J;
    return [{ dt: tj, a0: 0, a1: s * ap, tag }, { dt: tj, a0: s * ap, a1: 0, tag }];
  }

  // Highest speed a time-optimal rest-to-rest move over distance d reaches.
  function peakVel(d, V, A, J) {
    if (!(d > 0)) return 0;
    if (2 * rampDist(V, A, J) <= d) return V;
    if (!jerkLimited(J)) return Math.sqrt(d * A);
    const tj = A / J;
    // still reaches full acceleration: v²/A + v·A/J = d
    if (2 * rampDist(A * tj, A, J) <= d) return A / 2 * (Math.sqrt(tj * tj + 4 * d / A) - tj);
    // pure jerk ramps: 2·v^1.5/√J = d
    return Math.cbrt(d * d * J / 4);
  }

  function moveTime(d, V, A, J) {
    d = Math.abs(d);
    if (!(d > 0)) return 0;
    const vp = peakVel(d, V, A, J);
    return 2 * rampTime(vp, A, J) + Math.max(0, d - 2 * rampDist(vp, A, J)) / vp;
  }

  function moveSegs(dist, V, A, J, tag) {
    const d = Math.abs(dist), s = Math.sign(dist);
    if (!(d > 0)) return [];
    const vp = peakVel(d, V, A, J);
    const tc = Math.max(0, d - 2 * rampDist(vp, A, J)) / vp;
    return [...rampSegs(s * vp, A, J, tag), hold(tc, tag), ...rampSegs(-s * vp, A, J, tag)];
  }

  function hold(dt, tag) { return { dt, a0: 0, a1: 0, tag }; }

  /* ---------- piecewise constant-jerk profiles ---------- */

  function buildProfile(segs) {
    const out = [];
    let t = 0, p = 0, v = 0;
    for (const s of segs) {
      if (!(s.dt > 1e-12)) continue;
      const j = (s.a1 - s.a0) / s.dt, dt = s.dt;
      out.push({ t0: t, dt, p0: p, v0: v, a0: s.a0, j, tag: s.tag });
      p += v * dt + s.a0 * dt * dt / 2 + j * dt * dt * dt / 6;
      v += s.a0 * dt + j * dt * dt / 2;
      t += dt;
    }
    return { segs: out, T: t, pEnd: p, vEnd: v };
  }

  function sampleProfile(prof, t) {
    const S = prof.segs;
    if (!S.length) return { p: 0, v: 0, a: 0, tag: null };
    if (t >= prof.T) return { p: prof.pEnd, v: prof.vEnd, a: 0, tag: S[S.length - 1].tag };
    let lo = 0, hi = S.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (S[mid].t0 <= t) lo = mid; else hi = mid - 1;
    }
    const s = S[lo], u = Math.max(0, t - s.t0);
    return {
      p: s.p0 + s.v0 * u + s.a0 * u * u / 2 + s.j * u * u * u / 6,
      v: s.v0 + s.a0 * u + s.j * u * u / 2,
      a: s.a0 + s.j * u,
      tag: s.tag,
    };
  }

  /* ---------- the flying saw cycle ---------- */

  function drives(q) {
    return {
      vc: q.cRpm / q.cGear * q.cLead / 60, ac: q.cAcc, jc: q.cJerk,
      vz: q.zRpm / q.zGear * q.zLead / 60, az: q.zAcc, jz: q.zJerk,
    };
  }

  // Cycle timing without building profiles; cheap enough to call inside searches.
  function timing(q) {
    const d = drives(q);
    const v = q.mpm * 1000 / 60;
    const P = q.len / v;
    const ta = rampTime(v, d.ac, d.jc), sa = v * ta / 2;
    const feedEff = Math.min(q.feed, d.vz);
    const A = q.approach, C = q.cutDist;
    const tApp = moveTime(A, d.vz, d.az, d.jz);
    const tCut = moveTime(C, feedEff, d.az, d.jz);
    const tRet = moveTime(A + C, d.vz, d.az, d.jz);
    const ts = q.settle + tApp + tCut + tRet;
    const S = 2 * sa + v * ts;
    const tHome = moveTime(S, d.vc, d.ac, d.jc);
    const T = 2 * ta + ts + tHome + q.dwell;
    return {
      ...d, v, P, ta, sa, feedEff, A, C, tApp, tCut, tRet, ts, S, tHome, T,
      settle: q.settle, dwell: q.dwell,
      okSpeed: v <= d.vc + 1e-9, okTime: T <= P + 1e-9, okTravel: S <= q.travel + 1e-9,
    };
  }

  function carriageProfile(m, period) {
    return buildProfile([
      ...rampSegs(m.v, m.ac, m.jc, 'accel'),
      hold(m.ts, 'sync'),
      ...rampSegs(-m.v, m.ac, m.jc, 'decel'),
      ...moveSegs(-m.S, m.vc, m.ac, m.jc, 'return'),
      hold(period - (m.T - m.dwell), 'wait'),
    ]);
  }

  function sawProfile(m, period) {
    return buildProfile([
      hold(m.ta, 'idle'),
      hold(m.settle, 'settle'),
      ...moveSegs(m.A, m.vz, m.az, m.jz, 'approach'),
      ...moveSegs(m.C, m.feedEff, m.az, m.jz, 'cut'),
      ...moveSegs(-(m.A + m.C), m.vz, m.az, m.jz, 'retract'),
      hold(Math.max(0, period - m.ta - m.ts), 'idle'),
    ]);
  }

  // Carriage motor torque for linear acceleration a [mm/s²]. Motoring divides the load torque by the
  // drive efficiency, braking multiplies it. Motor + gearbox inertia acts directly at the motor shaft.
  function motorTorque(q, a, motoring) {
    const k = q.cLead / 1000 / (2 * Math.PI * q.cGear);    // m of travel per rad of motor rotation
    const load = q.mass * (a / 1000) * k;                    // N·m at the motor, lossless
    const eta = Math.min(1, Math.max(1e-3, q.eff / 100));
    return (motoring ? load / eta : load * eta) + q.inertia * 1e-4 * (a / 1000) / k;
  }

  // Peak and RMS motor torque over one period. Torque is linear inside each segment, so Simpson's
  // rule on torque² is exact and the peak sits on a segment boundary.
  function torqueStats(q, prof, period) {
    let peak = 0, sq = 0, aPeak = 0;
    for (const s of prof.segs) {
      const h = s.dt / 2;
      const vAt = u => s.v0 + s.a0 * u + s.j * u * u / 2;
      const aAt = u => s.a0 + s.j * u;
      const motoring = vAt(h) * aAt(h) >= 0;
      const t0 = motorTorque(q, aAt(0), motoring);
      const tm = motorTorque(q, aAt(h), motoring);
      const t1 = motorTorque(q, aAt(s.dt), motoring);
      peak = Math.max(peak, Math.abs(t0), Math.abs(t1));
      aPeak = Math.max(aPeak, Math.abs(aAt(0)), Math.abs(aAt(s.dt)));
      sq += s.dt / 6 * (t0 * t0 + 4 * tm * tm + t1 * t1);
    }
    return { peak, rms: period > 0 ? Math.sqrt(sq / period) : 0, sq, aPeak };
  }

  // Everything that decides whether the setup works. Used by model() and by the searches.
  function check(q) {
    const m = timing(q);
    const period = Math.max(m.P, m.T);
    const carriage = carriageProfile(m, period);
    const tq = torqueStats(q, carriage, period);
    const okRms = !(q.tRated > 0) || tq.rms <= q.tRated + 1e-9;
    const okPeak = !(q.tPeak > 0) || tq.peak <= q.tPeak + 1e-9;
    return {
      ...m, period, carriage, tq, okRms, okPeak,
      ok: m.okSpeed && m.okTime && m.okTravel && okRms && okPeak,
    };
  }

  function model(q) {
    const M = check(q);

    // Longest time the carriage may stay synchronized, limited by the part time and by the travel.
    const cycleFor = ts => 2 * M.ta + ts + moveTime(2 * M.sa + M.v * ts, M.vc, M.ac, M.jc) + q.dwell;
    let tsTime = null;
    if (cycleFor(0) <= M.P) {
      let lo = 0, hi = M.P;
      for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (cycleFor(mid) <= M.P) lo = mid; else hi = mid; }
      tsTime = lo;
    }
    const tsTravel = (q.travel - 2 * M.sa) / M.v;
    let tsLim = null;
    if (M.okSpeed && tsTime != null) tsLim = Math.min(tsTime, tsTravel);
    if (tsLim != null && tsLim <= 0) tsLim = null;
    const limitBy = tsTime != null && tsTravel < tsTime ? 'travel' : 'time';

    // Slowest cutting feed that still fits inside that window.
    let availCut = null, feedMin = null;
    if (tsLim != null) {
      availCut = tsLim - q.settle - M.tApp - M.tRet;
      if (availCut > 0 && moveTime(M.C, M.vz, M.az, M.jz) <= availCut) {
        let lo = 0, hi = M.vz;
        for (let i = 0; i < 60; i++) { const f = (lo + hi) / 2; if (moveTime(M.C, f, M.az, M.jz) <= availCut) hi = f; else lo = f; }
        feedMin = hi;
      }
    }

    const vRet = peakVel(M.S, M.vc, M.ac, M.jc);
    const rpm = v => v / q.cLead * q.cGear * 60;

    return {
      ...M,
      saw: sawProfile(M, M.period),
      tsLim, availCut, feedMin, limitBy,
      feedCapped: q.feed > M.vz,
      reserve: 1 - M.T / M.P,
      vRet,
      motorRpmPeak: rpm(Math.max(M.v, vRet)),
      forcePeak: q.mass * M.tq.aPeak / 1000,
      phases: [
        { key: 'accel', group: 'move', label: 'Accelerate to line speed', t: M.ta },
        { key: 'settle', group: 'sync', label: 'Settle in sync', t: q.settle },
        { key: 'approach', group: 'sync', label: 'Blade approach', t: M.tApp },
        { key: 'cut', group: 'cut', label: 'Cut', t: M.tCut },
        { key: 'retract', group: 'sync', label: 'Blade retract', t: M.tRet },
        { key: 'decel', group: 'move', label: 'Decelerate', t: M.ta },
        { key: 'return', group: 'move', label: 'Return home', t: M.tHome },
        { key: 'dwell', group: 'wait', label: 'Minimum wait at home', t: q.dwell },
      ],
    };
  }

  // Highest line speed [m/min] at which every check still passes, or null if none does.
  function maxLineSpeed(q) {
    const vc = drives(q).vc;
    const ok = v => check({ ...q, mpm: v * 0.06 }).ok;
    let lo = Math.min(0.5, vc), hi = vc;
    if (!(lo > 0) || !ok(lo)) return null;
    if (ok(hi)) return hi * 0.06;
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    return lo * 0.06;
  }

  // Shortest part [mm] the setup can cut at the current line speed, or null if no length helps.
  // A longer part only adds waiting time at home, where the torque is zero.
  function minPartLength(q, M) {
    if (!M.okSpeed || !M.okTravel) return null;
    if (q.tPeak > 0 && M.tq.peak > q.tPeak + 1e-9) return null;
    let P = M.T;
    if (q.tRated > 0) P = Math.max(P, M.tq.sq / (q.tRated * q.tRated));
    return M.v * P;
  }

  const PHASE_NAMES = {
    accel: 'Accelerating to line speed', decel: 'Decelerating', return: 'Returning home', wait: 'Waiting for next mark',
    settle: 'Synchronized, settling', approach: 'Blade approaching', cut: 'Cutting', retract: 'Blade retracting',
  };

  function stateAt(M, q, t) {
    const c = sampleProfile(M.carriage, t), z = sampleProfile(M.saw, t);
    const tag = c.tag === 'sync' ? (z.tag === 'idle' ? 'retract' : z.tag) : c.tag;
    return {
      x: c.p, v: c.v, a: c.a, z: z.p, vz: z.v, tag, phase: PHASE_NAMES[tag] || '',
      torque: motorTorque(q, c.a, c.v * c.a >= 0),
      rpm: c.v / q.cLead * q.cGear * 60,
    };
  }

  // n+1 evenly spaced samples over one period, for charts and export.
  function sampleCycle(M, q, n) {
    const out = { n, dt: M.period / n };
    for (const k of ['t', 'x', 'v', 'a', 'z', 'vz', 'torque', 'rpm']) out[k] = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const t = M.period * i / n, s = stateAt(M, q, t);
      out.t[i] = t; out.x[i] = s.x; out.v[i] = s.v; out.a[i] = s.a;
      out.z[i] = s.z; out.vz[i] = s.vz; out.torque[i] = s.torque; out.rpm[i] = s.rpm;
    }
    return out;
  }

  return {
    DEFAULTS, rampTime, rampDist, rampSegs, peakVel, moveTime, moveSegs, buildProfile, sampleProfile,
    drives, timing, check, model, maxLineSpeed, minPartLength, motorTorque, torqueStats, stateAt, sampleCycle,
  };
}));
