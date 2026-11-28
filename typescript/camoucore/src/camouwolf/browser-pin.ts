/**
 * The browser build this copy of the library was released with.
 *
 * Twin of python/camoucore/src/camoucore/camouwolf/browser_pin.py, reading the same
 * `browser-pin.json` (a DATA_FILES entry). Every published package is stamped
 * with the one browser release built from the same sources; by default the
 * library fetches and launches exactly that build. An explicit user choice
 * (`camouwolf set ...`) is kept, with a warning at launch. A development
 * checkout carries `{}` and pins nothing.
 *
 * The browser repository's pin wins: its `camouwolf` npm package depends on
 * exactly one release of this driver and ships `camouwolf_pin/browser-pin.json`
 * (exported at that subpath), naming the browser released with it. Without
 * that package the driver reads its own file, which camoucore's release
 * stamps with the browser its CI tested.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { LOCAL_DATA } from "./paths.js";
import { warn } from "./warnings.js";

/** Test seam, like pkgmanDeps: where the pin is read from. */
export const browserPinDeps = {
	/** The driver's own pin, read without the browser repository's package. */
	file: path.join(LOCAL_DATA, "browser-pin.json"),
	/** Where the browser repository's package is resolved from. */
	resolveFrom: import.meta.url,
};

/** The browser repository's pin, in its `camouwolf` package. */
const WRAPPER_PIN = "camouwolf/camouwolf_pin/browser-pin.json";

/** The browser repository's pin when its package is installed, else the driver's. */
export function pinFile(): string {
	try {
		const wrapper = createRequire(browserPinDeps.resolveFrom).resolve(
			WRAPPER_PIN,
		);
		if (fs.statSync(wrapper).isFile()) return wrapper;
	} catch {
		// Not installed, or it does not export the pin: the driver's own.
	}
	return browserPinDeps.file;
}

export interface BrowserPin {
	tag: string;
	repo: string;
	repoName: string;
	version: string;
	build: string;
}

/** `<chromium version>-<release>`, the form `camouwolf set` and the cache use. */
export function pinSpec(pin: BrowserPin): string {
	return `${pin.version}-${pin.build}`;
}

/** The stamped pin (pinFile()), or null for an unpinned (development) copy. */
export function loadPin(file: string = pinFile()): BrowserPin | null {
	let data: Record<string, string | null>;
	try {
		data = JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch {
		return null;
	}
	if (!data?.tag) return null;
	return {
		tag: data.tag,
		repo: String(data.repo),
		repoName: String(data.repo_name).toLowerCase(),
		version: String(data.version),
		build: String(data.build),
	};
}

/** Whether the user chose a channel or a build themselves. */
function isExplicitChoice(config: {
	channel?: string;
	pinned?: string;
}): boolean {
	return Boolean(config.channel || config.pinned);
}

/** The package pin, unless the user explicitly chose otherwise. */
export function effectivePin(config: {
	channel?: string;
	pinned?: string;
}): BrowserPin | null {
	const pin = loadPin();
	return pin && !isExplicitChoice(config) ? pin : null;
}

export function pinMatches(
	pin: BrowserPin,
	repoName: string,
	version: string,
	build: string,
): boolean {
	return (
		repoName.toLowerCase() === pin.repoName &&
		version === pin.version &&
		build === pin.build
	);
}

let warned = false;

/** Warn once when an explicitly chosen build is not the one this library pairs with. */
export function warnIfUnpaired(
	repoName: string,
	version: string,
	build: string,
): void {
	const pin = loadPin();
	if (warned || pin === null || pinMatches(pin, repoName, version, build)) {
		return;
	}
	warned = true;
	warn(
		`Launching ${repoName.toLowerCase()} ${version}-${build}, which you selected explicitly. ` +
			`This camouwolf release was built and tested with ${pin.repoName} ${pinSpec(pin)} ` +
			`(${pin.tag}); other builds may not be compatible. ` +
			"Run `camouwolf set --release` to go back to the paired build.",
	);
}

/** Test hook: forget that the warning was already issued. */
export function resetUnpairedWarning(): void {
	warned = false;
}
