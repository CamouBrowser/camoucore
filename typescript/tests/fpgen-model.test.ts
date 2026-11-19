/**
 * Both cores must load the same fpgen model: the Python one installs the
 * release in python/src/camoucore/fpgen-model.json, this one the release the
 * `fpgen-js` package pins. Bump them together.
 */
import { MODEL_PIN } from "fpgen-js";
import { expect, it } from "vitest";
import { loadDataFile } from "../src/data.js";

it("matches python/src/camoucore/fpgen-model.json", () => {
	const { note: _note, ...fields } = loadDataFile("fpgen-model.json");
	expect({ ...MODEL_PIN, files: [...MODEL_PIN.files] }).toEqual(fields);
});
