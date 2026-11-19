// Copy DATA_FILES (src/data.ts) from python/src/camoucore/ into dist/data-files/.
// Runs after tsc, so the list comes from the compiled data.js. The Python
// package holds the one copy of each file.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON_DATA = path.resolve(ROOT, "..", "python", "src", "camoucore");
const DATA = path.join(ROOT, "dist", "data-files");

fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
const { DATA_FILES } = await import(path.join(ROOT, "dist", "data.js"));
for (const name of DATA_FILES) {
	fs.copyFileSync(path.join(PYTHON_DATA, name), path.join(DATA, name));
}
console.log(`copied ${DATA_FILES.length} data files from python/src/camoucore`);
