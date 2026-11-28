/** Twin of python/camoucore/tests/test_product.py: two launchers in one process keep their own names. */
import { afterEach, expect, it } from "vitest";
import { VirtualDisplayNotSupported } from "../src/exceptions.js";
import { CHROMIUM, FIREFOX, Product } from "../src/product.js";
import { SCREEN_KEY, VirtualDisplay } from "../src/virtdisplay.js";

const FOX = new Product("camoufox", "Camoufox", FIREFOX);
const WOLF = new Product("camouwolf", "Camouwolf", CHROMIUM);

afterEach(() => {
	for (const product of [FOX, WOLF])
		delete process.env[product.envVar(SCREEN_KEY)];
});

it("gives each engine its own virtual screen", () => {
	expect(new VirtualDisplay(FOX).screen).toBe("1x1x24");
	expect(new VirtualDisplay(WOLF).screen).toBe("3840x2160x24");
});

it("reads only the launcher's own environment", () => {
	process.env.CAMOUWOLF_VIRTUAL_DISPLAY_SIZE = "1920x1080";
	expect(new VirtualDisplay(WOLF).screen).toBe("1920x1080x24");
	expect(new VirtualDisplay(FOX).screen).toBe("1x1x24");
});

it("names the launcher's variable in a bad override's error", () => {
	process.env.CAMOUFOX_VIRTUAL_DISPLAY_SIZE = "big";
	expect(() => new VirtualDisplay(FOX)).toThrow(
		new VirtualDisplayNotSupported(
			"CAMOUFOX_VIRTUAL_DISPLAY_SIZE must look like '1920x1080' or '1920x1080x24', got 'big'",
		),
	);
});

it("keeps a cache directory per launcher", () => {
	expect(FOX.cacheDir.endsWith("camoufox")).toBe(true);
	expect(WOLF.cacheDir.endsWith("camouwolf")).toBe(true);
});

it("fits only a display nobody sized", () => {
	const drawn = new VirtualDisplay(WOLF);
	drawn.fit(2880, 1800);
	expect(drawn.screen).toBe("2880x1800x24");

	const chosen = new VirtualDisplay(WOLF, false, "1920x1080x24");
	chosen.fit(2880, 1800);
	expect(chosen.screen).toBe("1920x1080x24");

	process.env.CAMOUWOLF_VIRTUAL_DISPLAY_SIZE = "1600x900";
	const fixed = new VirtualDisplay(WOLF);
	fixed.fit(2880, 1800);
	expect(fixed.screen).toBe("1600x900x24");
});
