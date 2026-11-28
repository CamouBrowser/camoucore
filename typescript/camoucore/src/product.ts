/**
 * The launcher using camoucore, and the engine it drives.
 *
 * TypeScript twin of python/camoucore/src/camoucore/product.py. Every engine-specific
 * choice in the core reads these; core code never names a launcher.
 */
import { userCacheDir } from "./host.js";

export interface Engine {
	readonly name: "firefox" | "chromium";
	/**
	 * Xvfb's screen for headless="virtual" until the launcher fits it to the
	 * identity. Firefox's window size is spoofed, so a 1x1 root is enough;
	 * Chromium's window is real and has to fit on the display.
	 */
	readonly virtualScreen: string;
}

export const FIREFOX: Engine = { name: "firefox", virtualScreen: "1x1x24" };
export const CHROMIUM: Engine = {
	name: "chromium",
	virtualScreen: "3840x2160x24",
};

export class Product {
	constructor(
		/** The package and cache name: "camoufox", "camouwolf". */
		readonly name: string,
		/** The name in messages: "Camoufox", "Camouwolf". */
		readonly title: string,
		readonly engine: Engine,
	) {}

	get cacheDir(): string {
		return userCacheDir(this.name);
	}

	/** This launcher's name for an environment variable: CAMOUWOLF_<key>. */
	envVar(key: string): string {
		return `${this.name.toUpperCase()}_${key}`;
	}

	getenv(key: string): string | undefined {
		return process.env[this.envVar(key)];
	}
}
