/**
 * Camouwolf loads the fpgen model its `fpgen-js` pins, and the Python launcher
 * the one camoucore pins in fpgen-model.json. Bump them together.
 */

import { MODEL_PIN } from "fpgen-js";
import { expect, it } from "vitest";
import { loadDataFile } from "../../src/data.js";

it("matches camoucore's fpgen-model.json", () => {
	const { note: _note, ...fields } = loadDataFile("fpgen-model.json");
	expect({ ...MODEL_PIN, files: [...MODEL_PIN.files] }).toEqual(fields);
});
