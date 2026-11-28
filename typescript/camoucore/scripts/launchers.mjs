// The launchers in this package: every subpackage of the Python package that
// carries a repos.yml (the rule CI, the release and scripts/ use too). Each
// has its TypeScript twin in src/<launcher>/; a launcher without one fails
// here rather than shipping half a launcher.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PYTHON_PACKAGE = path.resolve(
	ROOT,
	"..",
	"..",
	"python",
	"camoucore",
	"src",
	"camoucore",
);

export const LAUNCHERS = fs
	.readdirSync(PYTHON_PACKAGE, { withFileTypes: true })
	.filter(
		(entry) =>
			entry.isDirectory() &&
			fs.existsSync(path.join(PYTHON_PACKAGE, entry.name, "repos.yml")),
	)
	.map((entry) => entry.name)
	.sort();

if (LAUNCHERS.length === 0)
	throw new Error(
		`no launcher (a subpackage with repos.yml) in ${PYTHON_PACKAGE}`,
	);
for (const launcher of LAUNCHERS) {
	if (!fs.existsSync(path.join(ROOT, "src", launcher, "index.ts")))
		throw new Error(
			`python/camoucore/src/camoucore/${launcher} has no TypeScript twin at src/${launcher}/index.ts`,
		);
}
