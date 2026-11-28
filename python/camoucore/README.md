# CamouCore

The [Camoufox](https://github.com/daijro/camoufox) (Firefox) and
[Camouwolf](https://github.com/CamouBrowser/camouwolf) (Chromium) launchers,
`camoucore.camoufox` and `camoucore.camouwolf`, and the browser-independent
core they share. A launcher keeps only what its engine needs and takes
everything else from the core, so the two launchers cannot drift apart.

Install a launcher through its browser's package, which wraps it under its own
name and pins the browser built with it: `pip install -U "camoufox[geoip]"`,
`pip install -U "camouwolf[geoip]"`. The launchers' references are
[docs/camoufox.md](https://github.com/CamouBrowser/camoucore/blob/main/python/camoucore/docs/camoufox.md)
and [docs/camouwolf.md](https://github.com/CamouBrowser/camoucore/blob/main/python/camoucore/docs/camouwolf.md).

The core's modules:

| Module | What it does |
|---|---|
| `product` | `Product` and `Engine`: the launcher's name, cache directory, environment prefix and engine defaults. Every engine-specific choice in the core reads them. |
| `locales`, `territoryInfo.xml` | Locale parsing and region-weighted language choice. |
| `geolocation`, `geoip.yml` | GeoIP lookup of a proxy's exit. The database cache is shared by every launcher. |
| `ip` | Proxy parsing and public IP lookup. |
| `fpgen_model`, `fpgen-model.json` | Installs the pinned fpgen model before fpgen loads. Every launcher pins the same model. |
| `display`, `virtdisplay` | Monitor probing and the Xvfb display for `headless="virtual"`. |
| `cpu_affinity`, `download`, `host` | CPU pinning, verified downloads, host OS and architecture. |

A launcher declares itself once, in its subpackage's `product.py`:

```python
from pathlib import Path
from camoucore import CHROMIUM, Product

PRODUCT = Product('camouwolf', 'Camouwolf', CHROMIUM, package=Path(__file__).parent)
```

The TypeScript package (`typescript/camoucore`, npm `camoucore`) is the twin
of the Python one, with the same launchers at `camoucore/camoufox` and
`camoucore/camouwolf`, and an MCP server at `camoucore/mcp`. Its data files
are this package's; `pnpm build` copies them into `dist/`, so each exists once
in the repository.

## Development

This package is developed in the
[camoucore repository](https://github.com/CamouBrowser/camoucore), beside its
TypeScript twin; its README has the commands. Each suite runs on its own:
`pytest tests/core`, `pytest tests/camoufox`, `pytest tests/camouwolf`.
