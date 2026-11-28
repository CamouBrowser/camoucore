/**
 * The display's ICC colour profile, which a page reads through every
 * ICC-tagged image it decodes. The TS twin of display_profile.py; see there
 * for the reasoning.
 *
 * Firefox converts tagged images (gfx.color_management.mode 2) to the
 * display's profile: the OS's, or the file gfx.color_management.display_profile
 * names, which every platform reads first. `display_profile` sets that file
 * from the caller's profile; without one the browser reads the real display's,
 * as stock does. It is a stock Firefox pref, so any release honours it.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DISPLAY_PROFILE_PREF = "gfx.color_management.display_profile";

/** ICC bytes or a path; undefined, null, true or false keep the browser's own. */
export type DisplayProfileOption =
	| Uint8Array
	| string
	| boolean
	| null
	| undefined;

/** Seam for tests: where profiles are written. */
export const displayProfileDeps = {
	cacheDirs: (installDir: string): string[] => [
		path.join(installDir, "display-profiles"),
		path.join(os.tmpdir(), "camoufox-display-profiles"),
	],
};

/** `data` if it is an ICC profile (its declared size fits, "acsp" at 36), else throws. */
export function checkIcc(data: Uint8Array): Uint8Array {
	const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	if (
		b.length < 132 ||
		b.toString("latin1", 36, 40) !== "acsp" ||
		b.readUInt32BE(0) > b.length
	)
		throw new Error("display_profile is not an ICC profile");
	return data;
}

/** The profile's path in the cache (content-addressed, written once). */
function writeProfile(data: Uint8Array, installDir: string): string {
	const name = `${createHash("sha256").update(data).digest("hex").slice(0, 24)}.icc`;
	for (const base of displayProfileDeps.cacheDirs(installDir)) {
		const file = path.join(base, name);
		try {
			if (
				!fs.existsSync(file) ||
				!Buffer.from(data).equals(fs.readFileSync(file))
			) {
				fs.mkdirSync(base, { recursive: true });
				const tmp = path.join(base, `.${name}.${process.pid}`);
				fs.writeFileSync(tmp, data);
				fs.renameSync(tmp, file);
			}
			return file;
		} catch {
			// next directory
		}
	}
	throw new Error("no writable directory for the display profile");
}

/**
 * Point gfx.color_management.display_profile at the caller's display profile.
 *
 * `option`: ICC bytes or a path. undefined, null, true or false: nothing is
 * set and the browser reads the display's own, as stock does. A caller's own
 * pref wins. Returns the path set, or null.
 */
export function applyDisplayProfile(
	prefs: Record<string, any>,
	userPrefKeys: Set<string>,
	option: DisplayProfileOption,
	installDir: string,
): string | null {
	if (
		userPrefKeys.has(DISPLAY_PROFILE_PREF) ||
		option == null ||
		typeof option === "boolean"
	)
		return null;
	const data: Uint8Array =
		typeof option === "string"
			? fs.readFileSync(option.replace(/^~(?=$|\/)/, os.homedir()))
			: option;
	const file = writeProfile(checkIcc(data), installDir);
	prefs[DISPLAY_PROFILE_PREF] = file;
	return file;
}
