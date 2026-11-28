# AGENTS.md

This repository holds the browser drivers as one package per registry,
**camoucore** on PyPI and npm: the core every launcher shares, the launchers
built on it (**camoufox** and **camouwolf**, `camoucore.<launcher>` in Python
and `camoucore/<launcher>` in npm), each in Python and TypeScript, plus an MCP
server that drives a launcher's browser (`camoucore/mcp`, run as
`<launcher> mcp`). The browsers themselves are built in their own
repositories; each publishes a small `<launcher>` wrapper package around its
launcher (RELEASING.md, "The wrapper packages"), and their CI installs the
drivers from here.

## Core rules

Every line of camoucore runs in every launcher, so:

- **Never name a launcher in core code.** Read it from the `Product` the caller
  passes: `product.name`, `product.env_var(...)`, `product.engine`. Messages are
  worded so they read correctly from any launcher.
- **Python and TypeScript are twins.** A change to one module lands in its
  twin in the same commit. Data files live once, in the Python package
  (`python/camoucore/src/camoucore/`, a launcher's in its subpackage); the npm
  build copies them. The MCP server (`typescript/camoucore/src/mcp/`) has no
  twin: it is a process, not a library, and a Python launcher's users run it
  the same way, with `npx <launcher> mcp`.
- **Engine differences live on `Engine`**, as data, not as branches on its name.
- **Move, don't copy.** Code goes into camoucore when more than one launcher
  carries it, and the launcher copies are deleted in the same change. A
  launcher-only test of core behaviour moves with it; a test that exercises the
  launcher's own modules stays in the launcher.
- **Shared data is shared on purpose.** The GeoIP cache and the fpgen model pin
  are one per machine, because fpgen keeps one model per environment.
- **One version for everything.** There is one package per registry, at one
  version (`scripts/set-version.py`); a browser repository's wrapper pins
  exactly one camoucore release.

## The browser ships first, then the driver

A driver release is tested against, and stamped with (`browser-pin.json`), each
launcher's newest browser release; the browser repository's own `<launcher>`
package, which pins one driver release, ships the pin that wins. So a driver change that needs a browser
change waits for that browser to be released: CI's integration job fails
until it is. A browser repository's CI installs the latest published driver by
default; a `ci/driver-ref` file naming a camoucore ref (a branch or a commit)
makes it install that ref with `scripts/install-driver.sh` instead, which is
how a browser change and its driver change are tested together before either
ships. Remove the file once the driver is released.

File a bug in the driver (launch options, identity drawing, the Python or npm
API) here; a bug in what the browser reports, renders or leaks goes to the
browser's repository.

## Launcher rules

- **Search before you write.** If something close exists in camoucore or the
  launcher, extend it. Copies drift, and an identity built from two drifting
  copies is detectable.
- **Less code; no band-aids.** A special case at the call site is a bug
  relocated, not fixed.
- **Fallbacks are a last resort.** They turn a loud failure into a silent wrong
  answer, and in an anti-detect browser a silent wrong answer is a fingerprint.
- **Check real data before inventing a value.** Every spoofed value is one a
  real device reports, taken from the recorded distributions (fpgen), not from
  memory.
- **Every config key has three ends**: a browser patch that reads it, an entry
  in the browser's `properties.json`, and a launcher that writes it. The
  launcher's copy of `properties.json` is the browser release's file
  (`scripts/browser-release.py check-schema`); change it in the browser first.
- **The browser repositories' settled decisions about driver code**
  (`ci/tribal-rules.yml` there) are tests here: `test_settled_rules.py` and
  `settled-rules.test.ts` in each launcher's tests. Do not reopen one without
  new evidence.
- **Comments say why**, in a sentence or two. **Documentation ships with the
  change** that made it true.

## Tests

- **Every bug gets a regression test**: see it fail, fix the bug, see it pass.
- **No flakes.** Never retry, loosen a threshold or skip a test to get green.
- **One suite per run.** Each package's tests are split by suite: `core`, one
  per launcher and, in npm, `mcp` (`tests/<suite>/`). Python runs one suite per
  pytest invocation (`pytest tests/camoufox`), since each suite's helpers are
  imported by bare name; npm runs them as vitest projects
  (`pnpm test:<suite>`, or `pnpm test` for all).
- **A missing prerequisite fails; it never passes as a skip.** In CI the
  suites fail on one unless `<PRODUCT>_TEST_ALLOW_MISSING` names it.
- **No test downloads a browser.** Point `<LAUNCHER>_EXECUTABLE_PATH` at one
  you have; CI's integration job fetches the release, rate-capped and cached.
- **Never open a browser window on a desktop.** Run suites under `xvfb-run -a`
  with `WAYLAND_DISPLAY=""`.
- **A TypeScript launcher matches its Python twin**: the Python launcher's
  output over fixed inputs is the golden the TypeScript tests are held to.
  camouwolf commits its goldens (`pnpm golden` re-records
  `tests/camouwolf/golden/`, and CI fails on a diff); camoufox records them
  afresh on every vitest run (`tests/camoufox/golden-setup.ts`, into the
  git-ignored `tests/camoufox/fixtures/`), from `CAMOUFOX_PYTHON`.

## Security

- **Nothing private goes in a file, commit message or pull request**: no
  credentials, machine paths or per-vector stealth-scan detail.
- **Publishing is OIDC trusted publishing** (RELEASING.md), never a token.
- **Least privilege** in workflows: `permissions:` per job, only what it needs.

## Layout

| Path | What it is |
|---|---|
| `python/camoucore` | PyPI `camoucore`. `src/camoucore/` is the core; `src/camoucore/<launcher>/` is a launcher, with its data files; `tests/core`, `tests/<launcher>`. |
| `typescript/camoucore` | npm `camoucore`. `src/` is the core, `src/<launcher>/` a launcher (`cli.ts` is the bin a wrapper runs), `src/mcp/` the MCP server; `tests/<suite>/`, `scripts/<launcher>/` (goldens, e2e), `docs/`. |
| `scripts/` | `set-version.py`, `browser-release.py`, `install-driver.sh`, `check-test-inputs.sh`, `smoke/`. |
| `.github/` | `tests.yml`, `release.yml` and the actions they share. |

The launchers' public names (`import camoufox`, the `camoufox` CLI and
packages) belong to the browser repositories' wrappers; inside camoucore a
launcher keeps its env vars, cache directory and `Product` name.

