/**
 * The captcha option: checked before the launch, and the launched browser's
 * `.captcha` solver after it. Twin of python/camouwolf/tests/test_captcha.py.
 */
import {
	CAPTCHAKRAKEN_ENDPOINT,
	CAPTCHAKRAKEN_KEY_ENV,
	requireClient,
} from "camoucore/captcha.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL } from "./fpgen-setup.js";
import {
	BUNDLE_EXE,
	HOME,
	restoreDeps,
	stubHost,
	utils,
} from "./launch-host.js";

const { NewBrowser } = await import("../src/sync_api.js");
const { CaptchaKeyMissing } = await import("../src/exceptions.js");
const { PRODUCT } = await import("../src/product.js");

const CK_KEY = "ck_live_test";
const ACCOUNT_KEY = "cfp_live_test";
const EARLY_ACCESS_URL = "https://camoufox.com/early-access/";

const VARIABLES = [
	...["PRO_KEY", "CAPTCHA_URL", "CAPTCHA_ENDPOINT", "PRO_API"].map((key) =>
		PRODUCT.envVar(key),
	),
	CAPTCHAKRAKEN_KEY_ENV,
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = Object.fromEntries(
		VARIABLES.map((name) => [name, process.env[name]]),
	);
	for (const name of VARIABLES) delete process.env[name];
	// The client is a test prerequisite (a devDependency): a missing one fails.
	requireClient(PRODUCT);
});

afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	restoreDeps();
	vi.restoreAllMocks();
});

class Browser {
	async newContext() {
		return {};
	}
}

const base = () => ({
	headless: true,
	os: "linux" as const,
	executable_path: BUNDLE_EXE,
	exclude_addons: ["UBO" as const],
	env: { HOME },
});

function launcher() {
	const launched: object[] = [];
	const browserType = {
		launch: async (options: object) => {
			launched.push(options);
			return new Browser();
		},
		launchPersistentContext: async (_dir: string, options: object) => {
			launched.push(options);
			return new Browser();
		},
	} as any;
	return { browserType, launched };
}

it("true without a key lists an account first, before anything is downloaded", async () => {
	const spies = [
		"launchPath",
		"installedVerStr",
		"ensureCamouwolfInstalled",
		"ensureBrowserProfileDir",
	].map((name) =>
		vi.spyOn(utils.utilsDeps, name as never).mockImplementation(() => {
			throw new Error("downloaded");
		}),
	);
	const error = await utils
		.launchOptions({ headless: true, captcha: true })
		.catch((e: unknown) => e);
	expect(error).toBeInstanceOf(CaptchaKeyMissing);
	const message = String((error as Error).message);
	expect(message.indexOf(EARLY_ACCESS_URL)).toBeGreaterThanOrEqual(0);
	expect(message.indexOf(EARLY_ACCESS_URL)).toBeLessThan(
		message.indexOf("captchakraken server"),
	);
	expect((error as { url: string }).url).toBe(EARLY_ACCESS_URL);
	for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it("a bad option fails before the launch", async () => {
	const { browserType, launched } = launcher();
	await expect(
		NewBrowser(browserType, { from_options: { args: [] }, captcha: true }),
	).rejects.toBeInstanceOf(CaptchaKeyMissing);
	expect(launched).toEqual([]);
});

describe.skipIf(!MODEL.ok)("a launched browser", () => {
	beforeEach(() => stubHost("lin"));

	it("never passes the option to Playwright", async () => {
		const launch = await utils.launchOptions({
			...base(),
			captcha: CK_KEY,
			i_know_what_im_doing: true,
		});
		expect(launch).not.toHaveProperty("captcha");
	});

	it("has no solver without captcha", async () => {
		const { browserType } = launcher();
		const browser = await NewBrowser(browserType, base());
		expect(browser.captcha).toBeUndefined();
	});

	it("solves at CaptchaKraken with a CaptchaKraken key", async () => {
		const { browserType, launched } = launcher();
		const browser = await NewBrowser(browserType, {
			...base(),
			captcha: CK_KEY,
		});
		const solver = browser.captcha as unknown as {
			baseUrl: string;
			apiKey: string;
		};
		expect([solver.baseUrl, solver.apiKey]).toEqual([
			CAPTCHAKRAKEN_ENDPOINT,
			CK_KEY,
		]);
		expect(launched[0]).not.toHaveProperty("captcha");
	});

	it("solves at the account's endpoint with an account key", async () => {
		const { browserType } = launcher();
		const browser = await NewBrowser(browserType, {
			...base(),
			captcha: ACCOUNT_KEY,
		});
		expect(browser.captcha?.baseUrl).toBe("https://captcha.camoufox.com/v1");
	});

	it("gives a persistent context one too", async () => {
		const { browserType } = launcher();
		const context = await NewBrowser(browserType, {
			...base(),
			persistent_context: true,
			user_data_dir: HOME,
			captcha: CK_KEY,
		});
		expect(context.captcha?.baseUrl).toBe(CAPTCHAKRAKEN_ENDPOINT);
	});
});
