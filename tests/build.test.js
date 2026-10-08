'use strict';
// Builds the single-file HTML (python3 build.py html) and checks that nothing in it points outside the
// file, so a half-broken build (missing script, font or icon) cannot ship. build.py has its own check;
// this one is independent of it and also looks at @import, the inlined code and the version banner.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'FlyingSaw.html');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const py = ['python3', 'python'].find(c => spawnSync(c, ['--version']).status === 0);

test('single-file HTML build is self-contained', { skip: !py && 'Python 3 not installed' }, () => {
  const run = spawnSync(py, ['build.py', 'html'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const html = fs.readFileSync(OUT, 'utf8');

  // every src= / href= is a data: URI or an in-page #anchor
  const refs = [...html.matchAll(/\s(?:src|href|poster|srcset|data)\s*=\s*["']?([^"'\s>]*)/gi)].map(m => m[1]);
  assert.deepEqual(refs.filter(r => !/^(data:|#)/.test(r)), [], 'attributes that point to other files');

  // no CSS url() or @import that is not an inline data: URI
  assert.deepEqual([...html.matchAll(/(?<![\w.])url\(\s*["']?(?!data:)[^)]*\)/g)].map(m => m[0]), [], 'url() outside the file');
  assert.deepEqual(html.match(/@import\b[^;]*/gi) ?? [], []);

  // the inlined parts are really there
  assert.equal((html.match(/<link rel="icon" href="data:image\/png;base64,/g) || []).length, 1, 'icon');
  assert.equal((html.match(/url\(data:font\/woff2;base64,/g) || []).length, 6, 'six embedded fonts');
  for (const marker of ['root.FlyingSaw = api', 'root.FlyingSawProject = api', 'window.FlyingSawProject']) {
    assert.ok(html.includes(marker), `inlined script code is missing (${marker})`);
  }
  assert.ok(html.includes(`Flying Saw Simulator ${VERSION}, single-file build`), 'version banner matches package.json');
});
