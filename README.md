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
| `ip` | Proxy parsing, public IP lookup, and where a proxy exits (`ExitGeo`). |
| `fpgen_model`, `fpgen-model.json` | Installs the pinned fpgen model before fpgen loads. Every launcher pins the same model. |
| `display`, `virtdisplay` | Monitor probing and the Xvfb display for `headless="virtual"`. |
| `passthrough` | The options a passthrough launch (the host's own fingerprint, nothing injected) refuses, and its warning. |
| `settings` | The launcher's documented defaults file (`<name>.defaults.json`) and the user's overrides of it. |
| `cpu_affinity`, `download`, `host` | CPU pinning, verified downloads, host OS and architecture. |
| `captcha` | The `captcha` launch option: an account key, a CaptchaKraken key, or a CaptchaKraken server you host, resolved to a solver for the optional `captchakraken` client (the `captcha` extra; an optional peer dependency in npm). With no key it raises `CaptchaKeyMissing`, which lists a free account first and hosting the solver yourself second. |
| `pro` | Pro's launch options before Pro opens: a value that asks for a Pro feature raises `ProNotLaunched`, naming the page where an account is made and the waitlist joined. |
| `telemetry`, `antibot-rules.json` | Opt-out proxy telemetry: success, challenge and block counts per anti-bot provider, reported with the proxy provider's domain. Only the providers' own responses are matched; no URL, site, page content or proxy credential is kept or sent. |

A launcher declares itself once:

```python
from pathlib import Path
from camoucore import CHROMIUM, Product

PRODUCT = Product(
    'camouwolf', 'Camouwolf', CHROMIUM, package=Path(__file__).parent,
    site='https://example.com', captcha_endpoint='https://captcha.example.com/v1',
)
```

`site` is where accounts are made; the Pro and captcha errors link to its
`/early-access/` page. `captcha_endpoint` is the solve endpoint that takes an
account's key.

The TypeScript package (`typescript/`, npm `camoucore`) is the twin of the
Python one, for launchers written in Node:

```ts
import { CHROMIUM, Product } from "camoucore";

export const PRODUCT = new Product(
	"camouwolf",
	"Camouwolf",
	CHROMIUM,
	"https://example.com",
	"https://captcha.example.com/v1",
);
```

## Captcha

`resolve_captcha(product, option)` (`resolveCaptcha` in TypeScript) reads the
launcher's `captcha` option:

| Value | Solves at | Key |
|---|---|---|
| `"cfp_live_..."` | the product's `captcha_endpoint` (`<NAME>_CAPTCHA_ENDPOINT` moves it) | the account's key, the same one every service takes |
| `"ck_live_..."` | `https://api.captchakraken.com/v1` | the CaptchaKraken key |
| `"http://host:port/v1"` | that server | none, or `{"endpoint": ..., "key": ...}` |
| `True` | the first of `<NAME>_PRO_KEY`, `CAPTCHA_KRAKEN_API_KEY`, `<NAME>_CAPTCHA_URL` | as above |

It returns a `Captcha`, whose `page_solver(product)` (`solver(product)`) is a
captchakraken solver for this endpoint and key alone: two in one process do
not share either. Hosted solves are counted under the launcher's name
(`CAPTCHA_KRAKEN_CLIENT`) unless the caller set its own.

Its data files are the Python package's; `pnpm build` copies them into
`dist/data-files/`, so each exists once in the repository.

## Development

```bash
cd python
pip install -e '.[geoip]' pytest
pytest tests -q

cd ../typescript     # Node 22.15 or newer
pnpm install
pnpm exec tsc --noEmit && pnpm test && pnpm check
```
