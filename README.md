# CamouCore

The browser drivers of the Camou browsers: **camoucore**, the
browser-independent core, and the launchers built on it, in Python (PyPI) and
TypeScript (npm), plus an MCP server.

| Path | Package | What it is |
|---|---|---|
| [`python/camoucore`](python/camoucore), [`typescript/camoucore`](typescript/camoucore) | `camoucore` | The core: product and engine, locales, GeoIP, proxies, the fpgen model pin, virtual displays, passthrough, the defaults file, captcha, telemetry. [Its README](python/camoucore/README.md) lists the modules. |
| [`python/camoufox`](python/camoufox), [`typescript/camoufox`](typescript/camoufox) | `camoucore-camoufox` | The launcher for Camoufox, an anti-detect Firefox. [Its README](python/camoufox/README.md) lists every launch option. |
| [`python/camouwolf`](python/camouwolf), [`typescript/camouwolf`](typescript/camouwolf) | `camoucore-camouwolf` | The launcher for Camouwolf, an anti-detect Chromium. [Its README](python/camouwolf/README.md) is the reference for every launch option. |
| [`mcp`](mcp) | `camoucore-mcp` | An MCP server that lets an agent drive a launcher's browser. [Its README](mcp/README.md) shows how to run it. |

Every package is released together at one version ([RELEASING.md](RELEASING.md)),
tested against its launcher's newest browser release and stamped with it.
Users install a launcher through its browser repository's package (`camoufox`,
`camouwolf`), which pins one driver release and the browser built with it; the
import package and CLI are named after the launcher either way.
[AGENTS.md](AGENTS.md) has the rules for changing anything here.

## Issues

A bug in a launch option, the identity a launcher draws, or the Python or npm
API belongs here. A bug in what the browser itself reports, renders or leaks
belongs in that browser's repository
([camoufox](https://github.com/daijro/camoufox),
[camouwolf](https://github.com/CamouBrowser/camouwolf)).

## Development

Python 3.11 or newer, Node 22.15 or newer, pnpm 10 (`corepack enable`).

```bash
# Python: every package, editable, in one venv
python3 -m venv .venv
.venv/bin/pip install -r python/requirements-dev.txt \
  -e 'python/camoucore[geoip,captcha]' -e 'python/camouwolf[geoip,captcha]' \
  -e 'python/camoufox[geoip]'
(cd python/camouwolf && xvfb-run -a ../../.venv/bin/python -m pytest tests -q)
(cd python/camoufox && xvfb-run -a ../../.venv/bin/python -m pytest tests -q)

# TypeScript: one pnpm workspace
pnpm install
cd typescript/camouwolf
pnpm typecheck && pnpm check && pnpm build && pnpm check:pack
CAMOUWOLF_PYTHON=../../.venv/bin/python pnpm golden    # re-record the committed goldens
WAYLAND_DISPLAY= xvfb-run -a pnpm test
# camoufox: the same checks; it has no `pnpm golden`, since vitest records its
# goldens from CAMOUFOX_PYTHON on every run
cd ../camoufox
pnpm typecheck && pnpm check && pnpm build && pnpm check:pack
CAMOUFOX_PYTHON=../../.venv/bin/python WAYLAND_DISPLAY= xvfb-run -a pnpm test

# MCP server; CAMOUCORE_MCP_LAUNCHER=camoucore-camouwolf and CAMOUWOLF_EXECUTABLE_PATH
# run its real-browser test
cd mcp && pnpm typecheck && pnpm check && pnpm test
```

No test downloads a browser: point `<LAUNCHER>_EXECUTABLE_PATH` at one.
`python3 scripts/set-version.py --check` and `scripts/check-test-inputs.sh` are
CI's static checks.
