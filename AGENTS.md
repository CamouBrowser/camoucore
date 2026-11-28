# AGENTS.md

This repository holds the browser drivers: **camoucore**, the core every
launcher shares, and the launchers built on it (**camoufox** and
**camouwolf**, published as `camoucore-<launcher>`), each in Python and
TypeScript, plus **camoucore-mcp**, an MCP server that drives a
launcher's browser. The browsers themselves are built in their own
repositories; their CI installs the drivers from here.

## Core rules

Every line of camoucore runs in every launcher, so:

- **Never name a launcher in core code.** Read it from the `Product` the caller
  passes: `product.name`, `product.env_var(...)`, `product.engine`. Messages are
  worded so they read correctly from any launcher.
- **Python and TypeScript are twins.** A change to one module lands in its
  twin in the same commit. Data files live once, in the Python package
  (`python/<package>/src/<package>/`); the npm build copies them.
  `mcp/` has no twin: it is a process, not a library, and a Python launcher's
  users run it the same way.
- **Engine differences live on `Engine`**, as data, not as branches on its name.
- **Move, don't copy.** Code goes into camoucore when more than one launcher
  carries it, and the launcher copies are deleted in the same change. A
  launcher-only test of core behaviour moves with it; a test that exercises the
  launcher's own modules stays in the launcher.
- **Shared data is shared on purpose.** The GeoIP cache and the fpgen model pin
  are one per machine, because fpgen keeps one model per environment.
- **One version for everything.** Every package is released together at one
  version (`scripts/set-version.py`); a launcher pins exactly its own release's
  camoucore (`==` in Python, `workspace:*` in npm, written exact on pack).

## The browser ships first, then the driver

A driver release is tested against, and stamped with (`browser-pin.json`), its
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
  `settled-rules.test.ts` in each package. Do not reopen one without new
  evidence.
- **Comments say why**, in a sentence or two. **Documentation ships with the
  change** that made it true.

## Tests

- **Every bug gets a regression test**: see it fail, fix the bug, see it pass.
- **No flakes.** Never retry, loosen a threshold or skip a test to get green.
- **A missing prerequisite fails; it never passes as a skip.** In CI the
  suites fail on one unless `<PRODUCT>_TEST_ALLOW_MISSING` names it.
- **No test downloads a browser.** Point `<LAUNCHER>_EXECUTABLE_PATH` at one
  you have; CI's integration job fetches the release, rate-capped and cached.
- **Never open a browser window on a desktop.** Run suites under `xvfb-run -a`
  with `WAYLAND_DISPLAY=""`.
- **A TypeScript launcher matches its Python twin**: the Python launcher's
  output over fixed inputs is the golden the TypeScript tests are held to.
  camouwolf commits its goldens (`pnpm golden` re-records `tests/golden/`,
  and CI fails on a diff); camoufox records them afresh on every vitest run
  (`tests/golden-setup.ts`, into the git-ignored `tests/fixtures/`), from
  `CAMOUFOX_PYTHON`.

## Security

- **Nothing private goes in a file, commit message or pull request**: no
  credentials, machine paths or per-vector stealth-scan detail.
- **Publishing is OIDC trusted publishing** (RELEASING.md), never a token.
- **Least privilege** in workflows: `permissions:` per job, only what it needs.

## Layout

| Path | What it is |
|---|---|
| `python/camoucore`, `typescript/camoucore` | The core, PyPI and npm `camoucore`. |
| `python/<launcher>`, `typescript/<launcher>` | A launcher's driver, PyPI and npm `camoucore-<launcher>`; the import package, CLI and cache stay `<launcher>`. |
| `mcp/` | npm `camoucore-mcp`. |
| `scripts/` | `set-version.py`, `browser-release.py`, `install-driver.sh`, `check-test-inputs.sh`, `smoke/`. |
| `.github/` | `tests.yml`, `release.yml` and the actions they share. |

## Adding a launcher

Everything is keyed by launcher name and finds the launchers from `python/`,
so a new launcher is its packages and a few data entries:

1. Bring in `python/<name>` and `typescript/<name>` with their history
   (`git merge --allow-unrelated-histories` of a subtree split), name both
   packages `camoucore-<name>` (the Python one with
   `packages = [{ include = "<name>", from = "src" }]`), then make the npm
   package depend on `camoucore: "workspace:*"` and the Python one on
   `camoucore` `==` this version, and run `scripts/set-version.py <version>`.
2. Its `repos.yml` has a `name: Official` entry naming its browser repository,
   whose releases carry `<name>-<version>-<build>-lin.x86_64.zip`.
3. In `scripts/browser-release.py`: an `EXECUTABLES` entry if the binary in that
   zip is not named `<name>`, and a `SCHEMA` entry if the driver ships a copy of
   the browser's config schema.
4. Give the npm package `check:pack` and, if it commits goldens, a `golden`
   script; CI runs them when present.
5. Read the browser repository's pin first: `browser_pin.py` and
   `browser-pin.ts` prefer `<name>_pin/browser-pin.json` from that
   repository's `<name>` package (RELEASING.md, "The browser ships first").
6. Add its PyPI and npm trusted publishers (RELEASING.md) before the next
   release, and delete the launcher's copies of anything camoucore now holds.

CI's matrices, the integration job, the release and `install-driver.sh` then
include it with no further change.
