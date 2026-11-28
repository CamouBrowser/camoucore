/**
 * The data files camoucore ships. They live in python/camoucore/src/camoucore/, the one
 * copy in the repository; `pnpm build` copies them into dist/data-files/.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

export const DATA_FILES: readonly string[] = [
	"antibot-rules.json",
	"fpgen-model.json",
	"geoip.yml",
	"territoryInfo.xml",
	"warnings.yml",
];

/** dist/data-files/ in a built package, else python/camoucore/src/camoucore/ itself. */
export const LOCAL_DATA: string = fs.existsSync(
	path.join(import.meta.dirname, "data-files"),
)
	? path.join(import.meta.dirname, "data-files")
	: path.resolve(
			import.meta.dirname,
			"..",
			"..",
			"..",
			"python",
			"camoucore",
			"src",
			"camoucore",
		);

/** A data file, parsed as YAML or JSON by its extension. */
export function loadDataFile<T = any>(file: string): T {
	const text = fs.readFileSync(path.join(LOCAL_DATA, file), "utf-8");
	return (file.endsWith(".yml") ? parseYaml(text) : JSON.parse(text)) as T;
}
