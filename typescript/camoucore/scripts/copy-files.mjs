// Copy the data files from the Python package, which holds the one copy of
// each, into dist/: the core's DATA_FILES (src/data.ts) from
// python/camoucore/src/camoucore/ into dist/data-files/, and each launcher's
// (src/<launcher>/paths.ts) from python/camoucore/src/camoucore/<launcher>/
// into dist/<launcher>/data-files/. Runs after tsc, so the lists come from the
// compiled modules.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { LAUNCHERS, PYTHON_PACKAGE } from "./launchers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function copy(module, from, to) {
	const { DATA_FILES } = await import(path.join(ROOT, "dist", module));
	fs.rmSync(to, { recursive: true, force: true });
	for (const name of DATA_FILES) {
		fs.mkdirSync(path.dirname(path.join(to, name)), { recursive: true });
		fs.copyFileSync(path.join(from, name), path.join(to, name));
	}
	console.log(
		`copied ${DATA_FILES.length} data files from ${path.relative(ROOT, from)} -> ${path.relative(ROOT, to)}`,
	);
}

await copy("data.js", PYTHON_PACKAGE, path.join(ROOT, "dist", "data-files"));
for (const launcher of LAUNCHERS) {
	await copy(
		path.join(launcher, "paths.js"),
		path.join(PYTHON_PACKAGE, launcher),
		path.join(ROOT, "dist", launcher, "data-files"),
	);
}
