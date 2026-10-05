'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const FS = require('../motion.js');
const P = require('../project.js');

const KEYS = Object.keys(FS.DEFAULTS);
const isValid = (k, x) => Number.isFinite(x) && x >= 0;

test('a project file round-trips every value', () => {
  const params = { ...FS.DEFAULTS, mpm: 24.5, len: 750, appSpeed: 80, cVmax: 400 };
  const text = JSON.stringify(P.toProject(params, KEYS));
  const file = JSON.parse(text);
  assert.equal(file.type, 'flying-saw-project');
  assert.equal(file.format, 1);
  assert.deepEqual(Object.keys(file.params), KEYS, 'all values are written, not only the changed ones');
  const { params: back, rejected } = P.fromProject(text, KEYS, isValid);
  assert.deepEqual(back, params);
  assert.deepEqual(rejected, []);
});

test('bare value objects, numeric strings and missing keys are accepted', () => {
  const { params, rejected } = P.fromProject('{"mpm": "30", "len": 1200, "somethingElse": 5}', KEYS, isValid);
  assert.deepEqual(params, { mpm: 30, len: 1200 });
  assert.deepEqual(rejected, []);
});

test('invalid values are reported and left out', () => {
  const file = P.toProject({ ...FS.DEFAULTS }, KEYS);
  Object.assign(file.params, { cGear: -2, zLead: 'abc', feed: null, settle: '' });
  const { params, rejected } = P.fromProject(JSON.stringify(file), KEYS, isValid);
  assert.deepEqual(rejected.sort(), ['cGear', 'feed', 'settle', 'zLead']);
  assert.equal(params.mpm, FS.DEFAULTS.mpm);
  assert.ok(!('cGear' in params));
});

test('files that are not projects are refused with a message', () => {
  for (const text of ['not json', '[1, 2]', '"text"', 'null', '{"name": "x"}', '{"type": "flying-saw-project"}']) {
    assert.throws(() => P.fromProject(text, KEYS, isValid), /not a Flying Saw project/, text);
  }
  const newer = JSON.stringify({ type: 'flying-saw-project', format: 99, params: { mpm: 10 } });
  assert.throws(() => P.fromProject(newer, KEYS, isValid), /newer version/);
});
