/** Twin of python/camoucore/tests/test_captcha.py: an account key, a CaptchaKraken key or a
 * server you host, and a missing one refused with a free account listed first. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CAPTCHAKRAKEN_ENDPOINT,
	type Captcha,
	requireClient,
	resolveCaptcha,
} from "../src/captcha.js";
import { CaptchaKeyMissing } from "../src/exceptions.js";
import { FIREFOX, Product } from "../src/product.js";

const FOX = new Product(
	"camoufox",
	"Camoufox",
	FIREFOX,
	"https://accounts.example",
	"https://captcha.example/v1",
);
const ACCOUNT_KEY = "cfp_live_abc123";
const CK_KEY = "ck_live_def456";
const VARIABLES = [
	"CAMOUFOX_PRO_KEY",
	"CAMOUFOX_CAPTCHA_URL",
	"CAMOUFOX_CAPTCHA_ENDPOINT",
	"CAPTCHA_KRAKEN_API_KEY",
	"CAPTCHA_KRAKEN_CLIENT",
];
let saved: Record<string, string | undefined>;
beforeEach(() => {
	saved = Object.fromEntries(
		VARIABLES.map((name) => [name, process.env[name]]),
	);
	for (const name of VARIABLES) delete process.env[name];
});
afterEach(() => {
	for (const [name, value] of Object.entries(saved))
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
});

const shape = (captcha: Captcha | undefined) =>
	captcha && [captcha.endpoint, captcha.key, captcha.source];

it.each([undefined, null, false])("asks for no captcha with %s", (option) => {
	expect(resolveCaptcha(FOX, option)).toBeUndefined();
});

it("solves an account key at the account's endpoint", () => {
	expect(shape(resolveCaptcha(FOX, ACCOUNT_KEY))).toEqual([
		"https://captcha.example/v1",
		ACCOUNT_KEY,
		"account",
	]);
});

it("lets the account's endpoint be moved", () => {
	process.env.CAMOUFOX_CAPTCHA_ENDPOINT = "https://staging.example/v1";
	expect(resolveCaptcha(FOX, ACCOUNT_KEY)?.endpoint).toBe(
		"https://staging.example/v1",
	);
});

it("solves a CaptchaKraken key at CaptchaKraken", () => {
	expect(shape(resolveCaptcha(FOX, CK_KEY))).toEqual([
		CAPTCHAKRAKEN_ENDPOINT,
		CK_KEY,
		"captchakraken",
	]);
});

it("reads a URL as a server you host", () => {
	expect(shape(resolveCaptcha(FOX, "http://localhost:8000/v1/"))).toEqual([
		"http://localhost:8000/v1",
		undefined,
		"self-hosted",
	]);
});

it("gives a server you host a key", () => {
	expect(
		shape(
			resolveCaptcha(FOX, {
				endpoint: "https://solver.internal/v1",
				key: "local-secret",
			}),
		),
	).toEqual(["https://solver.internal/v1", "local-secret", "self-hosted"]);
});

it("reads an object with only a key like a string", () => {
	expect(resolveCaptcha(FOX, { key: CK_KEY })?.source).toBe("captchakraken");
});

it.each([
	["CAMOUFOX_PRO_KEY", ACCOUNT_KEY, "account"],
	["CAPTCHA_KRAKEN_API_KEY", CK_KEY, "captchakraken"],
	// The Pro docs tell people to put their account key here for the client.
	["CAPTCHA_KRAKEN_API_KEY", ACCOUNT_KEY, "account"],
	["CAMOUFOX_CAPTCHA_URL", "http://localhost:8000/v1", "self-hosted"],
])("reads %s for true", (variable, value, source) => {
	process.env[variable] = value;
	expect(resolveCaptcha(FOX, true)?.source).toBe(source);
});

it("takes the account key first", () => {
	process.env.CAPTCHA_KRAKEN_API_KEY = CK_KEY;
	process.env.CAMOUFOX_PRO_KEY = ACCOUNT_KEY;
	expect(resolveCaptcha(FOX, true)?.key).toBe(ACCOUNT_KEY);
});

it.each([
	true,
	{},
	{ key: "" },
] as const)("lists an account first and hosting second when %j has no key", (option) => {
	let raised: unknown;
	try {
		resolveCaptcha(FOX, option);
	} catch (error) {
		raised = error;
	}
	expect(raised).toBeInstanceOf(CaptchaKeyMissing);
	const message = (raised as Error).message;
	const account = message.indexOf(
		"1. Make a free Camoufox account at https://accounts.example/early-access/",
	);
	const hosted = message.indexOf("2. Host CaptchaKraken yourself");
	expect(account).toBeGreaterThanOrEqual(0);
	expect(hosted).toBeGreaterThan(account);
	expect(message).toContain("CAMOUFOX_PRO_KEY");
	expect(message).toContain("CAMOUFOX_CAPTCHA_URL");
	expect((raised as CaptchaKeyMissing).url).toBe(
		"https://accounts.example/early-access/",
	);
});

it("refuses an unknown key without echoing it", () => {
	expect(() => resolveCaptcha(FOX, "sk-secret-value")).toThrow(/not a key/);
	expect(() => resolveCaptcha(FOX, "sk-secret-value")).not.toThrow(
		/sk-secret-value/,
	);
});

it("names a bad variable", () => {
	process.env.CAMOUFOX_CAPTCHA_URL = "localhost:8000";
	expect(() => resolveCaptcha(FOX, true)).toThrow(/CAMOUFOX_CAPTCHA_URL/);
});

it.each([
	{ url: "http://x" },
	{ endpoint: "not a url" },
	3,
])("refuses the malformed option %j", (option) => {
	expect(() => resolveCaptcha(FOX, option as never)).toThrow();
});

it("keeps the key out of JSON and logs", () => {
	const captcha = resolveCaptcha(FOX, ACCOUNT_KEY);
	expect(JSON.stringify(captcha)).not.toContain(ACCOUNT_KEY);
});

describe("with the client installed", () => {
	// The client is a dev dependency, so this is a prerequisite: a missing one fails.
	beforeEach(() => requireClient(FOX));

	it("solves where the option says", async () => {
		const solver = await resolveCaptcha(
			FOX,
			"http://localhost:8123/v1",
		)?.solver(FOX, { maxSolveLoops: 2 });
		expect(solver?.baseUrl).toBe("http://localhost:8123/v1");
	});

	it("keeps each solver's own endpoint and key", async () => {
		const first = (await resolveCaptcha(FOX, CK_KEY)?.solver(FOX)) as never as {
			baseUrl: string;
			apiKey: string;
		};
		const second = (await resolveCaptcha(FOX, ACCOUNT_KEY)?.solver(
			FOX,
		)) as never as { baseUrl: string; apiKey: string };
		expect([first.baseUrl, first.apiKey]).toEqual([
			CAPTCHAKRAKEN_ENDPOINT,
			CK_KEY,
		]);
		expect([second.baseUrl, second.apiKey]).toEqual([
			"https://captcha.example/v1",
			ACCOUNT_KEY,
		]);
	});

	it("names the launcher on hosted solves, unless the caller already did", async () => {
		await resolveCaptcha(FOX, CK_KEY)?.solver(FOX);
		expect(process.env.CAPTCHA_KRAKEN_CLIENT).toBe("camoufox");
		process.env.CAPTCHA_KRAKEN_CLIENT = "my-tool/1.0";
		await resolveCaptcha(FOX, CK_KEY)?.solver(FOX);
		expect(process.env.CAPTCHA_KRAKEN_CLIENT).toBe("my-tool/1.0");
	});
});
