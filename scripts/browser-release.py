#!/usr/bin/env python3
"""Find a launcher's newest browser release, and stamp a release's browser pin.

The browser ships first, then the driver: CI tests every driver change against
the newest browser release of its launcher, and a driver release is stamped with
that same browser (browser-pin.json), so the packages fetch, by default, the
build they were tested with.

    scripts/browser-release.py resolve camouwolf [--github-output]
        The newest release of the launcher's Official repository (repos.yml),
        prereleases included: tag, repo, version, build, the Linux x86_64
        asset's URL and the browser binary's name in it. --github-output
        appends them to $GITHUB_OUTPUT as well.

    scripts/browser-release.py stamp camouwolf --repo CamouBrowser/camouwolf --tag v158.0.8127.36-alpha.1
        Write python/<launcher>/src/<launcher>/browser-pin.json. The npm package
        ships the same file (its build copies the Python package's data files).
        A development checkout keeps `{}`: nothing pinned.

    scripts/browser-release.py check-schema camouwolf --tag v158.0.8127.36-alpha.1
        The launcher's copy of the browser's config schema is the file that
        browser release was built from (camouwolf's tribal rule
        properties-one-schema): a key in one and not the other is sent and
        silently ignored. Compares git blob hashes, so nothing is downloaded.

The browsers a driver accepts at all are its CONSTRAINTS (__version__.py and
__version__.ts) and the ranges in its repos.yml; a stamp outside them is refused
by the driver at launch, which CI's integration jobs would catch first.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Every python/<launcher> beside camoucore; a launcher is added by adding its
# packages (AGENTS.md, "Adding a launcher").
LAUNCHERS = tuple(sorted(p.parent.name for p in (ROOT / 'python').glob('*/pyproject.toml')
                         if p.parent.name != 'camoucore'))
# The browser binary in a release, for a launcher whose binary is not named
# after it (a Firefox build ships <name>-bin, for one).
EXECUTABLES: dict = {}
# v158.0.8127.36-alpha.1
TAG_RE = re.compile(r'^v(?P<version>[^-]+)-(?P<prefix>[a-z]+)\.(?P<n>\d+)$')
REPO_NAME = 'Official'
# launcher: (its copy, under the package; the file in the browser repository)
SCHEMA = {'camouwolf': ('data/properties.json', 'browser/settings/properties.json')}


def package_dir(launcher: str) -> Path:
    return ROOT / 'python' / launcher / 'src' / launcher


def official_repo(launcher: str) -> str:
    """The first repository of the `name: Official` entry in the launcher's repos.yml."""
    text = (package_dir(launcher) / 'repos.yml').read_text()
    for block in re.split(r'(?m)^\s*- repo:', text)[1:]:
        if re.search(rf'(?m)^\s*name:\s*{REPO_NAME}\s*$', block):
            return block.splitlines()[0].split(',')[0].strip()
    sys.exit(f'{launcher}/repos.yml has no "{REPO_NAME}" browser repository')


def github(path: str):
    request = urllib.request.Request(f'https://api.github.com/{path}',
                                     headers={'Accept': 'application/vnd.github+json'})
    token = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    if token:
        request.add_header('Authorization', f'Bearer {token}')
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def resolve(launcher: str) -> dict:
    repo = official_repo(launcher)
    for release in github(f'repos/{repo}/releases?per_page=30'):
        match = TAG_RE.match(release['tag_name'])
        if release.get('draft') or not match:
            continue
        version, build = match['version'], f"{match['prefix']}.{match['n']}"
        asset = f'{launcher}-{version}-{build}-lin.x86_64.zip'
        urls = {a['name']: a['browser_download_url'] for a in release.get('assets', [])}
        if asset not in urls:
            continue
        return {'tag': release['tag_name'], 'repo': repo, 'version': version, 'build': build,
                'prerelease': str(bool(release.get('prerelease'))).lower(),
                'asset': asset, 'url': urls[asset], 'executable': EXECUTABLES.get(launcher, launcher), 'sha256_url': urls.get(f'{asset}.sha256', '')}
    sys.exit(f'{repo} has no release with a Linux x86_64 {launcher} build')


def stamp(launcher: str, repo: str, tag: str) -> Path:
    match = TAG_RE.match(tag)
    if not match:
        sys.exit(f'{tag!r} is not a browser release tag like v158.0.8127.36-alpha.1')
    pin = {'tag': tag, 'repo': repo, 'repo_name': REPO_NAME, 'version': match['version'],
           'build': f"{match['prefix']}.{match['n']}"}
    path = package_dir(launcher) / 'browser-pin.json'
    path.write_text(json.dumps(pin, indent=2) + '\n')
    return path


def git_blob_sha(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


def check_schema(launcher: str, tag: str) -> int:
    if launcher not in SCHEMA:
        print(f'{launcher} ships no copy of its browser\'s config schema: nothing to compare')
        return 0
    ours, theirs = SCHEMA[launcher]
    repo = official_repo(launcher)
    remote = github(f'repos/{repo}/contents/{theirs}?ref={tag}')['sha']
    local = git_blob_sha(package_dir(launcher) / ours)
    if remote != local:
        print(f'::error::python/{launcher}/src/{launcher}/{ours} differs from {theirs} in {repo} at {tag}. '
              'The browser ships first: change the schema there, release it, then copy it here.')
        return 1
    print(f'OK: {ours} is {repo}@{tag}:{theirs}')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('resolve')
    r.add_argument('launcher', choices=LAUNCHERS)
    r.add_argument('--github-output', action='store_true')
    s = sub.add_parser('stamp')
    s.add_argument('launcher', choices=LAUNCHERS)
    s.add_argument('--repo', required=True, help='owner/name of the browser release')
    s.add_argument('--tag', required=True)
    c = sub.add_parser('check-schema')
    c.add_argument('launcher', choices=LAUNCHERS)
    c.add_argument('--tag', required=True)
    args = ap.parse_args()

    if args.cmd == 'check-schema':
        return check_schema(args.launcher, args.tag)

    if args.cmd == 'resolve':
        found = resolve(args.launcher)
        lines = [f'{k}={v}' for k, v in found.items()]
        print('\n'.join(lines))
        if args.github_output:
            with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
                out.write('\n'.join(lines) + '\n')
    else:
        if args.repo != official_repo(args.launcher):
            sys.exit(f'{args.repo} is not the {REPO_NAME} repository of {args.launcher}')
        print(stamp(args.launcher, args.repo, args.tag).read_text(), end='')
    return 0


if __name__ == '__main__':
    sys.exit(main())
