#!/usr/bin/env bash
# Install camoucore from this checkout, the way the published package installs,
# and check that one launcher in it imports: what a browser repository's CI
# runs when its ci/driver-ref names a camoucore ref instead of the latest
# release.
#
#   scripts/install-driver.sh <launcher> <python-venv-dir> <npm-target-dir> [python-extras]
#
#   launcher         a launcher in camoucore (camoufox, camouwolf): the one
#                    whose import, camoucore.<launcher> and camoucore/<launcher>,
#                    is checked
#   python-venv-dir  a virtualenv; created when it does not exist. camoucore is
#                    pip-installed into it (not editable).
#   npm-target-dir   typescript/camoucore is built, packed, and the tarball
#                    npm-installed here (a package.json is created when there
#                    is none). "-" or "" skips the npm half; so does a machine
#                    without node, with a warning, since a Python-only job has
#                    nothing to run it with.
#   python-extras    optional, e.g. "geoip".
#
# Needs python3 and, for the npm half, node >= 22.15 with pnpm or corepack.
set -euo pipefail

usage() { echo "usage: $0 <launcher> <python-venv-dir> <npm-target-dir> [python-extras]" >&2; exit 2; }
[ $# -ge 3 ] && [ $# -le 4 ] || usage
launcher=$1 venv=$2 npm_dir=$3 extras=${4:-}
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[ -n "$launcher" ] && [ -f "$repo/python/camoucore/src/camoucore/$launcher/repos.yml" ] &&
	[ -f "$repo/typescript/camoucore/src/$launcher/index.ts" ] || usage
[ -n "$venv" ] || usage
suffix=${extras:+[$extras]}

# ---- Python
if [ ! -x "$venv/bin/python" ]; then
	python3 -m venv "$venv"
fi
# --force-reinstall: a venv that already holds this version (from PyPI, say)
# would otherwise keep it.
"$venv/bin/python" -m pip install --quiet --upgrade pip
"$venv/bin/python" -m pip install --quiet --force-reinstall "$repo/python/camoucore$suffix"
"$venv/bin/python" -c "
from importlib.metadata import version
import camoucore.$launcher
print('python: camoucore', version('camoucore'), 'installed, with camoucore.$launcher')
"

# ---- npm
if [ -z "$npm_dir" ] || [ "$npm_dir" = "-" ]; then
	echo "npm: skipped (no target directory)"
	exit 0
fi
if ! command -v node >/dev/null; then
	echo "::warning::install-driver: node is not on PATH, so the npm packages were not installed into $npm_dir"
	exit 0
fi
# The workspace's pnpm: another major rewrites the lockfile or refuses it.
PNPM_VERSION=10.33.4
if [ "$(pnpm --version 2>/dev/null)" = "$PNPM_VERSION" ]; then
	pnpm=(pnpm)
else
	pnpm=(corepack "pnpm@$PNPM_VERSION")
fi
mkdir -p "$npm_dir"
npm_dir=$(cd "$npm_dir" && pwd)
pack=$(mktemp -d)
trap 'rm -rf "$pack"' EXIT

(
	cd "$repo"
	# The workspace's own install; its lifecycle script builds the package.
	"${pnpm[@]}" install --frozen-lockfile --reporter=silent
	cd typescript/camoucore
	"${pnpm[@]}" run --silent build >/dev/null
	"${pnpm[@]}" pack --pack-destination "$pack" >/dev/null
)

[ -f "$npm_dir/package.json" ] || echo '{"name":"driver-under-test","private":true,"type":"module"}' >"$npm_dir/package.json"
(cd "$npm_dir" && npm install --no-audit --no-fund --silent "$pack"/*.tgz)
(cd "$npm_dir" && node --input-type=module -e "
	const m = await import('camoucore/$launcher');
	if (typeof m.launchOptions !== 'function') throw new Error('camoucore/$launcher has no launchOptions');
	const { createRequire } = await import('node:module');
	const v = createRequire(import.meta.url)('camoucore/package.json').version;
	console.log('npm: camoucore', v, 'installed in $npm_dir, with camoucore/$launcher');
")
