/* Flying saw simulator UI: inputs, verdict, cycle budget, animation and charts. The maths lives in motion.js. */
(function () {
  'use strict';
  const FS = window.FlyingSaw;
  const $ = id => document.getElementById(id);

  /* ---------- formatting ---------- */
  const nfCache = {};
  const f = (x, d = 2) => {
    if (x == null || !Number.isFinite(x)) return '—';
    const nf = nfCache[d] || (nfCache[d] = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
    return nf.format(Math.abs(x) < 0.5 * Math.pow(10, -d) ? 0 : x);
  };
  const ms = t => f(t * 1000, 1) + ' ms';
  const num = (x, d) => `<span class="num">${f(x, d)}</span>`;

  /* ---------- machine data ---------- */
  // [key, label, unit, input step, options]; options: zero = 0 allowed, max, hint
  const GROUPS = [
    ['Line', [
      ['mpm', 'Material speed', 'm/min', 0.5],
      ['len', 'Part length', 'mm', 10],
    ]],
    ['Cut', [
      ['approach', 'Approach', 'mm', 1, { zero: true, hint: 'blade up → material' }],
      ['cutDist', 'Cutting distance', 'mm', 1, { hint: 'material + overtravel' }],
      ['feed', 'Cutting feed', 'mm/s', 5],
      ['settle', 'Sync settle before cut', 's', 0.01, { zero: true }],
      ['dwell', 'Min. wait at home', 's', 0.01, { zero: true }],
    ]],
    ['Carriage drive', [
      ['cRpm', 'Motor max speed', 'rpm', 100],
      ['cGear', 'Gear ratio', 'i', 0.5],
      ['cLead', 'Travel per output rev', 'mm/rev', 1],
      ['cAcc', 'Acceleration', 'mm/s²', 1000],
      ['cJerk', 'Jerk limit', 'mm/s³', 100000, { zero: true, hint: '0 = no limit' }],
      ['travel', 'Max carriage travel', 'mm', 10],
    ], 'cInfo'],
    ['Saw axis drive', [
      ['zRpm', 'Motor max speed', 'rpm', 100],
      ['zGear', 'Gear ratio', 'i', 0.5],
      ['zLead', 'Travel per output rev', 'mm/rev', 1],
      ['zAcc', 'Acceleration', 'mm/s²', 500],
      ['zJerk', 'Jerk limit', 'mm/s³', 10000, { zero: true, hint: '0 = no limit' }],
    ], 'zInfo'],
    ['Carriage load', [
      ['mass', 'Moving mass', 'kg', 5, { zero: true }],
      ['eff', 'Drive efficiency', '%', 1, { max: 100 }],
      ['inertia', 'Motor + gearbox inertia', 'kg·cm²', 0.5, { zero: true, hint: 'at the motor shaft' }],
      ['tRated', 'Motor rated torque', 'N·m', 0.5, { zero: true, hint: '0 = not checked' }],
      ['tPeak', 'Motor peak torque', 'N·m', 0.5, { zero: true, hint: '0 = not checked' }],
    ], 'tInfo'],
  ];

  const SPEC = {};
  for (const [, fields] of GROUPS) for (const [k, label, unit, step, o] of fields) SPEC[k] = { label, unit, step, ...o };
  const valid = (k, x) => Number.isFinite(x) && (x > 0 || (SPEC[k].zero && x === 0)) && !(SPEC[k].max != null && x > SPEC[k].max);
  const invalidMsg = k => SPEC[k].max != null ? `Enter a value above 0 and up to ${SPEC[k].max}.` : SPEC[k].zero ? 'Enter 0 or a positive number.' : 'Enter a number greater than 0.';

  // Parameters: defaults, then the last saved setup, then a shared link (the link wins).
  const STORE = 'flying-saw-simulator/v1';
  const p = { ...FS.DEFAULTS };
  const merge = obj => { for (const k in SPEC) if (Object.prototype.hasOwnProperty.call(obj, k)) { const x = Number(obj[k]); if (valid(k, x)) p[k] = x; } };
  try { const saved = JSON.parse(localStorage.getItem(STORE) || 'null'); if (saved && typeof saved === 'object') merge(saved); } catch (e) { /* storage blocked */ }
  if (location.hash.includes('=')) merge(Object.fromEntries(new URLSearchParams(location.hash.slice(1))));

  const inputs = {};
  for (const [title, fields, info] of GROUPS) {
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.textContent = title;
    fs.appendChild(lg);
    for (const [k] of fields) {
      const s = SPEC[k], row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<label for="f_${k}">${s.label}${s.hint ? `<small>${s.hint}</small>` : ''}</label>` +
        `<input id="f_${k}" type="number" inputmode="decimal" step="${s.step}" min="0"${s.max != null ? ` max="${s.max}"` : ''}>` +
        `<span class="u">${s.unit}</span>`;
      const inp = row.querySelector('input');
      inp.value = p[k];
      inp.addEventListener('input', () => onInput(k));
      inp.addEventListener('blur', () => { if (inp.getAttribute('aria-invalid') !== 'true') inp.value = p[k]; });
      inputs[k] = inp;
      fs.appendChild(row);
      markChanged(k);
    }
    if (info) { const d = document.createElement('div'); d.id = info; d.className = 'info'; fs.appendChild(d); }
    $('groups').appendChild(fs);
  }

  function markChanged(k) { inputs[k].classList.toggle('changed', p[k] !== FS.DEFAULTS[k]); }
  function onInput(k) {
    const inp = inputs[k], x = parseFloat(inp.value);
    if (valid(k, x)) { p[k] = x; inp.removeAttribute('aria-invalid'); inp.title = ''; schedule(); }
    else { inp.setAttribute('aria-invalid', 'true'); inp.title = invalidMsg(k); }
    markChanged(k);
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; recompute(); });
  }

  function persist() {
    const diff = {};
    for (const k in SPEC) if (p[k] !== FS.DEFAULTS[k]) diff[k] = p[k];
    try { localStorage.setItem(STORE, JSON.stringify(diff)); } catch (e) { /* storage blocked */ }
    const qs = new URLSearchParams(diff).toString();
    try { history.replaceState(null, '', qs ? '#' + qs : location.pathname + location.search); } catch (e) { /* sandboxed */ }
  }

  /* ---------- results ---------- */
  let M, vmax, minLen;
  const hasLoad = () => p.mass > 0 || p.inertia > 0;
  const torqueChecked = () => p.tRated > 0 || p.tPeak > 0;

  function recompute() {
    M = FS.model(p);
    vmax = FS.maxLineSpeed(p);
    minLen = FS.minPartLength(p, M);
    renderInfo();
    renderVerdict();
    renderStats();
    renderBudget();
    drawStatic();
    persist();
    dirty = true;
  }

  function renderInfo() {
    const g = a => a / 9806.65;
    const cg = g(M.ac);
    $('cInfo').innerHTML = `Max linear speed <b>${f(M.vc, 0)} mm/s</b> (${f(M.vc * 0.06, 1)} m/min) · ` +
      `acceleration ${f(cg, cg < 10 ? 2 : 1)} g${cg > 3 ? ' <span class="warn">(very high for a moving carriage)</span>' : ''} · ` +
      `ramp to line speed ${ms(M.ta)} over ${f(M.sa, 1)} mm`;
    $('zInfo').innerHTML = `Max linear speed <b>${f(M.vz, 0)} mm/s</b> · acceleration ${f(g(M.az), 2)} g` +
      (M.feedCapped ? ` · <span class="warn">cutting feed limited to ${f(M.vz, 0)} mm/s</span>` : '');
    $('tInfo').innerHTML = hasLoad()
      ? `Peak force <b>${f(M.forcePeak, 0)} N</b> · peak motor speed <b>${f(M.motorRpmPeak, 0)} rpm</b>`
      : 'Only used for the torque chart and the torque check.';
  }

  function renderVerdict() {
    const travelBound = !M.okTravel || M.limitBy === 'travel';
    const feedHint = () => {
      if (M.feedMin != null) {
        return `Saw axis: approach ${f(M.tApp, 3)} s + retract ${f(M.tRet, 3)} s are fixed by the motor. That leaves <b>${f(M.availCut, 3)} s</b> ` +
          `for the ${f(p.cutDist, 0)} mm cut, so the cutting feed must be at least <b>${f(M.feedMin, 0)} mm/s</b>${M.limitBy === 'travel' ? ' (limited by carriage travel)' : ''}.`;
      }
      return `The saw axis can't finish in time even at its max speed of ${f(M.vz, 0)} mm/s. Make the saw axis faster (rpm, gearing, lead, acceleration), ` +
        `shorten the approach, raise the carriage speed${travelBound ? ' or give the carriage more travel' : minLen ? `, or cut parts of at least ${f(minLen, 0)} mm` : ', or cut longer parts'}.`;
    };
    let level = 'bad', pill, msg, hint;
    if (!M.okSpeed) {
      pill = 'Cannot synchronize';
      msg = `The material runs at ${num(M.v, 0)} mm/s but the carriage motor only reaches ${num(M.vc, 0)} mm/s.`;
      hint = `Lower the line speed below <b>${f(M.vc * 0.06, 1)} m/min</b>, or raise the carriage motor speed, change the gear ratio or the travel per revolution.`;
    } else if (!M.okTime) {
      pill = 'Too slow';
      msg = `Your cycle needs ${num(M.T, 3)} s but a part arrives every ${num(M.P, 3)} s. Parts would come out ${num(M.v * M.T, 0)} mm long.`;
      hint = feedHint();
    } else if (!M.okTravel) {
      pill = 'Out of travel';
      msg = `The carriage needs ${num(M.S, 0)} mm of travel but only has ${num(p.travel, 0)} mm.`;
      hint = feedHint();
    } else if (!M.okPeak) {
      pill = 'Motor too weak';
      msg = `The carriage motor needs ${num(M.tq.peak, 1)} N·m peak torque but delivers ${num(p.tPeak, 1)} N·m.`;
      hint = 'Lower the carriage acceleration, use more gear reduction, or reduce the moving mass or the motor inertia.';
    } else if (!M.okRms) {
      pill = 'Motor overloaded';
      msg = `The RMS torque is ${num(M.tq.rms, 1)} N·m, above the motor's rated ${num(p.tRated, 1)} N·m. The motor would overheat.`;
      hint = `Longer parts give the motor more rest${minLen ? `: from <b>${f(minLen, 0)} mm</b> the RMS torque fits` : ''}. Or lower the acceleration or the moving mass.`;
    } else {
      level = M.reserve < 0.05 ? 'warn' : 'ok';
      pill = level === 'warn' ? 'Works, but tight' : 'Works';
      msg = `Your cycle needs ${num(M.T, 3)} s of the ${num(M.P, 3)} s available (${f(M.reserve * 100, 0)} % reserve).`;
      hint = feedHint() + (level === 'warn' ? ' Less than 5 % reserve leaves little room for scan time and following error.' : '');
    }
    $('verdict').dataset.level = level;
    $('pill').textContent = pill;
    $('vmsg').innerHTML = msg;
    $('vhint').innerHTML = hint;

    const feedLow = M.feedMin != null && M.feedEff < M.feedMin * 0.999;
    const chips = [
      ['Line speed', M.okSpeed ? 'ok' : 'bad', `${f(M.v * 0.06, 1)} of ${f(M.vc * 0.06, 1)} m/min`],
      ['Cycle time', !M.okTime ? 'bad' : M.reserve < 0.05 ? 'warn' : 'ok', `${f(M.T, 3)} of ${f(M.P, 3)} s`],
      ['Travel', M.okTravel ? 'ok' : 'bad', `${f(M.S, 0)} of ${f(p.travel, 0)} mm`],
      ['Cutting feed', feedLow ? 'bad' : M.feedCapped ? 'warn' : 'ok',
        M.feedCapped ? `capped at ${f(M.vz, 0)} mm/s` : `${f(p.feed, 0)} mm/s${M.feedMin != null ? `, needs ${f(M.feedMin, 0)}` : ''}`],
      ['Motor torque', !torqueChecked() ? 'off' : M.okRms && M.okPeak ? 'ok' : 'bad',
        torqueChecked() ? `peak ${f(M.tq.peak, 1)}, RMS ${f(M.tq.rms, 1)} N·m` : 'no motor rating entered'],
    ];
    const ICON = { ok: '✓', warn: '!', bad: '✕', off: '–' };
    const WORD = { ok: 'passes', warn: 'warning', bad: 'fails', off: 'not checked' };
    $('checks').innerHTML = chips.map(([label, st, val]) =>
      `<li class="${st}"><span class="ico" aria-hidden="true">${ICON[st]}</span><span>${label}<span class="sr"> ${WORD[st]}</span></span><span class="val">${val}</span></li>`).join('');
  }

  function renderStats() {
    const torqueBad = torqueChecked() && !(M.okRms && M.okPeak);
    const tiles = [
      ['key', M.feedMin != null ? f(M.feedMin, 0) + '<small> mm/s</small>' : '—', 'Minimum cutting feed'],
      ['', f(M.P, 3) + '<small> s</small>', `Time per part (${f(60 / M.P, 1)} parts/min)`],
      [M.okTime ? '' : 'bad', f(M.T, 3) + '<small> s</small>', M.okTime ? `Cycle time used (${f(M.reserve * 100, 0)} % reserve)` : `Cycle time (${f(-M.reserve * 100, 0)} % too long)`],
      ['', M.tsLim != null ? f(M.tsLim, 3) + '<small> s</small>' : '—', 'Max. time synchronized'],
      [M.okTravel ? '' : 'bad', f(M.S, 0) + '<small> mm</small>', `Carriage stroke (of ${f(p.travel, 0)} mm)`],
      ['', vmax == null ? '—' : f(vmax, 1) + '<small> m/min</small>', 'Max. line speed with this setup'],
      ['', minLen == null ? '—' : f(minLen, 0) + '<small> mm</small>', `Shortest part at ${f(p.mpm, 1)} m/min`],
      [torqueBad ? 'bad' : '', hasLoad() ? `${f(M.tq.peak, 1)}<small> / ${f(M.tq.rms, 1)} N·m</small>` : '—', 'Carriage motor torque, peak / RMS'],
    ];
    $('stats').innerHTML = tiles.map(([c, v, l]) => `<div class="stat ${c}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  }

  /* ---------- where the time goes ---------- */
  const SHORT = { accel: 'Accel', settle: 'Settle', approach: 'Approach', cut: 'Cut', retract: 'Retract', decel: 'Decel', return: 'Return', dwell: 'Wait', reserve: 'Reserve', overrun: 'Overrun' };
  const AXIS = {
    accel: 'Carriage', settle: 'Carriage in sync', approach: 'Saw, carriage in sync', cut: 'Saw, carriage in sync',
    retract: 'Saw, carriage in sync', decel: 'Carriage', return: 'Carriage', dwell: 'Carriage at home',
  };
  let tip;

  function renderBudget() {
    const track = $('btrack'), axis = $('baxis');
    const scale = M.period, pct = t => t / scale * 100;
    track.textContent = '';
    axis.textContent = '';

    const segs = [];
    let t0 = 0;
    for (const ph of M.phases) { segs.push({ ...ph, t0 }); t0 += ph.t; }
    if (M.T < M.P - 1e-12) segs.push({ key: 'reserve', group: 'reserve', label: 'Reserve', t: M.P - M.T, t0: M.T });
    else if (M.T > M.P + 1e-12) segs.push({ key: 'overrun', group: 'overrun', label: 'Overrun past the next part', t: M.T - M.P, t0: M.P });

    const sync = document.createElement('div');
    sync.className = 'bsync';
    sync.style.left = pct(M.ta) + '%';
    sync.style.width = pct(M.ts) + '%';
    sync.innerHTML = `<span>synchronized ${f(M.ts, 3)} s</span>`;
    track.appendChild(sync);

    for (const s of segs) {
      if (!(s.t > 0)) continue;
      const el = document.createElement('div');
      el.className = 'bseg';
      el.dataset.g = s.group;
      el.style.left = pct(s.t0) + '%';
      el.style.width = s.group === 'overrun' ? pct(s.t) + '%' : `max(0px, calc(${pct(s.t)}% - 2px))`;
      el.tabIndex = 0;
      el.setAttribute('aria-label', `${s.label}: ${ms(s.t)}`);
      const span = document.createElement('span');
      span.textContent = SHORT[s.key];
      el.appendChild(span);
      const show = () => showTip(s, el);
      el.addEventListener('pointerenter', show);
      el.addEventListener('focus', show);
      el.addEventListener('pointerleave', hideTip);
      el.addEventListener('blur', hideTip);
      track.appendChild(el);
    }
    const lim = document.createElement('div');
    lim.className = 'bplimit';
    lim.style.left = `calc(${pct(M.P)}% - 1px)`;
    track.appendChild(lim);
    tip = document.createElement('div');
    tip.className = 'btip';
    tip.hidden = true;
    track.appendChild(tip);

    const zero = document.createElement('span');
    zero.style.left = '0';
    zero.textContent = '0 s';
    const plab = document.createElement('span');
    plab.style.left = pct(M.P) + '%';
    plab.style.transform = M.P < scale * 0.5 ? 'translateX(-50%)' : 'translateX(-100%)';
    plab.textContent = `next part at ${f(M.P, 3)} s`;
    axis.append(zero, plab);
    fitBudgetLabels();

    $('budgetNote').textContent = M.okTime
      ? `Cycle ${f(M.T, 3)} s of ${f(M.P, 3)} s part time`
      : `Cycle ${f(M.T, 3)} s, ${f(M.T - M.P, 3)} s longer than the part time`;

    $('ptbody').innerHTML = M.phases.map(ph =>
      `<tr><td><span class="sw" data-g="${ph.group}"></span>${ph.label}</td><td class="axis">${AXIS[ph.key]}</td>` +
      `<td>${ms(ph.t)}</td><td>${f(ph.t / M.P * 100, 1)} %</td></tr>`).join('');
    const rest = M.P - M.T;
    $('ptfoot').innerHTML =
      `<tr><td>Cycle total</td><td></td><td>${ms(M.T)}</td><td>${f(M.T / M.P * 100, 1)} %</td></tr>` +
      `<tr><td>${rest >= 0 ? 'Reserve' : 'Overrun'}</td><td></td><td>${ms(Math.abs(rest))}</td><td>${f(Math.abs(rest) / M.P * 100, 1)} %</td></tr>`;
  }

  function fitBudgetLabels() {
    for (const el of $('btrack').querySelectorAll('.bseg')) {
      el.classList.remove('tight');
      const span = el.firstChild;
      if (span.offsetWidth + 6 > el.clientWidth) el.classList.add('tight');
    }
  }
  function showTip(s, el) {
    tip.innerHTML = `<b>${ms(s.t)}</b> ${s.label}`;
    tip.style.left = `calc(${el.style.left} + ${el.offsetWidth / 2}px)`;
    tip.hidden = false;
  }
  function hideTip() { if (tip) tip.hidden = true; }

  /* ---------- canvases ---------- */
  const css = {};
  const TOKENS = ['bg', 'panel', 'ink', 'muted', 'line', 'accent', 'ok', 'bad', 'steel', 'mat', 'matEdge', 'mark', 'ref', 'rail', 'sync', 'blade', 'spark', 'g-sync'];
  function readColors() {
    const s = getComputedStyle(document.documentElement);
    for (const k of TOKENS) css[k] = s.getPropertyValue('--' + k).trim();
  }

  function surface(id) {
    const c = $(id);
    return { c, g: c.getContext('2d'), w: 1, h: +c.dataset.h, dpr: 1 };
  }
  function fit(s) {
    const dpr = window.devicePixelRatio || 1;
    s.w = Math.max(1, s.c.clientWidth);
    s.h = +s.c.dataset.h;                       // logical height lives in data-h, so repeated fits never compound
    s.dpr = dpr;
    const W = Math.round(s.w * dpr), H = Math.round(s.h * dpr);
    if (s.c.width !== W) s.c.width = W;
    if (s.c.height !== H) s.c.height = H;
    s.c.style.height = s.h + 'px';
  }

  const sim = surface('sim');
  const charts = ['chart1', 'chart2', 'chart3'].map((id, i) => ({
    ...surface(id), ro: $('ro' + (i + 1)), layer: document.createElement('canvas'),
    L: 56, R: 14, T: 14, B: 28, spec: null, last: '',
  }));

  function niceStep(span, n) {
    const raw = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
  }
  function ticks(a, b, n) {
    if (!(b > a)) return { list: [a], dec: 0 };
    const step = niceStep(b - a, n), list = [];
    const first = Math.ceil(a / step - 1e-9);
    for (let i = first; i * step <= b + step * 1e-9; i++) list.push(i === 0 ? 0 : i * step);
    const mag = Math.floor(Math.log10(step) + 1e-9);
    const dec = Math.max(0, -mag + (Math.abs(step / Math.pow(10, mag) - 2.5) < 1e-9 ? 1 : 0));
    return { list, dec };
  }

  /* ---------- charts: a cached static layer plus a per-frame cursor ---------- */
  function chartSpecs() {
    let vmin = 0, vmaxS = M.v, tqmax = 0;
    const n = 600;
    const samples = [];
    for (let i = 0; i <= n; i++) {
      const s = FS.stateAt(M, p, M.period * i / n);
      samples.push(s);
      vmin = Math.min(vmin, s.v); vmaxS = Math.max(vmaxS, s.v); tqmax = Math.max(tqmax, Math.abs(s.torque));
    }
    const H = Math.max(M.A + M.C, 1);
    const tqLim = Math.max(tqmax, p.tRated || 0, p.tPeak || 0) * 1.15 || 1;
    const torqueRefs = [];
    if (hasLoad()) torqueRefs.push({ y: M.tq.rms, color: css.muted, dash: [5, 4], label: `RMS ${f(M.tq.rms, 1)} N·m` }, { y: -M.tq.rms, color: css.muted, dash: [5, 4] });
    if (p.tRated > 0) torqueRefs.push({ y: p.tRated, color: css.bad, dash: [2, 3], label: 'rated' }, { y: -p.tRated, color: css.bad, dash: [2, 3] });
    if (p.tPeak > 0) torqueRefs.push({ y: p.tPeak, color: css.bad, dash: [6, 3], label: 'peak' }, { y: -p.tPeak, color: css.bad, dash: [6, 3] });
    return [
      {
        y0: vmin * 0.06 * 1.12, y1: vmaxS * 0.06 * 1.18, unit: 'm/min', samples, val: s => s.v * 0.06,
        refs: [{ y: M.v * 0.06, color: css.ref, dash: [5, 4], label: `material ${f(M.v * 0.06, 1)} m/min` }],
        read: (t, s) => `<b>${f(t, 3)} s</b> · carriage <b>${f(s.v * 0.06, 1)} m/min</b> · ${s.phase}`,
      },
      {
        y0: 0, y1: H * 1.08, invert: true, unit: 'mm down', samples, val: s => s.z,
        refs: M.A > 0 ? [{ y: M.A, color: css.ref, dash: [5, 4], label: 'material top' }] : [],
        read: (t, s) => `<b>${f(t, 3)} s</b> · blade <b>${f(s.z, 1)} mm</b> down · moving <b>${f(Math.abs(s.vz), 0)} mm/s</b>`,
      },
      {
        y0: -tqLim, y1: tqLim, unit: 'N·m', samples, val: s => s.torque, refs: torqueRefs, hidden: !hasLoad(),
        read: (t, s) => `<b>${f(t, 3)} s</b> · torque <b>${f(s.torque, 1)} N·m</b> at <b>${f(Math.abs(s.rpm), 0)} rpm</b>`,
      },
    ];
  }

  function drawStatic() {
    if (!M) return;
    const specs = chartSpecs();
    charts.forEach((ch, i) => { ch.spec = specs[i]; ch.last = ''; });
    $('chart3').hidden = specs[2].hidden;
    $('torqueEmpty').hidden = !specs[2].hidden;
    $('torqueLegend').hidden = specs[2].hidden;
    for (const ch of charts) {
      if (ch.spec.hidden) continue;
      fit(ch);
      renderLayer(ch);
    }
    dirty = true;
  }

  function renderLayer(ch) {
    const { w, h, dpr, L, R, T, B, spec } = ch;
    const W = Math.max(10, w - L - R), H = h - T - B, Pa = M.period;
    ch.tx = t => L + t / Pa * W;
    ch.x2t = x => Math.min(Pa, Math.max(0, (x - L) / W * Pa));
    ch.ty = spec.invert ? y => T + (y - spec.y0) / (spec.y1 - spec.y0) * H : y => T + (spec.y1 - y) / (spec.y1 - spec.y0) * H;
    ch.layer.width = ch.c.width;
    ch.layer.height = ch.c.height;
    const g = ch.layer.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = '11px Barlow, system-ui, sans-serif';

    // horizontal grid with value labels
    const yt = ticks(Math.min(spec.y0, spec.y1), Math.max(spec.y0, spec.y1), Math.max(2, Math.floor(H / 34)));
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const v of yt.list) {
      const y = Math.round(ch.ty(v)) + 0.5;
      g.strokeStyle = css.line; g.lineWidth = v === 0 ? 1.5 : 1;
      g.globalAlpha = v === 0 ? 1 : 0.7;
      g.beginPath(); g.moveTo(L, y); g.lineTo(L + W, y); g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = css.muted;
      g.fillText(f(v, yt.dec), L - 6, y);
    }
    g.save(); g.translate(12, T + H / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(spec.unit, 0, 0); g.restore();

    // time axis
    const xt = ticks(0, Pa, Math.max(3, Math.floor(W / 64)));
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (const t of xt.list) {
      const x = Math.round(ch.tx(t)) + 0.5;
      g.strokeStyle = css.line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, T + H); g.lineTo(x, T + H + 4); g.stroke();
      g.fillStyle = css.muted;
      g.fillText(f(t, xt.dec) + ' s', Math.min(Math.max(x, L + 12), L + W - 12), h - 8);
    }

    // reference lines
    for (const r of spec.refs) {
      const y = ch.ty(r.y);
      g.strokeStyle = r.color; g.lineWidth = 1.5; g.setLineDash(r.dash);
      g.beginPath(); g.moveTo(L, y); g.lineTo(L + W, y); g.stroke();
      g.setLineDash([]);
      if (r.label) { g.fillStyle = css.muted; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(r.label, L + W - 4, y - 3); }
    }

    // next part arrives
    const xp = ch.tx(M.P);
    g.strokeStyle = css.bad; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(xp, T); g.lineTo(xp, T + H); g.stroke();

    // the series
    g.strokeStyle = css.accent; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath();
    spec.samples.forEach((s, i) => {
      const x = ch.tx(Pa * i / (spec.samples.length - 1)), y = ch.ty(spec.val(s));
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke();
  }

  function drawCursor(ch, t, s) {
    if (ch.spec.hidden) return;
    const g = ch.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, ch.c.width, ch.c.height);
    g.drawImage(ch.layer, 0, 0);
    g.setTransform(ch.dpr, 0, 0, ch.dpr, 0, 0);
    const x = ch.tx(t), y = ch.ty(ch.spec.val(s));
    g.strokeStyle = css.ink; g.globalAlpha = 0.45; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, ch.T); g.lineTo(x, ch.h - ch.B); g.stroke();
    g.globalAlpha = 1;
    g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2);
    g.fillStyle = css.accent; g.fill();
    g.lineWidth = 2; g.strokeStyle = css.panel; g.stroke();
    const txt = ch.spec.read(t, s);
    if (txt !== ch.last) { ch.ro.innerHTML = txt; ch.last = txt; }
  }

  /* ---------- side view ---------- */
  function drawSim(tau, st) {
    const { g, w, h } = sim, m = M;
    g.setTransform(sim.dpr, 0, 0, sim.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const Pa = m.period, spacing = m.v * Pa;
    const margin = Math.min(spacing * 0.6, 400);
    const xmin = -m.sa - margin, xmax = Math.max(m.S, p.travel) + margin;
    const pad = 14, sx = x => pad + (x - xmin) / (xmax - xmin) * (w - 2 * pad);
    const railY = 50, matTop = 142, matH = 34, matBot = matTop + matH, rulerY = matBot + 16;
    const font = (wgt, px, fam) => `${wgt} ${px}px ${fam === 'd' ? '"Barlow Condensed"' : 'Barlow'}, system-ui, sans-serif`;

    // synchronized window
    const s0 = sx(m.sa), s1 = sx(m.sa + m.v * m.ts);
    g.fillStyle = css.sync;
    g.fillRect(s0, railY - 14, s1 - s0, matBot + 6 - (railY - 14));
    g.font = font(500, 12); g.textAlign = 'center'; g.fillStyle = css.accent;
    g.fillText('synchronized', (s0 + s1) / 2, railY - 20);

    // rail, home and travel limit
    g.fillStyle = css.rail;
    g.fillRect(sx(-30), railY - 3, sx(p.travel + 30) - sx(-30), 6);
    g.lineWidth = 1; g.setLineDash([3, 3]);
    g.strokeStyle = css.muted; g.beginPath(); g.moveTo(sx(0), railY - 16); g.lineTo(sx(0), rulerY); g.stroke();
    g.strokeStyle = css.bad; g.beginPath(); g.moveTo(sx(p.travel), railY - 16); g.lineTo(sx(p.travel), rulerY); g.stroke();
    g.setLineDash([]);

    // ruler in mm from home
    const rt = ticks(0, p.travel, Math.max(2, Math.floor((sx(p.travel) - sx(0)) / 70)));
    g.strokeStyle = css.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(sx(0), rulerY + 0.5); g.lineTo(sx(p.travel), rulerY + 0.5); g.stroke();
    g.font = font(400, 11); g.fillStyle = css.muted;
    const homeX = sx(0), limX = sx(p.travel);
    for (const v of rt.list) {
      const X = Math.round(sx(v)) + 0.5;
      g.beginPath(); g.moveTo(X, rulerY); g.lineTo(X, rulerY + 4); g.stroke();
      if (v > 0 && X - homeX > 34 && limX - X > 52) g.fillText(f(v, rt.dec), X, rulerY + 16);
    }
    g.fillText('home', homeX, rulerY + 16);
    g.fillStyle = css.bad;
    g.fillText(`limit ${f(p.travel, 0)} mm`, limX, rulerY + 16);

    // material, marks and finished cuts
    g.fillStyle = css.mat; g.fillRect(0, matTop, w, matH);
    g.fillStyle = css.matEdge; g.fillRect(0, matTop, w, 2);
    const cutDone = tau > m.ta + m.settle + m.tApp + m.tCut;
    const cuts = [];
    for (let k = -40; k <= 40; k++) {
      const x = -m.sa + m.v * tau - k * spacing;
      if (x < xmin - spacing || x > xmax + spacing) continue;
      const X = sx(x);
      if (k < 0 || (k === 0 && cutDone)) { cuts.push(X); g.fillStyle = css.panel; g.fillRect(X - 2, matTop, 4, matH); }
      else { g.strokeStyle = css.mark; g.lineWidth = 2; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X, matTop - 4); g.lineTo(X, matBot + 4); g.stroke(); g.setLineDash([]); }
    }
    cuts.sort((a, b) => a - b);
    g.font = font(600, 12, 'd'); g.fillStyle = css.mark; g.textBaseline = 'middle';
    const pieceLabel = `${f(spacing, 0)} mm`, labelW = g.measureText(pieceLabel).width + 16;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = Math.max(cuts[i], 0), b = Math.min(cuts[i + 1], w);
      if (b - a > labelW) g.fillText(pieceLabel, (a + b) / 2, matTop + matH / 2 + 1);
    }
    g.textBaseline = 'alphabetic';
    g.font = font(400, 12); g.fillStyle = css.muted; g.textAlign = 'left';
    g.fillText(`material ${f(p.mpm, 1)} m/min →`, 8, h - 8);

    // carriage on the rail
    const X = sx(st.x);
    g.fillStyle = css.steel;
    g.fillRect(X - 28, railY - 11, 56, 22);
    g.fillRect(X - 10, railY + 11, 20, 12);
    g.fillStyle = css.panel;
    g.fillRect(X - 22, railY - 2, 44, 4);

    // blade: bottom edge goes from 30 px above the material, touches it at the end of the approach, exits below
    const r = 22, H = m.A + m.C, a = H > 0 ? m.A / H : 0, fr = H > 0 ? Math.max(0, Math.min(1, st.z / H)) : 0;
    let bottom;
    if (a === 0) bottom = (matTop - 30) + fr * (matH + 36);
    else if (fr < a) bottom = (matTop - 30) + (fr / a) * 30;
    else bottom = matTop + (a < 1 ? (fr - a) / (1 - a) : 1) * (matH + 6);
    const by = bottom - r;
    g.fillStyle = css.steel;
    g.fillRect(X - 3, railY + 23, 6, Math.max(0, by - railY - 23));
    const rot = simT * 40, teeth = 24;
    g.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const an = rot + i * Math.PI / teeth, rr = i % 2 ? r : r + 3;
      const px = X + Math.cos(an) * rr, py = by + Math.sin(an) * rr;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath();
    g.fillStyle = css.blade; g.globalAlpha = 0.9; g.fill(); g.globalAlpha = 1;
    g.strokeStyle = css.steel; g.lineWidth = 1.5; g.stroke();
    g.beginPath();
    for (let i = 0; i < 3; i++) { const an = rot + i * 2.094; g.moveTo(X, by); g.lineTo(X + Math.cos(an) * r * 0.75, by + Math.sin(an) * r * 0.75); }
    g.stroke();
    g.beginPath(); g.arc(X, by, 4, 0, Math.PI * 2); g.fillStyle = css.steel; g.fill();

    // sparks while the blade is in the material
    if (st.tag === 'cut' && bottom > matTop + 2) {
      const seed = Math.floor(simT * 60);
      const rnd = i => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
      const sy = Math.min(bottom, matBot);
      g.strokeStyle = css.spark; g.lineWidth = 1.5;
      for (let i = 0; i < 14; i++) {
        const an = Math.PI * (0.55 + 0.4 * rnd(i)), len = 6 + 16 * rnd(i + 50), d0 = 3 + 6 * rnd(i + 99);
        g.globalAlpha = 0.35 + 0.6 * rnd(i + 7);
        g.beginPath();
        g.moveTo(X + Math.cos(an) * d0 * -1, sy + Math.sin(an) * d0);
        g.lineTo(X + Math.cos(an) * (d0 + len) * -1, sy + Math.sin(an) * (d0 + len));
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    // speed readout above the carriage
    g.fillStyle = css.ink; g.textAlign = 'center'; g.font = font(600, 13, 'd');
    const vm = st.v * 0.06, vtxt = Math.abs(vm) < 0.05 ? '0.0 m/min' : vm > 0 ? `${f(vm, 1)} m/min →` : `← ${f(-vm, 1)} m/min`;
    g.fillText(vtxt, Math.min(Math.max(X, 44), w - 44), 16);
  }

  /* ---------- playback ---------- */
  let simT = 0, last = null, speedF = 1, hoverT = null, dirty = true;
  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const playBtn = $('play'), scrub = $('scrub');
  const setPlaying = on => { playing = on; playBtn.textContent = on ? 'Pause' : 'Play'; dirty = true; };
  setPlaying(playing);
  playBtn.addEventListener('click', () => setPlaying(!playing));
  $('speed').addEventListener('change', e => { speedF = parseFloat(e.target.value); });

  const cycleStart = () => Math.floor(simT / M.period) * M.period;
  const seek = t => { simT = cycleStart() + Math.min(Math.max(t, 0), M.period * 0.999999); dirty = true; };
  const step = dt => { simT = Math.max(0, simT + dt); dirty = true; };

  scrub.addEventListener('input', () => { setPlaying(false); seek(scrub.value / 1000 * M.period); });

  for (const ch of charts) {
    let drag = null;
    const scrubTo = e => { setPlaying(false); seek(ch.x2t(e.offsetX)); };
    ch.c.addEventListener('pointerdown', e => {
      if (e.button > 0 || !ch.x2t) return;
      drag = { id: e.pointerId, moved: false };
      if (e.pointerType === 'mouse') { ch.c.setPointerCapture(e.pointerId); scrubTo(e); }
    });
    ch.c.addEventListener('pointermove', e => {
      if (!ch.x2t) return;
      hoverT = ch.x2t(e.offsetX);
      if (drag && drag.id === e.pointerId) { drag.moved = true; scrubTo(e); }
      dirty = true;
    });
    ch.c.addEventListener('pointerup', e => {
      if (drag && drag.id === e.pointerId && !drag.moved && e.pointerType !== 'mouse') scrubTo(e);
      drag = null;
      if (e.pointerType !== 'mouse') hoverT = null;
      dirty = true;
    });
    ch.c.addEventListener('pointercancel', () => { drag = null; hoverT = null; dirty = true; });
    ch.c.addEventListener('pointerleave', () => { if (!drag) { hoverT = null; dirty = true; } });
  }

  document.addEventListener('keydown', e => {
    const t = e.target;
    if (e.altKey || e.ctrlKey || e.metaKey || t.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(t.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setPlaying(false);
      step((e.key === 'ArrowRight' ? 1 : -1) * M.period * (e.shiftKey ? 0.05 : 0.005));
    }
  });

  let lastText = {};
  const setText = (id, txt) => { if (lastText[id] !== txt) { $(id).textContent = txt; lastText[id] = txt; } };

  function frame(now) {
    const dt = last == null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) { simT += dt * speedF; dirty = true; }
    if (dirty && M) {
      dirty = false;
      const Pa = M.period, tau = ((simT % Pa) + Pa) % Pa;
      const st = FS.stateAt(M, p, tau);
      drawSim(tau, st);
      const tc = hoverT != null ? hoverT : tau;
      const sc = hoverT != null ? FS.stateAt(M, p, tc) : st;
      for (const ch of charts) drawCursor(ch, tc, sc);
      if (document.activeElement !== scrub || playing) scrub.value = Math.round(tau / Pa * 1000);
      setText('tread', `${f(tau, 3)} / ${f(Pa, 3)} s`);
      setText('parts', `${Math.max(0, Math.floor(simT / Pa))} parts cut`);
      setText('phase', st.phase);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- export, sharing, reset ---------- */
  const embedded = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  if (embedded) { $('copyLink').hidden = true; $('dlCsv').hidden = true; }
  // A file:// link (single-file version, desktop app) only opens on this computer, so there is nothing to share.
  if (location.protocol === 'file:') $('copyLink').hidden = true;

  function copyText(text, btn, done) {
    const orig = btn.textContent;
    const fallback = () => { $('fallback').hidden = false; const ta = $('fallbackText'); ta.value = text; ta.focus(); ta.select(); };
    try {
      navigator.clipboard.writeText(text).then(() => { btn.textContent = done; setTimeout(() => { btn.textContent = orig; }, 1600); }, fallback);
    } catch (e) { fallback(); }
  }
  $('fallbackClose').addEventListener('click', () => { $('fallback').hidden = true; });

  function csvText() {
    const Pa = M.period, n = Math.min(5000, Math.max(10, Math.round(Pa / 0.001)));
    const rows = ['time_s,carriage_pos_mm,carriage_vel_mm_s,carriage_acc_mm_s2,motor_speed_rpm,motor_torque_Nm,saw_pos_mm,saw_vel_mm_s,phase'];
    for (let i = 0; i <= n; i++) {
      const t = Pa * i / n, s = FS.stateAt(M, p, t);
      rows.push([t.toFixed(4), s.x.toFixed(3), s.v.toFixed(3), s.a.toFixed(1), s.rpm.toFixed(1), s.torque.toFixed(3), s.z.toFixed(3), s.vz.toFixed(3), s.tag].join(','));
    }
    return rows.join('\n') + '\n';
  }
  $('copyCsv').addEventListener('click', e => copyText(csvText(), e.currentTarget, 'CSV copied'));
  $('dlCsv').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([csvText()], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `flying-saw_${p.mpm}mpm_${p.len}mm.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('copyLink').addEventListener('click', e => { persist(); copyText(location.href, e.currentTarget, 'Link copied'); });
  $('reset').addEventListener('click', () => {
    Object.assign(p, FS.DEFAULTS);
    for (const k in inputs) { inputs[k].value = p[k]; inputs[k].removeAttribute('aria-invalid'); inputs[k].title = ''; markChanged(k); }
    recompute();
  });

  /* ---------- boot ---------- */
  function resize() {
    fit(sim);
    drawStatic();
    if (M) fitBudgetLabels();
    dirty = true;
  }
  const themeChanged = () => { readColors(); drawStatic(); };
  readColors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
  new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  if (window.ResizeObserver) new ResizeObserver(resize).observe(document.querySelector('.wrap'));
  window.addEventListener('resize', resize);
  fit(sim);
  recompute();
  if (document.fonts) document.fonts.ready.then(resize);
  requestAnimationFrame(frame);
}());
