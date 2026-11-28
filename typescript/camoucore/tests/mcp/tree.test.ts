import { describe, expect, it } from "vitest";

import { findInTree } from "../../src/mcp/tree.js";

describe("findInTree", () => {
	const tree = [
		'- navigation "Menu" [ref=e1]:',
		'  - link "Home" [ref=e2]',
		"- main [ref=e3]:",
		"  - generic [ref=e4]:",
		"    - list [ref=e5]:",
		"      - listitem [ref=e6]: Invoice 2026-04",
		"      - listitem [ref=e7]: Invoice 2026-05",
		'  - button "Download invoice" [ref=e8]',
	].join("\n");

	it("keeps each match under its named ancestors, once each", () => {
		expect(findInTree(tree, "INVOICE")).toBe(
			[
				"- main [ref=e3]:",
				"      - listitem [ref=e6]: Invoice 2026-04",
				"      - listitem [ref=e7]: Invoice 2026-05",
				'  - button "Download invoice" [ref=e8]',
			].join("\n"),
		);
	});

	it("is empty when nothing matches", () => {
		expect(findInTree(tree, "receipt")).toBe("");
	});

	it("keeps a matching container even though bare ones are dropped as context", () => {
		expect(findInTree(tree, "ref=e4")).toBe(
			["- main [ref=e3]:", "  - generic [ref=e4]:"].join("\n"),
		);
	});
});
