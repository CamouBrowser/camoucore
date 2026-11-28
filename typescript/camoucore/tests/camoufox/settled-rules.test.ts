/**
 * Twin of python/camoucore/tests/camoufox/test_settled_rules.py: settled decisions the
 * camoufox driver holds, from the browser repositories' ci/tribal-rules.yml.
 */
import * as fs from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { SERVER_FLAGS } from "../../src/camoufox/gpudisplay.js";
import { PRODUCT } from "../../src/camoufox/product.js";
import { COMPOSITE_KEY, SCREEN_KEY } from "../../src/virtdisplay.js";
import { MODEL } from "./fpgen-setup.js";
import {
	BUNDLE_EXE,
	configOf,
	HOME,
	quietly,
	restoreDeps,
	SCRATCH,
	stubHost,
	utils,
} from "./launch-host.js";

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
	const utils = await import("../../src/camoufox/utils.js");
	expect(typeof utils.spoofsWindowDimensions).toBe("function");
	expect(typeof utils.attachNoViewportDefault).toBe("function");
});

describe.skipIf(!MODEL.ok)("a caller's screen", () => {
	afterEach(() => restoreDeps());
	afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

	it("claims the avail the browser reports", async () => {
		// cross-os-canvas-is-the-rfp-placeholder: spoofed avail-screen values go
		// through baseline protection, so the config claims them as it reports
		// them, whether or not the caller set screen.* or window.*.
		stubHost();
		const config = configOf(
			await quietly(() =>
				utils.launchOptions({
					env: { HOME },
					headless: true,
					i_know_what_im_doing: true,
					executable_path: BUNDLE_EXE,
					os: "windows",
					config: {
						"screen.width": 1920,
						"screen.height": 1080,
						"screen.availWidth": 1900,
						"screen.availHeight": 1000,
					},
				} as any),
			),
		);
		expect([config["screen.availWidth"], config["screen.availHeight"]]).toEqual(
			[1920, 1080 - 48],
		);
	});
});
