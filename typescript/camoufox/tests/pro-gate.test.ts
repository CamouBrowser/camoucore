/**
 * Camoufox Pro's options before Pro launches: a standard build refuses them
 * with the page where an account is made, before anything is downloaded; a Pro
 * build, or a process pointed at a Pro API, launches them as before.
 * Twin of python/camoufox/tests/test_pro_gate.py.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { earlyAccessUrl, PRO_OPTIONS } from "camoucore/pro.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MODEL } from "./fpgen-setup.js";
import {
	BUNDLE,
	HOME,
	quietly,
	restoreDeps,
	SCRATCH,
	stubHost,
	utils,
} from "./launch-host.js";

const { CamoufoxNotInstalled, ProNotLaunched } = await import(
	"../src/exceptions.js"
);
const pro = await import("../src/pro.js");
const { PRODUCT } = await import("../src/product.js");

const EARLY_ACCESS_URL = "https://camoufox.com/early-access/";
const BUILD_HASH = `sha256:${"0".repeat(64)}`;

const ASKS: Record<string, unknown> = {
	pro_key: "cfp_live_x",
	profile: "shop-account-1",
	warm_plan: "none",
	managed: true,
	farm_gpu: true,
};
const VARIABLES = ["CAMOUFOX_PRO_API", "CAMOUFOX_EXECUTABLE_PATH"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = Object.fromEntries(
		VARIABLES.map((name) => [name, process.env[name]]),
	);
	for (const name of VARIABLES) delete process.env[name];
});

afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	restoreDeps();
	vi.restoreAllMocks();
});

/** No browser is installed, and every step that downloads or writes fails. */
function nothingInstalled() {
	utils.utilsDeps.launchPath = (() => {
		throw new CamoufoxNotInstalled();
	}) as any;
	return [
		"ensureCamoufoxInstalled",
		"installedVerStr",
		"ensureBrowserProfileDir",
	].map((name) =>
		vi.spyOn(utils.utilsDeps, name as never).mockImplementation(() => {
			throw new Error("downloaded");
		}),
	);
}

/** A copy of the test bundle, made a Pro build when asked. */
function build(proBuild: boolean): string {
	const dir = fs.mkdtempSync(path.join(SCRATCH, "gate-"));
	fs.cpSync(BUNDLE, dir, { recursive: true });
	if (proBuild) {
		fs.writeFileSync(
			path.join(dir, "pro-build.json"),
			JSON.stringify({
				build_hash: BUILD_HASH,
				version: "156.0.1-pro.1",
				target: "linux-x86_64",
			}),
		);
	}
	return path.join(dir, "camoufox-bin");
}

it("the account page is Camoufox's", () => {
	expect(earlyAccessUrl(PRODUCT)).toBe(EARLY_ACCESS_URL);
	expect([PRODUCT.site, PRODUCT.captchaEndpoint]).toEqual([
		"https://camoufox.com",
		"https://captcha.camoufox.com/v1",
	]);
});

it("every Pro option is covered", () => {
	expect(Object.keys(ASKS).sort()).toEqual(Object.keys(PRO_OPTIONS).sort());
});

it.each(
	Object.keys(ASKS),
)("%s points at early access before anything is downloaded", async (option) => {
	const spies = nothingInstalled();
	const launch = utils.launchOptions({
		headless: true,
		[option]: ASKS[option],
	});
	await expect(launch).rejects.toBeInstanceOf(ProNotLaunched);
	await expect(launch).rejects.toMatchObject({
		option,
		url: EARLY_ACCESS_URL,
	});
	await expect(launch).rejects.toThrow(EARLY_ACCESS_URL);
	for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it.each(
	Object.keys(ASKS),
)("a standard executable refuses %s too", async (option) => {
	const spies = nothingInstalled();
	await expect(
		utils.launchOptions({
			headless: true,
			executable_path: build(false),
			[option]: ASKS[option],
		}),
	).rejects.toBeInstanceOf(ProNotLaunched);
	for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it.runIf(MODEL.ok)(
	"values that ask for nothing Pro launch on a standard build",
	async () => {
		stubHost();
		const options = await quietly(() =>
			utils.launchOptions({
				env: { HOME },
				executable_path: build(false),
				os: "windows",
				headless: true,
				i_know_what_im_doing: true,
				managed: false,
				farm_gpu: false,
			}),
		);
		for (const name of Object.keys(PRO_OPTIONS))
			expect(options).not.toHaveProperty(name);
		expect(pro.LEASE_FILE_ENV in options.env).toBe(false);
	},
);

it.each([
	[true, false],
	[false, true],
])("a Pro build (%s) or a Pro API (%s) skips the gate", (proBuild, proApi) => {
	if (proApi) process.env.CAMOUFOX_PRO_API = "https://api.example.com";
	expect(() =>
		utils.checkProLaunch({ profile: "shop-account-1" }, build(proBuild)),
	).not.toThrow();
});

it("the installed build decides, without downloading", () => {
	nothingInstalled();
	expect(utils.launchesProBuild()).toBe(false);
	const exe = build(true);
	utils.utilsDeps.launchPath = (() => exe) as any;
	expect(utils.launchesProBuild()).toBe(true);
	process.env.CAMOUFOX_EXECUTABLE_PATH = build(false);
	expect(utils.launchesProBuild()).toBe(false);
});

it.runIf(MODEL.ok)(
	"with a Pro API, a standard build keeps its own refusal",
	async () => {
		stubHost();
		process.env.CAMOUFOX_PRO_API = "https://api.example.com";
		const error = await quietly(() =>
			utils.launchOptions({
				env: { HOME },
				executable_path: build(false),
				os: "windows",
				headless: true,
				profile: "p",
			}),
		).catch((e: unknown) => e);
		expect(String(error)).toMatch(/need a Camoufox Pro build/);
		expect(error).not.toBeInstanceOf(ProNotLaunched);
	},
);
