#!/usr/bin/env bash
# Install one launcher's driver from this checkout, the way its published
# packages install: what a browser repository's CI runs when its ci/driver-ref
# names a camoucore ref instead of the latest release.
#
#   scripts/install-driver.sh <launcher> <python-venv-dir> <npm-target-dir> [python-extras]
#
#   launcher         a launcher in this repository: python/<launcher> and
#                    typescript/<launcher> (camouwolf)
#   python-venv-dir  a virtualenv; created when it does not exist. camoucore and
#                    the launcher are pip-installed into it (not editable).
#   npm-target-dir   typescript/camoucore and typescript/<launcher> are built,
#                    packed, and the tarballs npm-installed here (a package.json
#                    is created when there is none). "-" or "" skips the npm
#                    half; so does a machine without node, with a warning,
#                    since a Python-only job has nothing to run it with.
#   python-extras    optional, e.g. "geoip,captcha": extras for both packages.
#
# Needs python3 and, for the npm half, node >= 22.15 with pnpm or corepack.
set -euo pipefail

usage() { echo "usage: $0 <launcher> <python-venv-dir> <npm-target-dir> [python-extras]" >&2; exit 2; }
[ $# -ge 3 ] && [ $# -le 4 ] || usage
launcher=$1 venv=$2 npm_dir=$3 extras=${4:-}
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[ "$launcher" != camoucore ] && [ -f "$repo/python/$launcher/pyproject.toml" ] &&
	[ -f "$repo/typescript/$launcher/package.json" ] || usage
[ -n "$venv" ] || usage
suffix=${extras:+[$extras]}

# ---- Python
if [ ! -x "$venv/bin/python" ]; then
	python3 -m venv "$venv"
fi
# Both in one pip call, so the launcher's exact camoucore pin resolves to this
# checkout's camoucore rather than to PyPI.
"$venv/bin/python" -m pip install --quiet --upgrade pip
"$venv/bin/python" -m pip install --quiet \
	"$repo/python/camoucore$suffix" "$repo/python/$launcher$suffix"
"$venv/bin/python" -c "import camoucore, $launcher; print('python:', '$launcher', 'and camoucore installed')"

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
	# The workspace's own install; lifecycle scripts build every package.
	CAPTCHA_KRAKEN_SKIP_PYTHON_SETUP=1 "${pnpm[@]}" install --frozen-lockfile --reporter=silent
	for pkg in camoucore "$launcher"; do
		(cd "typescript/$pkg" && "${pnpm[@]}" run --silent build >/dev/null &&
			"${pnpm[@]}" pack --pack-destination "$pack" >/dev/null)
	done
)

[ -f "$npm_dir/package.json" ] || echo '{"name":"driver-under-test","private":true,"type":"module"}' >"$npm_dir/package.json"
# pnpm pack wrote the launcher's `workspace:*` as the exact camoucore version,
# and the camoucore tarball installed beside it satisfies that.
(cd "$npm_dir" && npm install --no-audit --no-fund --silent "$pack"/*.tgz)
(cd "$npm_dir" && node --input-type=module -e "
	const m = await import('$launcher');
	if (typeof m.launchOptions !== 'function') throw new Error('$launcher has no launchOptions');
	const { createRequire } = await import('node:module');
	const v = createRequire(import.meta.url)('$launcher/package.json').version;
	console.log('npm: $launcher', v, 'installed in $npm_dir');
")
