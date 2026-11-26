/** Twin of python/tests/test_pro.py: Pro's options before Pro opens, refused with
 * the page where an account is made and the waitlist joined. */
import { afterEach, expect, it } from "vitest";
import { ProNotLaunched } from "../src/exceptions.js";
import { checkProOptions, earlyAccessUrl, PRO_OPTIONS } from "../src/pro.js";
import { CHROMIUM, FIREFOX, Product } from "../src/product.js";

const SITE = "https://accounts.example";
const FOX = new Product("camoufox", "Camoufox", FIREFOX, SITE, `${SITE}/v1`);
const WOLF = new Product(
	"camouwolf",
	"Camouwolf",
	CHROMIUM,
	SITE,
	`${SITE}/v1`,
);
const ASKS: Record<string, unknown> = {
	pro_key: "cfp_live_x",
	profile: "shop-account-1",
	warm_plan: "none",
	managed: true,
	farm_gpu: true,
};

afterEach(() => {
	for (const product of [FOX, WOLF])
		delete process.env[product.envVar("PRO_API")];
});

it("covers every Pro option", () => {
	expect(Object.keys(ASKS).sort()).toEqual(Object.keys(PRO_OPTIONS).sort());
});

for (const product of [FOX, WOLF])
	it.each(
		Object.keys(ASKS),
	)(`points ${product.name}'s %s at the waitlist`, (option) => {
		let raised: unknown;
		try {
			checkProOptions(product, { [option]: ASKS[option] });
		} catch (error) {
			raised = error;
		}
		expect(raised).toBeInstanceOf(ProNotLaunched);
		const error = raised as ProNotLaunched;
		expect(error.message).toContain(option);
		expect(error.message).toContain(`${SITE}/early-access/`);
		expect(error.message).toContain(`${product.title} Pro`);
		expect(error.option).toBe(option);
		expect(error.url).toBe(earlyAccessUrl(product));
	});

it("passes values that ask for nothing Pro", () => {
	checkProOptions(FOX, { ...PRO_OPTIONS });
	checkProOptions(FOX, { pro_key: null, profile: null });
	checkProOptions(FOX, {});
});

it("opens the options for the launcher whose Pro API is set", () => {
	process.env.CAMOUFOX_PRO_API = "https://api.dev.example";
	checkProOptions(FOX, ASKS);
	expect(() => checkProOptions(WOLF, ASKS)).toThrow(ProNotLaunched);
});
