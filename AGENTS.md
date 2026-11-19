# AGENTS.md

CamouCore is the shared core of the Camoufox and Camouwolf launchers. Every
line here runs in both, so:

- **Never name a launcher in core code.** Read it from the `Product` the caller
  passes: `product.name`, `product.env_var(...)`, `product.engine`. Messages are
  worded so they read correctly from either launcher.
- **Python and TypeScript are twins.** A change to one module lands in its
  twin in the same commit. Data files live once, in `python/src/camoucore/`.
- **Engine differences live on `Engine`**, as data, not as branches on its name.
- **Move, don't copy.** Code comes here when both launchers carry it, and the
  launcher copies are deleted in the same change. A launcher-only test of core
  behaviour moves here too; a test that exercises the launcher's own modules
  stays in the launcher.
- **Shared data is shared on purpose.** The GeoIP cache and the fpgen model pin
  are one per machine, because fpgen keeps one model per environment.
- **Every bug gets a regression test; no flakes; a missing prerequisite fails.**
- **Nothing private goes in a file, commit message or pull request.**