## Adding a launcher

Everything is keyed by launcher name and finds the launchers as the
subpackages of `python/camoucore/src/camoucore/` that hold a `repos.yml`, so a
new launcher is its two subpackages and a few data entries:

1. Bring in `python/camoucore/src/camoucore/<name>/` and
   `typescript/camoucore/src/<name>/` with their tests (`tests/<name>/` in
   each), importing the core as `camoucore` in Python and relatively
   (`../product.js`) in TypeScript. Give the TypeScript side a `cli.ts` bin like the others',
   and add `"./<name>"` to the package.json `exports` and a `<name>` project
   to `vitest.config.ts`.
2. Its `repos.yml` has a `name: Official` entry naming its browser repository,
   whose releases carry `<name>-<version>-<build>-lin.x86_64.zip`.
3. In `scripts/browser-release.py`: an `EXECUTABLES` entry if the binary in that
   zip is not named `<name>`, and a `SCHEMA` entry if the driver ships a copy of
   the browser's config schema.
4. If it commits goldens, give package.json a `golden:<name>` script that
   writes `tests/<name>/golden/`; CI runs it when present.
5. Read the browser repository's pin first: `browser_pin.py` and
   `browser-pin.ts` prefer `<name>_pin/browser-pin.json` from that
   repository's `<name>` wrapper (RELEASING.md, "The browser ships first").
6. List its public modules in RELEASING.md, "The wrapper packages"
   (`tests/<name>/test_wrapper_contract.py` checks the list), and delete the
   launcher's copies of anything camoucore now holds.

CI's matrices, the integration job, the release, `check:pack` and
`install-driver.sh` then include it with no further change.
