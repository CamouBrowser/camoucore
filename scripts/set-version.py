#!/usr/bin/env python3
"""Set every version this repository writes to one version, or check that they agree.

camoucore is one package per registry, released at one version: PyPI's
(python/camoucore/pyproject.toml) and npm's (typescript/camoucore/package.json),
and each TypeScript launcher's LIBRARY_VERSION
(typescript/camoucore/src/<launcher>/__version__.ts), which the CLI prints
where the Python launcher reads its installed version.

Usage:
    python3 scripts/set-version.py 0.6.1     # write the version everywhere
    python3 scripts/set-version.py --check   # non-zero if any file disagrees

npm spelling 0.6.1-beta.2 is PyPI spelling 0.6.1b2. Give the npm spelling and
each file gets its own.
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT = ROOT / 'python' / 'camoucore' / 'pyproject.toml'
PACKAGE_JSON = ROOT / 'typescript' / 'camoucore' / 'package.json'
VERSION_RE = re.compile(r'^\d+\.\d+\.\d+(-beta\.\d+)?$')


def pep440(version: str) -> str:
    return re.sub(r'-beta\.(\d+)$', r'b\1', version)


# (file, pattern, replacement for a version) for each place a version is written.
# Each pattern's group 1 is the version, and must match exactly once.
def places():
    yield PYPROJECT, re.compile(r'^version = "([^"]+)"$', re.M), pep440
    yield PACKAGE_JSON, re.compile(r'^  "version": "([^"]+)",$', re.M), str
    version_ts = sorted(PACKAGE_JSON.parent.glob('src/*/__version__.ts'))
    if not version_ts:
        sys.exit(f'no src/<launcher>/__version__.ts under {PACKAGE_JSON.parent.relative_to(ROOT)}')
    for path in version_ts:
        yield path, re.compile(r'^export const LIBRARY_VERSION = "([^"]+)";$', re.M), str


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument('version', nargs='?', help='the version to set, in npm spelling')
    group.add_argument('--check', action='store_true', help='verify that every file agrees')
    args = ap.parse_args()

    if args.version and not VERSION_RE.match(args.version):
        sys.exit(f'{args.version!r} is not a version like 0.6.1 or 0.6.1-beta.2')

    found = {}
    problems = []
    for path, pattern, spell in places():
        text = path.read_text()
        matches = pattern.findall(text)
        where = f'{path.relative_to(ROOT)} ({pattern.pattern})'
        if len(matches) != 1:
            problems.append(f'{where}: expected one match, found {len(matches)}')
            continue
        found[where] = (matches[0], spell)
        if args.version:
            path.write_text(pattern.sub(lambda m: m.group(0).replace(m.group(1), spell(args.version)), text))

    if args.version:
        for problem in problems:
            print(problem, file=sys.stderr)
        print(f'set {len(found)} places to {args.version}')
        return 1 if problems else 0

    # --check: npm's package.json is the reference.
    reference = json.loads(PACKAGE_JSON.read_text())['version']
    for where, (value, spell) in found.items():
        if value != spell(reference):
            problems.append(f'{where}: {value}, expected {spell(reference)}')
    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        print(f'versions disagree; run scripts/set-version.py {reference} (or the intended version)',
              file=sys.stderr)
        return 1
    print(f'OK: {len(found)} places at {reference}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
