# CamouCore

The browser drivers of the Camou browsers, as one package per registry:
**camoucore** on PyPI and npm. It holds the browser-independent core, the
launchers built on it, and, on npm, an MCP server.

| Python | npm | What it is |
|---|---|---|
| `camoucore` | `camoucore` | The core: product and engine, locales, GeoIP, proxies, the fpgen model pin, virtual displays, passthrough, the defaults file, telemetry. [Its README](python/camoucore/README.md) lists the modules. |
| `camoucore.camoufox` | `camoucore/camoufox` | The launcher for Camoufox, an anti-detect Firefox. [Its reference](python/camoucore/docs/camoufox.md) lists every launch option; [the npm one](typescript/camoucore/docs/camoufox.md) covers the TypeScript API. |
| `camoucore.camouwolf` | `camoucore/camouwolf` | The launcher for Camouwolf, an anti-detect Chromium. [Its reference](python/camoucore/docs/camouwolf.md) covers every launch option. |
| | `camoucore/mcp` | An MCP server that lets an agent drive a launcher's browser, run as `npx camoufox mcp`. [Its README](typescript/camoucore/docs/mcp.md) shows how. |

The package is released at one version ([RELEASING.md](RELEASING.md)), tested
against each launcher's newest browser release and stamped with it. Users
install a launcher through its browser repository's package
(`pip install -U "camoufox[geoip]"`, `npm install camoufox playwright-core`),
a small wrapper that pins one camoucore release and the browser built with it,
so the import package and CLI are named after the launcher
([RELEASING.md](RELEASING.md), "The wrapper packages").
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
# Python: the package, editable; one pytest run per suite
python3 -m venv .venv
.venv/bin/pip install -r python/requirements-dev.txt -e 'python/camoucore[geoip]'
cd python/camoucore
for suite in core camoufox camouwolf; do
  xvfb-run -a ../../.venv/bin/python -m pytest "tests/$suite" -q
done
cd ../..

# TypeScript: one pnpm workspace, one package
pnpm install
cd typescript/camoucore
pnpm typecheck && pnpm check && pnpm build && pnpm check:pack
CAMOUWOLF_PYTHON=../../.venv/bin/python pnpm golden    # re-record camouwolf's committed goldens
# Every suite (core, camoufox, camouwolf, mcp), or one with pnpm test:<suite>.
# camoufox records its goldens from CAMOUFOX_PYTHON on every run.
CAMOUFOX_PYTHON=../../.venv/bin/python WAYLAND_DISPLAY= xvfb-run -a pnpm test

# The MCP server against a real browser: CAMOUCORE_MCP_LAUNCHER=camouwolf and
# CAMOUWOLF_EXECUTABLE_PATH run its real-browser test
pnpm test:mcp
```

No test downloads a browser: point `<LAUNCHER>_EXECUTABLE_PATH` at one.
`python3 scripts/set-version.py --check` and `scripts/check-test-inputs.sh` are
CI's static checks.
