/** Twin of python/camoucore/tests/test_passthrough.py. */
import { expect, it } from "vitest";
import {
	checkPassthrough,
	IDENTITY_OPTIONS,
	passthroughConflicts,
	warnPassthrough,
} from "../src/passthrough.js";
import { FIREFOX, Product } from "../src/product.js";
import { recordWarnings } from "../src/warnings.js";

const FOX = new Product(
	"camoufox",
	"Camoufox",
	FIREFOX,
	"https://accounts.example",
);

it("lets unset and behaviour options through", () => {
	const options: Record<string, unknown> = Object.fromEntries(
		IDENTITY_OPTIONS.map((n) => [n, undefined]),
	);
	Object.assign(options, {
		config: {},
		fonts: [],
		custom_fonts_only: false,
		humanize: true,
		proxy: { server: "http://p:1" },
	});
	expect(passthroughConflicts(options)).toEqual([]);
	checkPassthrough(FOX, options);
});

it.each(IDENTITY_OPTIONS)("refuses %s", (name) => {
	expect(() => checkPassthrough(FOX, { [name]: "set" })).toThrow(name);
});

it("names every conflict", () => {
	const call = () =>
		checkPassthrough(FOX, { os: "windows", locale: "de-DE", geoip: true });
	expect(call).toThrow("os, locale, geoip");
	expect(call).toThrow("Camoufox");
});

it("warns about a proxied passthrough unless silenced", async () => {
	const loud = await recordWarnings(() =>
		warnPassthrough(FOX, { server: "http://p:1" }),
	);
	expect(loud.warnings.map((w) => w.category)).toEqual(["LeakWarning"]);
	const quiet = await recordWarnings(() => {
		warnPassthrough(FOX, { server: "http://p:1" }, true);
		warnPassthrough(FOX, undefined);
	});
	expect(quiet.warnings).toEqual([]);
});
