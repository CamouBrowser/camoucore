# Releasing

Every package is released together, at one version:

| Registry | Packages |
|---|---|
| PyPI | `camoucore`, `camouwolf` |
| npm | `camoucore`, `camouwolf`, `camoucore-mcp` |

A launcher pins exactly its own release's camoucore, so they cannot be
released apart.

## The browser ships first

A release is tested against each launcher's newest browser release and
stamped with it (`browser-pin.json`): by default the published driver fetches
exactly the browser build it was tested with. So release a browser change
first, then the driver that needs it. A browser repository whose CI must test
an unreleased driver points its `ci/driver-ref` at a camoucore ref until the
driver ships.

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
   - checks that the tag is the version every package carries;
   - stamps each launcher's `browser-pin.json` with the browser it was tested
     on (into the built packages only; the repository keeps `{}`);
   - builds the Python sdists and wheels and the npm tarballs (`pnpm pack`
     writes `workspace:*` as the exact version) and attests their build
     provenance;
   - publishes to PyPI (environment `pypi`), then to npm (environment `npm`,
     with `--provenance`; a prerelease goes to the `next` dist-tag).

   A version already on a registry is skipped, so a failed release is fixed by
   re-running the workflow, not by a new tag.

## Trusted publishers

Publishing uses OIDC trusted publishing; there are no tokens. Each package
needs a trusted publisher for this repository, workflow `release.yml`:

| Registry | Package | Environment |
|---|---|---|
| PyPI | `camoucore` | `pypi` |
| PyPI | `camouwolf` | `pypi` |
| npm | `camoucore` | `npm` |
| npm | `camouwolf` | `npm` |
| npm | `camoucore-mcp` | `npm` |

The repository's `pypi` and `npm` environments should allow only `v*` tags.

## Adding a launcher

AGENTS.md, "Adding a launcher", lists the code side. For releasing, add its
PyPI and npm trusted publishers to the table above before the first release
that includes it; the workflow finds its packages by itself.
