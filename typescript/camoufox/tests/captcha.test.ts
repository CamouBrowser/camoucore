/**
 * The captcha option: checked before the launch, and the launched browser's
 * `.captcha` solver after it. Twin of python/tests/test_captcha.py.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
	CAPTCHAKRAKEN_ENDPOINT,
	CAPTCHAKRAKEN_KEY_ENV,
	requireClient,
} from "camoucore/captcha.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { restoreDeps, SCRATCH, utils } from "./launch-host.js";

const { NewBrowser } = await import("../src/sync_api.js");
const { AsyncNewBrowser } = await import("../src/async_api.js");
const exceptions = await import("../src/exceptions.js");
const index = await import("../src/index.js");
const pro = await import("../src/pro.js");
const { CamoufoxNotInstalled, CaptchaKeyMissing } = exceptions;
const { PRODUCT } = await import("../src/product.js");

const CK_KEY = "ck_live_test";
const ACCOUNT_KEY = "cfp_live_test";
const ACCOUNT_ENDPOINT = "https://captcha.camoufox.com/v1";
const EARLY_ACCESS_URL = "https://camoufox.com/early-access/";

const VARIABLES = [
	...["PRO_KEY", "CAPTCHA_URL", "CAPTCHA_ENDPOINT", "PRO_API"].map((key) =>
		PRODUCT.envVar(key),
	),
	CAPTCHAKRAKEN_KEY_ENV,
	"VLLM_API_KEY",
	"CAPTCHA_KRAKEN_STATE_DIR",
	"XDG_CONFIG_HOME",
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = Object.fromEntries(
		VARIABLES.map((name) => [name, process.env[name]]),
	);
	for (const name of VARIABLES) delete process.env[name];
	// No CaptchaKraken sign-in, local server, or `camoufox login` key here.
	const home = fs.mkdtempSync(path.join(SCRATCH, "captcha-"));
	process.env.CAPTCHA_KRAKEN_STATE_DIR = path.join(home, "captchakraken");
	process.env.XDG_CONFIG_HOME = path.join(home, "config");
	// These launches pass their own options: installing a browser fails the test.
	utils.utilsDeps.ensureCamoufoxInstalled = async () => {
		throw new Error("downloaded");
	};
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

/** A browser type whose launches are recorded, not run. */
function launcher() {
	const launched: string[] = [];
	const browserType = {
		launch: async () => {
			launched.push("browser");
			return new Browser();
		},
		launchPersistentContext: async () => {
			launched.push("persistent context");
			return new Browser();
		},
	} as any;
	return { browserType, launched };
}

const solverOf = (solver: unknown) =>
	solver as { baseUrl: string; apiKey: string | undefined };

it("true without a key lists an account first, before anything is downloaded", async () => {
	const spies = [
		"ensureCamoufoxInstalled",
		"installedVerStr",
		"ensureBrowserProfileDir",
	].map((name) =>
		vi.spyOn(utils.utilsDeps, name as never).mockImplementation(() => {
			throw new Error("downloaded");
		}),
	);
	utils.utilsDeps.launchPath = (() => {
		throw new CamoufoxNotInstalled();
	}) as any;
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

it("has no solver without captcha", async () => {
	const { browserType, launched } = launcher();
	const browser = await NewBrowser(browserType, { from_options: { args: [] } });
	expect(launched).toEqual(["browser"]);
	expect(browser.captcha).toBeUndefined();
});

it("solves at CaptchaKraken with a CaptchaKraken key", async () => {
	const { browserType } = launcher();
	const browser = await NewBrowser(browserType, {
		from_options: { args: [] },
		captcha: CK_KEY,
	});
	const solver = solverOf(browser.captcha);
	expect([solver.baseUrl, solver.apiKey]).toEqual([
		CAPTCHAKRAKEN_ENDPOINT,
		CK_KEY,
	]);
});

it("solves at the account's endpoint with an account key", async () => {
	const { browserType } = launcher();
	const browser = await NewBrowser(browserType, {
		from_options: { args: [] },
		captcha: ACCOUNT_KEY,
	});
	const solver = solverOf(browser.captcha);
	expect([solver.baseUrl, solver.apiKey]).toEqual([
		ACCOUNT_ENDPOINT,
		ACCOUNT_KEY,
	]);
});

it("true reads the account key from the environment", async () => {
	process.env.CAMOUFOX_PRO_KEY = ACCOUNT_KEY;
	const { browserType } = launcher();
	const browser = await NewBrowser(browserType, {
		from_options: { args: [] },
		captcha: true,
	});
	expect(solverOf(browser.captcha).baseUrl).toBe(ACCOUNT_ENDPOINT);
});

it("one key serves every service: the launch's pro_key, then the stored one", () => {
	process.env.CAMOUFOX_PRO_KEY = "cfp_live_env";
	expect(utils.captchaOf(true, ACCOUNT_KEY)?.key).toBe(ACCOUNT_KEY);
	delete process.env.CAMOUFOX_PRO_KEY;
	vi.spyOn(pro, "storedKey").mockReturnValue("cfp_live_stored");
	const captcha = utils.captchaOf(true);
	expect([captcha?.endpoint, captcha?.key]).toEqual([
		ACCOUNT_ENDPOINT,
		"cfp_live_stored",
	]);
});

it("a self-hosted server gets no Camoufox key", async () => {
	process.env.CAMOUFOX_PRO_KEY = ACCOUNT_KEY;
	expect(utils.captchaOf("http://localhost:8000/v1")?.key ?? null).toBeNull();
	const { browserType } = launcher();
	const browser = await NewBrowser(browserType, {
		from_options: { args: [] },
		captcha: "http://localhost:8000/v1",
	});
	const solver = solverOf(browser.captcha);
	expect(solver.baseUrl).toBe("http://localhost:8000/v1");
	expect(solver.apiKey).not.toBe(ACCOUNT_KEY);
});

it("gives a persistent context one too", async () => {
	const { browserType, launched } = launcher();
	const context = await NewBrowser(browserType, {
		from_options: { args: [] },
		persistent_context: true,
		user_data_dir: SCRATCH,
		captcha: CK_KEY,
	});
	expect(launched).toEqual(["persistent context"]);
	expect(solverOf(context.captcha).baseUrl).toBe(CAPTCHAKRAKEN_ENDPOINT);
});

it("the async API gets the same solver", async () => {
	const { browserType } = launcher();
	const browser = await AsyncNewBrowser(browserType, {
		from_options: { args: [] },
		captcha: CK_KEY,
	});
	expect(solverOf(browser.captcha).baseUrl).toBe(CAPTCHAKRAKEN_ENDPOINT);
});

it("the exceptions are Camoufox's", () => {
	for (const name of [
		"ProNotLaunched",
		"CaptchaKeyMissing",
		"CaptchaKrakenMissing",
	]) {
		expect(exceptions).toHaveProperty(name);
		expect(index).toHaveProperty(name);
	}
});
