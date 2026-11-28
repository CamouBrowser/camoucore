/**
 * Passthrough: launch the browser as this machine's own, with no fingerprint injected.
 *
 * TypeScript twin of python/camoucore/src/camoucore/passthrough.py. A passthrough launch
 * draws no identity and sends the browser no fingerprint config; behaviour
 * options (proxy, humanize, block_images, addons, a virtual display) still apply.
 */
import type { Product } from "./product.js";
import { LeakWarning } from "./warnings.js";

/** Launch options that set or constrain an injected fingerprint (snake_case, as the launchers take them). */
export const IDENTITY_OPTIONS = [
	"config",
	"os",
	"fingerprint",
	"fingerprint_preset",
	"webgl_config",
	"cpu",
	"screen",
	"window",
	"fonts",
	"custom_fonts_only",
	"locale",
	"geoip",
	"canvas_noise",
	"pin_cpu_cores",
	"allow_os_mismatch",
	"ff_version",
	"chrome_version",
] as const;

function isSet(value: unknown): boolean {
	if (value === undefined || value === null || value === false) return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value).length > 0;
	return true;
}

/** The identity options set in `options`, in IDENTITY_OPTIONS order. */
export function passthroughConflicts(
	options: Record<string, unknown>,
): string[] {
	return IDENTITY_OPTIONS.filter((name) => isSet(options[name]));
}

/** Throw naming every identity option set alongside passthrough: true. */
export function checkPassthrough(
	product: Product,
	options: Record<string, unknown>,
): void {
	const conflicts = passthroughConflicts(options);
	if (conflicts.length) {
		throw new Error(
			`passthrough=True launches ${product.title} with this machine's own fingerprint, so it ` +
				`cannot be combined with options that inject one: ${conflicts.join(", ")}. ` +
				"Remove them, or set passthrough=False.",
		);
	}
}

/** A proxied passthrough launch reports this machine's timezone and languages. */
export function warnPassthrough(
	product: Product,
	proxy: unknown,
	iKnowWhatImDoing?: boolean,
): void {
	if (proxy) {
		LeakWarning.warn(
			`passthrough=True with a proxy: ${product.title} reports this machine's timezone, ` +
				"languages and locale, which can disagree with where the proxy exits.",
			iKnowWhatImDoing,
		);
	}
}
