/*
 * Flying saw project files: the machine data as JSON. No DOM.
 * Loads as a classic script in the browser (global `FlyingSawProject`) and through require() in Node tests.
 *
 * File layout:
 *   { "type": "flying-saw-project", "format": 1, "saved": "2026-10-05T12:00:00.000Z",
 *     "params": { "mpm": 18, "len": 500, ... } }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlyingSawProject = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TYPE = 'flying-saw-project';
  const FORMAT = 1;

  // Every value is written, not only the changed ones, so a project opens the same even if a later
  // version changes the defaults.
  function toProject(params, keys) {
    const out = {};
    for (const k of keys) out[k] = params[k];
    return { type: TYPE, format: FORMAT, saved: new Date().toISOString(), params: out };
  }

  const toNumber = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

  // Reads a project file's text. Returns { params, rejected }: the valid values, and the keys whose values
  // were not valid (left out, so they keep their defaults). Keys missing from the file are left out too.
  // Throws an Error with a message for the user when the file is not a project at all.
  function fromProject(text, keys, isValid) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('This file is not a Flying Saw project (it is not JSON).'); }
    if (obj && typeof obj === 'object' && obj.type === TYPE) {
      if (obj.format > FORMAT) throw new Error('This project was saved by a newer version of Flying Saw Simulator. Update the program to open it.');
      obj = obj.params;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('This file is not a Flying Saw project (no machine data found).');

    const params = {}, rejected = [];
    for (const k of keys) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      const x = toNumber(obj[k]);
      if (isValid(k, x)) params[k] = x; else rejected.push(k);
    }
    if (!Object.keys(params).length && !rejected.length) throw new Error('This file is not a Flying Saw project (no machine data found).');
    return { params, rejected };
  }

  return { TYPE, FORMAT, toProject, fromProject };
}));
