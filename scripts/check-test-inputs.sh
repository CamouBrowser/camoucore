#!/usr/bin/env bash
# Every test input must be something a checkout gets. A git-ignored file under
# a package's src/, tests/ or scripts/ exists on the machine that made it and
# nowhere else, so the suite passes there and fails in CI. A .gitignore inside
# <package>/tests/fixtures/ may ignore what the suite generates there on
# purpose; anything another rule hides is stray.
#
# Run it after the test suites, so the generated fixtures exist:
#   scripts/check-test-inputs.sh [package-dir ...]   (default: typescript/* and mcp)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[ $# -gt 0 ] || set -- typescript/* mcp
stray=0
for pkg in "$@"; do
	while IFS= read -r path; do
		[ -n "$path" ] || continue
		case "$path" in */__pycache__/*|*/__pycache__/) continue ;; esac
		rule=$(git check-ignore --verbose --no-index "$path" | cut -f1)
		case "$rule" in "$pkg/tests/fixtures/.gitignore:"*) continue ;; esac
		echo "git-ignored test input: $path ($rule)" >&2
		stray=1
	done < <(git ls-files --others --ignored --exclude-standard --directory -- "$pkg/src" "$pkg/tests" "$pkg/scripts")
done
[ "$stray" = 0 ] && echo "OK: no git-ignored test input"
exit "$stray"
