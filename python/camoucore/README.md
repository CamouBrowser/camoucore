# CamouCore

The browser-independent core shared by the [Camoufox](https://github.com/daijro/camoufox)
(Firefox) and Camouwolf (Chromium) launchers. A launcher keeps only what its
engine needs and takes everything else from here, so the two launchers cannot
drift apart.

| Module | What it does |
|---|---|
| `product` | `Product` and `Engine`: the launcher's name, cache directory, environment prefix and engine defaults. Every engine-specific choice in the core reads them. |
| `locales`, `territoryInfo.xml` | Locale parsing and region-weighted language choice. |
| `geolocation`, `geoip.yml` | GeoIP lookup of a proxy's exit. The database cache is shared by every launcher. |
| `ip` | Proxy parsing and public IP lookup. |
| `fpgen_model`, `fpgen-model.json` | Installs the pinned fpgen model before fpgen loads. Every launcher pins the same model. |
| `display`, `virtdisplay` | Monitor probing and the Xvfb display for `headless="virtual"`. |
| `cpu_affinity`, `download`, `host` | CPU pinning, verified downloads, host OS and architecture. |

A launcher declares itself once:

```python
from pathlib import Path
from camoucore import CHROMIUM, Product

PRODUCT = Product('camouwolf', 'Camouwolf', CHROMIUM, package=Path(__file__).parent)
```

The TypeScript package (`typescript/`, npm `camoucore`) is the twin of the
Python one, for launchers written in Node:

```ts
import { CHROMIUM, Product } from "camoucore";

export const PRODUCT = new Product("camouwolf", "Camouwolf", CHROMIUM);
```

Its data files are the Python package's; `pnpm build` copies them into
`dist/data-files/`, so each exists once in the repository.

## Development

This package is developed in the
[camoucore repository](https://github.com/CamouBrowser/camoucore), beside its
TypeScript twin and the launchers built on it; its README has the commands.
