#!/usr/bin/env python3
"""Check the report that `FlyingSaw.exe --smoke report.json` writes. Used by the Windows CI job."""
import json
import sys

report = json.load(open(sys.argv[1], encoding='utf-8'))
print(json.dumps(report, indent=2))

if 'error' in report:
    sys.exit(f"FAIL: {report['error']}")
checks = {
    'verdict for the default setup is "Works"': report['pill'] == 'Works',
    'all machine data fields are there': report['inputs'] >= 20,
    'no script errors': not report['errors'],
    'page runs from the local file': report['protocol'] == 'file:',
    'settings can be saved': report['storage'],
    'embedded fonts are used': report['fonts'],
    '"Copy link" is hidden': report['copyLinkHidden'],
}
for name, ok in checks.items():
    print(('ok   ' if ok else 'FAIL ') + name)
sys.exit(0 if all(checks.values()) else 1)
