/**
 * A caller's display ICC profile (display_profile.ts).
 * Twin of python/camoucore/tests/camoufox/test_display_profile.py.
 *
 * Stock Firefox converts ICC-tagged images to the display's profile, and a
 * page reads the result off a canvas. gfx.color_management.display_profile, a
 * stock pref read before the OS profile on every platform, points the browser
 * at the caller's profile. Without one the launcher sets nothing, for any
 * identity.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	HOME,
	isolateLaunch,
	quietly,
	restoreDeps,
	SCRATCH,
	utils,
} from "./launch-host.js";

const dp = await import("../../src/camoufox/display_profile.js");

const WIN_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0";
const LIN_UA =
	"Mozilla/5.0 (X11; Linux x86_64; rv:159.0) Gecko/20100101 Firefox/159.0";
const PREF = "gfx.color_management.display_profile";

/** A minimal byte string the launcher accepts as an ICC profile, told apart by `tag`. */
function icc(tag: string): Buffer {
	const body = Buffer.alloc(16);
	body.write(tag, "latin1");
	const header = Buffer.alloc(128);
	header.writeUInt32BE(128 + 4 + body.length, 0);
	header.write("acsp", 36, "latin1");
	return Buffer.concat([header, Buffer.alloc(4), body]);
}

const OTHER = icc("other");

const CACHE_DIR = path.join(SCRATCH, "display-profiles");
const ORIGINAL_DEPS = { ...dp.displayProfileDeps };

beforeEach(() => {
	dp.displayProfileDeps.cacheDirs = () => [CACHE_DIR];
});
afterEach(() => {
	Object.assign(dp.displayProfileDeps, ORIGINAL_DEPS);
	restoreDeps();
});
afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

/** launchOptions on a Linux host; returns the prefs. */
async function launch(
	opts: { ua?: string; config?: Record<string, any>; [key: string]: any } = {},
): Promise<Record<string, any>> {
	const { ua = WIN_UA, config = {}, ...rest } = opts;
	isolateLaunch();
	utils.utilsDeps.hostOsKey = () => "lin";
	const options = (await quietly(() =>
		utils.launchOptions({
			env: { HOME },
			config: { "navigator.userAgent": ua, ...config },
			headless: true,
			i_know_what_im_doing: true,
			...rest,
		}),
	)) as Record<string, any>;
	return options.firefoxUserPrefs;
}

const profileOf = (prefs: Record<string, any>) => fs.readFileSync(prefs[PREF]);

describe("launchOptions", () => {
	it("hands the caller's bytes to the pref", async () => {
		expect(profileOf(await launch({ display_profile: OTHER }))).toEqual(OTHER);
	});

	it("hands the caller's path to the pref", async () => {
		const f = path.join(SCRATCH, "display.icm");
		fs.writeFileSync(f, OTHER);
		expect(profileOf(await launch({ display_profile: f }))).toEqual(OTHER);
	});

	it("writes the same file for the same profile", async () => {
		const a = (await launch({ display_profile: OTHER }))[PREF];
		const b = (await launch({ display_profile: OTHER }))[PREF];
		expect(a).toBe(b);
	});

	it.each([
		undefined,
		true,
		false,
	])("keeps the browser's own without a profile (%s)", async (option) => {
		expect(PREF in (await launch({ display_profile: option }))).toBe(false);
		expect(
			PREF in (await launch({ ua: LIN_UA, display_profile: option })),
		).toBe(false);
	});

	it("lets the caller's pref win", async () => {
		const prefs = await launch({
			display_profile: OTHER,
			firefox_user_prefs: { [PREF]: "/x.icc" },
		});
		expect(prefs[PREF]).toBe("/x.icc");
	});

	it("a host-OS identity still takes the caller's profile", async () => {
		expect(
			profileOf(await launch({ ua: LIN_UA, display_profile: OTHER })),
		).toEqual(OTHER);
	});

	it("refuses bytes that are not an ICC profile", async () => {
		const bad = Buffer.from("\x89PNG not a profile".repeat(10), "latin1");
		await expect(launch({ display_profile: bad })).rejects.toThrow(
			/not an ICC profile/,
		);
	});
});
