# Releasing

One package is released on each registry, PyPI `camoucore` and npm
`camoucore`. It holds the core, every launcher (`camoucore.camoufox`,
`camoucore.camouwolf`; npm `camoucore/camoufox`, `camoucore/camouwolf`) and,
on npm, the MCP server (`camoucore/mcp`).

The launchers' public names, `camoufox` and `camouwolf` (the import packages,
the CLIs, the PyPI and npm packages), belong to the browser repositories
(daijro/camoufox, CamouBrowser/camouwolf). Each publishes a small wrapper
package that depends on exactly one `camoucore` release and ships the
browser pin; "The wrapper packages" below says what it contains.

## The browser ships first

A release is tested against each launcher's newest browser release, and each
launcher's own `browser-pin.json` inside camoucore is stamped with it. The pin
that wins, though, is the browser repository's: its wrapper ships
`<launcher>_pin/browser-pin.json` (Python: the `<launcher>_pin` package; npm:
`<launcher>/<launcher>_pin/browser-pin.json`, exported at that subpath), and
the launcher reads it whenever the wrapper is installed. The stamped pin is the
fallback for camoucore installed on its own: the browser camoucore's CI tested
it with. So release a browser change first, then the camoucore that needs it,
then the wrapper that pairs them. A browser repository whose CI must test an
unreleased camoucore points its `ci/driver-ref` at a camoucore ref until it
ships.

## Steps

1. On `main`, with CI green:

   ```bash
   python3 scripts/set-version.py 0.6.0      # or 0.6.1-beta.1 (PyPI gets 0.6.1b1)
   pnpm install                              # refreshes the lockfile, if it changes
   git commit -am "Release 0.6.0"
   git tag v0.6.0
   git push origin main v0.6.0
   ```

2. The tag runs `.github/workflows/release.yml`:
   - the whole of `tests.yml`, including each launcher against its newest
     browser release;
   - checks that the tag is the version the package carries;
   - stamps each launcher's fallback `browser-pin.json` with the browser it
     was tested on (into the built package only; the repository keeps `{}`);
   - builds the Python sdist and wheel and the npm tarball and attests their
     build provenance;
   - publishes to PyPI (environment `pypi`), then to npm (environment `npm`,
     with `--provenance`; a prerelease goes to the `next` dist-tag).

   A version already on a registry is skipped, so a failed release is fixed by
   re-running the workflow, not by a new tag.

## Trusted publishers

Publishing uses OIDC trusted publishing; there are no tokens. The package
needs a trusted publisher for this repository, workflow `release.yml`:

| Registry | Package | Environment |
|---|---|---|
| PyPI | `camoucore` | `pypi` |
| npm | `camoucore` | `npm` |

The repository's `pypi` and `npm` environments should allow only `v*` tags.

## The wrapper packages

A browser repository's `<launcher>` package (PyPI and npm) is the launcher
under its own name. It carries no launcher code: everything resolves to the
one copy in camoucore, so `import camoufox.sync_api` and
`camoucore.camoufox.sync_api` are the same module object.
`tests/<launcher>/test_wrapper_contract.py` builds this wrapper from this
section and checks it.

### PyPI

- Depends on `camoucore` `==` exactly one release, with an extra
  `geoip = ["camoucore[geoip]"]` (`pip install -U "camoufox[geoip]"`).
- `<launcher>/__init__.py` re-exports the launcher:

  ```python
  import camoucore.camoufox as _impl
  from camoucore.camoufox import *  # noqa: F403
  from camoucore.camoufox import __all__  # noqa: F401


  def __getattr__(name):
      return getattr(_impl, name)
  ```

- One stub module per public submodule, `<launcher>/<module>.py`, which
  replaces itself with camoucore's:

  ```python
  import importlib
  import sys

  sys.modules[__name__] = importlib.import_module("camoucore.camoufox.utils")
  ```

  The submodules to alias (every module whose name has no leading
  underscore, plus `__version__`; the test fails when this list falls behind
  the code, and a new public module needs a stub in the wrapper's next
  release):

  ```text
  camoufox: __version__ addons async_api browser_pin coherence defaults display_profile driver_defaults exceptions fingerprints gpudisplay host_rendering humanize ip multiversion pkgman product server sync_api telemetry utils webgl
  camouwolf: __version__ addons async_api browser_pin clienthints coherence driver_defaults exceptions fingerprints gpudisplay host_rendering humanize multiversion pkgman product server switches sync_api utils webgl
  ```

  Do not alias the package itself (`sys.modules["camoufox"] = ...`): Python
  would then load each `camoufox.<module>` a second time from camoucore's
  files, as a separate module with its own state.
- `<launcher>/__main__.py`, for `python -m camoufox`:

  ```python
  from camoucore.camoufox.__main__ import cli

  if __name__ == "__main__":
      cli()
  ```

- The console script `camoufox = "camoucore.camoufox.__main__:cli"`.
- The pin: a `<launcher>_pin` package (an empty `__init__.py`) holding
  `browser-pin.json`.

### npm

- Depends on `camoucore` at exactly one version; `playwright-core` stays a
  peer dependency (`npm install camoufox playwright-core`).
- `index.js` (and its `.d.ts`): `export * from "camoucore/camoufox";`
- The bin `camoufox`, a file holding `import "camoucore/camoufox/cli.js";`.
  It runs the CLI, and `camoufox mcp ...` serves the browser over MCP
  (`npx camoufox mcp`); see `typescript/camoucore/docs/mcp.md`.
- `camoufox_pin/browser-pin.json`, exported at
  `"./camoufox_pin/browser-pin.json"`.

## Adding a launcher

AGENTS.md, "Adding a launcher", lists the code side. Releasing needs nothing
new: the launcher ships inside `camoucore`. Its browser repository publishes
the wrapper above.
