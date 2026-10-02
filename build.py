#!/usr/bin/env python3
"""Build Flying Saw Simulator for distribution.

    python3 build.py html        dist/FlyingSaw.html        one file, works offline (needs only Python)
    python3 build.py exe         + dist/FlyingSaw.exe       Windows program (needs Go)
    python3 build.py installer   + dist/FlyingSaw-Setup.exe Windows installer (needs Go and NSIS)

Without an argument it builds everything. Go and NSIS can run on Linux, macOS or Windows; the exe is
always built for 64-bit Windows.
"""
import base64
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
DESKTOP = ROOT / 'desktop'
GO_WINRES = 'github.com/tc-hib/go-winres@v0.3.3'
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']

MIME = {'.woff2': 'font/woff2', '.png': 'image/png'}


def data_uri(path):
    return f'data:{MIME[path.suffix]};base64,' + base64.b64encode(path.read_bytes()).decode('ascii')


def inline_css(path):
    css = path.read_text(encoding='utf-8')
    css = re.sub(r'url\(([^)"\':]+)\)', lambda m: f'url({data_uri(path.parent / m.group(1))})', css)
    if re.search(r'</style', css, re.I):
        sys.exit(f'{path.name} contains "</style", which would end the inline style early')
    return f'<style>\n{css.strip()}\n</style>'


def inline_js(path):
    js = path.read_text(encoding='utf-8')
    if re.search(r'</script|<!--', js, re.I):
        sys.exit(f'{path.name} contains "</script" or "<!--", which would break the inline script')
    return f'<script>\n{js.strip()}\n</script>'


def build_html():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', lambda m: inline_css(ROOT / m.group(1)), html)
    html = re.sub(r'<script src="([^"]+)"></script>', lambda m: inline_js(ROOT / m.group(1)), html)
    html = re.sub(r'<link rel="icon" href="([^"]+)">',
                  lambda m: f'<link rel="icon" href="{data_uri(ROOT / m.group(1))}">', html)
    banner = (f'<!-- Flying Saw Simulator {VERSION}, single-file build (python3 build.py html).\n'
              '     Fonts: Barlow and Barlow Condensed, Copyright 2017 The Barlow Project Authors,\n'
              '     licensed under the SIL Open Font License 1.1 (https://openfontlicense.org). -->\n')
    html = html.replace('<!DOCTYPE html>\n', '<!DOCTYPE html>\n' + banner, 1)

    # Everything must be inside the file: no links to other files or to the internet.
    outside = re.findall(r'(?:src|href)="(?!data:|#)[^"]*"|url\((?!data:)[^)]*\)', html)
    if outside:
        sys.exit('single-file build still refers to other files: ' + ', '.join(outside))

    DIST.mkdir(exist_ok=True)
    out = DIST / 'FlyingSaw.html'
    out.write_text(html, encoding='utf-8', newline='\n')
    shutil.copyfile(out, DESKTOP / 'FlyingSaw.html')  # embedded into the exe
    print(f'built {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)')


def tool(name, windows_default=None):
    found = shutil.which(name)
    if not found and windows_default and Path(windows_default).exists():
        found = windows_default
    if not found:
        sys.exit(f'{name} not found. Install it first (see README, "Building").')
    return found


def run(cmd, cwd=ROOT, env=None):
    print('>', ' '.join(str(c) for c in cmd))
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def build_exe():
    go = tool('go')
    parts = (VERSION.split('.') + ['0', '0', '0'])[:4]
    full = '.'.join(parts)
    winres = {
        'RT_GROUP_ICON': {'#1': {'0000': '../assets/icon.ico'}},
        'RT_MANIFEST': {'#1': {'0409': {
            'identity': {'name': 'FlyingSaw.Simulator', 'version': full},
            'description': 'Flying Saw Simulator',
            'minimum-os': 'win10',
            'execution-level': 'as invoker',
            'dpi-awareness': 'per monitor v2',
            'use-common-controls-v6': True,
        }}},
        'RT_VERSION': {'#1': {'0000': {
            'fixed': {'file_version': full, 'product_version': full},
            'info': {'0409': {
                'FileDescription': 'Flying Saw Simulator',
                'ProductName': 'Flying Saw Simulator',
                'FileVersion': VERSION,
                'ProductVersion': VERSION,
                'OriginalFilename': 'FlyingSaw.exe',
                'InternalName': 'FlyingSaw',
                'Comments': 'Cycle calculator and live simulation for a flying saw',
            }},
        }}},
    }
    winres_json = DESKTOP / 'winres.json'
    winres_json.write_text(json.dumps(winres, indent=2), encoding='utf-8')
    try:
        # go-winres runs on this machine, so it is started without the Windows target settings.
        run([go, 'run', GO_WINRES, 'make', '--in', winres_json.name, '--out', 'rsrc', '--arch', 'amd64'], cwd=DESKTOP)
    finally:
        winres_json.unlink()

    env = dict(os.environ, GOOS='windows', GOARCH='amd64', CGO_ENABLED='0')
    out = DIST / 'FlyingSaw.exe'
    run([go, 'build', '-trimpath', '-ldflags', f'-s -w -H windowsgui -X main.version={VERSION}', '-o', str(out), '.'],
        cwd=DESKTOP, env=env)
    print(f'built {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)')


def build_installer():
    makensis = tool('makensis', r'C:\Program Files (x86)\NSIS\makensis.exe')
    run([makensis, '-V2', f'-DVERSION={VERSION}', 'installer/FlyingSaw.nsi'])
    out = DIST / 'FlyingSaw-Setup.exe'
    print(f'built {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)')


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else 'installer'
    steps = {'html': [build_html], 'exe': [build_html, build_exe], 'installer': [build_html, build_exe, build_installer]}
    if target not in steps:
        sys.exit(__doc__)
    for step in steps[target]:
        step()


if __name__ == '__main__':
    main()
