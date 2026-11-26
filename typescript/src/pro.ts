/**
 * Pro's launch options, ahead of Pro's launch.
 *
 * TypeScript twin of python/src/camoucore/pro.py. Pro is a paid service run
 * alongside the free launchers, and it has not opened yet. Its options are
 * taken now so that code written for Pro reads the same, and a value that asks
 * for a Pro feature throws ProNotLaunched, which names the page where an
 * account is made and the waitlist joined.
 *
 * A launcher skips this check when it launches a Pro build, and so does a
 * process whose environment names a Pro API (`<NAME>_PRO_API`), as Pro's own
 * builds and tests do.
 */
import { ProNotLaunched } from "./exceptions.js";
import type { Product } from "./product.js";

/**
 * Each Pro option, with the value that asks for nothing Pro does: no managed
 * proxy, and rendering on this machine's GPU, are what every launch does.
 * Python's names; a launcher maps its own spelling (proKey) onto them.
 */
export const PRO_OPTIONS: Readonly<Record<string, unknown>> = {
	pro_key: undefined,
	profile: undefined,
	warm_plan: undefined,
	managed: false,
	farm_gpu: false,
};

/** Where an account is made and the Pro waitlist joined. */
export function earlyAccessUrl(product: Product): string {
	return `${product.site}/early-access/`;
}

/** Whether this process was pointed at a Pro API, as a Pro build's own tests are. */
export function proApiSet(product: Product): boolean {
	return Boolean(product.getenv("PRO_API")?.trim());
}

/** Throw ProNotLaunched for the first Pro option that asks for a Pro feature. */
export function checkProOptions(
	product: Product,
	options: Readonly<Record<string, unknown>>,
): void {
	if (proApiSet(product)) return;
	for (const [name, inert] of Object.entries(PRO_OPTIONS)) {
		const value = options[name];
		if (value !== undefined && value !== null && value !== inert)
			throw new ProNotLaunched(name, product.title, earlyAccessUrl(product));
	}
}
