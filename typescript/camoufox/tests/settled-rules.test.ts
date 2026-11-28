/**
 * Twin of python/camoufox/tests/test_settled_rules.py: settled decisions the
 * camoufox driver holds, from the browser repositories' ci/tribal-rules.yml.
 */
import { COMPOSITE_KEY, SCREEN_KEY } from "camoucore/virtdisplay.js";
import { expect, it } from "vitest";
import { SERVER_FLAGS } from "../src/gpudisplay.js";
import { PRODUCT } from "../src/product.js";

it("lets the screen size be overridden", () => {
	expect(PRODUCT.envVar(SCREEN_KEY)).toBe("CAMOUFOX_VIRTUAL_DISPLAY_SIZE");
});

it("switches Composite with its own variable", () => {
	expect(PRODUCT.envVar(COMPOSITE_KEY)).toBe(
		"CAMOUFOX_VIRTUAL_DISPLAY_COMPOSITE",
	);
});

it("shares the VT and ends the GPU display with its last client", () => {
	expect(SERVER_FLAGS).toEqual(
		expect.arrayContaining(["-sharevts", "-novtswitch", "-terminate"]),
	);
	expect(SERVER_FLAGS).not.toContain("-noreset");
});

it("gives Firefox a 1x1x24 virtual display", () => {
	expect(PRODUCT.engine.virtualScreen).toBe("1x1x24");
});

it("drops the viewport when the window is spoofed", async () => {
	const utils = await import("../src/utils.js");
	expect(typeof utils.spoofsWindowDimensions).toBe("function");
	expect(typeof utils.attachNoViewportDefault).toBe("function");
});
