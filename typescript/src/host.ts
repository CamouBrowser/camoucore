/**
 * The host this process runs on, in the names release assets use.
 *
 * TypeScript twin of python/src/camoucore/host.py.
 */
import * as os from "node:os";
import * as path from "node:path";
import { UnsupportedOS } from "./exceptions.js";

export const ARCH_MAP: Record<string, string> = {
	x64: "x86_64",
	amd64: "x86_64",
	x86: "x86_64",
	ia32: "i686",
	i686: "i686",
	i386: "i686",
	arm64: "arm64",
	aarch64: "arm64",
	arm: "arm64",
};

export const OS_MAP: Record<string, "mac" | "win" | "lin"> = {
	darwin: "mac",
	linux: "lin",
	win32: "win",
};

if (!(process.platform in OS_MAP)) {
	throw new UnsupportedOS(`OS ${process.platform} is not supported`);
}

export const OS_NAME: "mac" | "win" | "lin" = OS_MAP[process.platform];

/**
 * platformdirs' user_cache_dir(appName), reimplemented so the TS and Python
 * launchers share one cache directory. Hardcoding ~/.cache would diverge on
 * hosts that set XDG_CACHE_HOME, and on macOS/Windows entirely.
 */
export function userCacheDir(appName: string): string {
	if (OS_NAME === "win") {
		const localAppData = process.env.LOCALAPPDATA;
		const base =
			localAppData && path.isAbsolute(localAppData)
				? localAppData
				: path.join(os.homedir(), "AppData", "Local");
		return path.join(base, appName, appName, "Cache");
	}
	if (OS_NAME === "mac") {
		return path.join(os.homedir(), "Library", "Caches", appName);
	}
	// platformdirs: any non-blank XDG_CACHE_HOME is taken as-is.
	const xdg = process.env.XDG_CACHE_HOME ?? "";
	const base = xdg.trim() ? xdg : path.join(os.homedir(), ".cache");
	return path.join(base, appName);
}
