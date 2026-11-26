#!/usr/bin/env python3
"""Set every package in this repository to one version, or check that they agree.

Every package is released together, at one version: the Python packages
(python/*), the npm packages (typescript/*) and the MCP server (mcp/). A
launcher depends on exactly the camoucore of its own release:

  - python/<launcher>/pyproject.toml pins `camoucore` to the version itself.
  - typescript/<launcher>/package.json depends on `workspace:*`, which pnpm
    rewrites to the exact version when it packs.

Usage:
    python3 scripts/set-version.py 0.6.1     # write the version everywhere
    python3 scripts/set-version.py --check   # non-zero if any file disagrees

npm spells a prerelease 0.6.1-beta.2; PyPI spells it 0.6.1b2. Give the npm
spelling and each file gets its own.
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = sorted(p.parent for p in (ROOT / 'python').glob('*/pyproject.toml'))
NPM = sorted(p.parent for p in (ROOT / 'typescript').glob('*/package.json')) + [ROOT / 'mcp']
CORE = 'camoucore'
VERSION_RE = re.compile(r'^\d+\.\d+\.\d+(-beta\.\d+)?$')


def pep440(version: str) -> str:
    return re.sub(r'-beta\.(\d+)$', r'b\1', version)


# (file, pattern, replacement for a version) for each place a version is written.
# Each pattern's group 1 is the version, and must match exactly once.
def places():
    for pkg in PYTHON:
        pyproject = pkg / 'pyproject.toml'
        yield pyproject, re.compile(r'^version = "([^"]+)"$', re.M), pep440
        if pkg.name != CORE:
            # Both entries of `camoucore = [{version = ...}, {version = ..., extras = [...]}]`.
            yield pyproject, re.compile(r'^\s*\{version = "==([^"]+)"\},$', re.M), pep440
            yield pyproject, re.compile(r'^\s*\{version = "==([^"]+)", extras', re.M), pep440
    for pkg in NPM:
        yield pkg / 'package.json', re.compile(r'^  "version": "([^"]+)",$', re.M), str
        version_ts = pkg / 'src' / '__version__.ts'
        if version_ts.exists():
            yield version_ts, re.compile(r'^export const LIBRARY_VERSION = "([^"]+)";$', re.M), str


def workspace_problems():
    """Each npm package takes its sibling packages from the workspace."""
    names = {json.loads((pkg / 'package.json').read_text())['name'] for pkg in NPM}
    problems = []
    for pkg in NPM:
        manifest = json.loads((pkg / 'package.json').read_text())
        for field in ('dependencies', 'devDependencies'):
            for name, spec in manifest.get(field, {}).items():
                if name in names and spec != 'workspace:*':
                    problems.append(f'{pkg.relative_to(ROOT)}/package.json: {field}.{name} is '
                                    f'{spec!r}, not "workspace:*"')
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument('version', nargs='?', help='the version to set, in npm spelling')
    group.add_argument('--check', action='store_true', help='verify that every file agrees')
    args = ap.parse_args()

    if args.version and not VERSION_RE.match(args.version):
        sys.exit(f'{args.version!r} is not a version like 0.6.1 or 0.6.1-beta.2')

    found = {}
    problems = workspace_problems()
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

    # --check: the first npm package.json is the reference.
    reference = json.loads((NPM[0] / 'package.json').read_text())['version']
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
