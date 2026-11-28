/**
 * Twin of python/camoucore/tests/test_settled_rules.py: the driver halves of
 * the browser repositories' ci/tribal-rules.yml about the virtual display.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const SOURCE = fs.readFileSync(
	path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
		"src",
		"virtdisplay.ts",
	),
	"utf-8",
);

it("claims displays with -displayfd", () => {
	expect(SOURCE).toMatch(/program,\s*"-displayfd"/);
});

it("bounds the displayfd read", () => {
	const match = SOURCE.match(/const DISPLAYFD_READ_TIMEOUT_MS = ([\d_]+);/);
	expect(match).not.toBeNull();
	expect(Number(match?.[1].replaceAll("_", ""))).toBeGreaterThan(0);
});
