/**
 * Twin of python/camoucore/tests/camouwolf/test_settled_rules.py: settled decisions the
 * camouwolf driver holds, from the browser repositories' ci/tribal-rules.yml.
 */

import { expect, it } from "vitest";
import { SERVER_FLAGS } from "../../src/camouwolf/gpudisplay.js";
import { PRODUCT } from "../../src/camouwolf/product.js";
import { COMPOSITE_KEY, SCREEN_KEY } from "../../src/virtdisplay.js";

it("lets the screen size be overridden", () => {
	expect(PRODUCT.envVar(SCREEN_KEY)).toBe("CAMOUWOLF_VIRTUAL_DISPLAY_SIZE");
});

it("switches Composite with its own variable", () => {
	expect(PRODUCT.envVar(COMPOSITE_KEY)).toBe(
		"CAMOUWOLF_VIRTUAL_DISPLAY_COMPOSITE",
	);
});

it("shares the VT and ends the GPU display with its last client", () => {
	expect(SERVER_FLAGS).toEqual(
		expect.arrayContaining(["-sharevts", "-novtswitch", "-terminate"]),
	);
	expect(SERVER_FLAGS).not.toContain("-noreset");
});
