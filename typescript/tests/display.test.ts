/**
 * Mirrors python/tests/test_display.py's has_display(): whether a headed
 * browser has a session to open in.
 */
import { expect, it } from "vitest";
import { hasDisplay } from "../src/display.js";
import { OS_NAME } from "../src/host.js";

it.runIf(OS_NAME !== "lin")("is always true off Linux", () => {
	expect(hasDisplay({})).toBe(true);
});

it.runIf(OS_NAME === "lin")("needs a session on Linux", () => {
	expect(hasDisplay({})).toBe(false);
	expect(hasDisplay({ DISPLAY: ":0" })).toBe(true);
	expect(hasDisplay({ WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
	expect(hasDisplay({ DISPLAY: "" })).toBe(false);
});
