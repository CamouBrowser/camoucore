/**
 * Pro's options, before Pro launches: taken, and refused with the page where
 * an account is made. Twin of python/camouwolf/tests/test_pro.py.
 */
import { earlyAccessUrl, PRO_OPTIONS } from "camoucore/pro.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MODEL } from "./fpgen-setup.js";
import {
	BUNDLE_EXE,
	HOME,
	restoreDeps,
	stubHost,
	utils,
} from "./launch-host.js";

const { ProNotLaunched } = await import("../src/exceptions.js");
const { PRODUCT } = await import("../src/product.js");

const EARLY_ACCESS_URL = "https://camoufox.com/early-access/";

const ASKS: Record<string, unknown> = {
	pro_key: "cfp_live_x",
	profile: "shop-account-1",
	warm_plan: "none",
	managed: true,
	farm_gpu: true,
};

let savedProApi: string | undefined;

beforeEach(() => {
	savedProApi = process.env.CAMOUWOLF_PRO_API;
	delete process.env.CAMOUWOLF_PRO_API;
});

afterEach(() => {
	if (savedProApi !== undefined) process.env.CAMOUWOLF_PRO_API = savedProApi;
	restoreDeps();
	vi.restoreAllMocks();
	process.exitCode = undefined;
});

/** Every step of a launch that downloads or writes, made to fail if reached. */
function forbidDownloads() {
	const reached = () => {
		throw new Error("downloaded");
	};
	return [
		"launchPath",
		"installedVerStr",
		"ensureCamouwolfInstalled",
		"ensureBrowserProfileDir",
	].map((name) =>
		vi.spyOn(utils.utilsDeps, name as never).mockImplementation(reached),
	);
}

it("the account page is Camoufox's", () => {
	expect(earlyAccessUrl(PRODUCT)).toBe(EARLY_ACCESS_URL);
});

it.each(
	Object.keys(ASKS),
)("%s points at early access before anything is downloaded", async (option) => {
	const spies = forbidDownloads();
	const launch = utils.launchOptions({
		headless: true,
		[option]: ASKS[option],
	});
	await expect(launch).rejects.toBeInstanceOf(ProNotLaunched);
	await expect(launch).rejects.toMatchObject({ option });
	await expect(launch).rejects.toThrow(EARLY_ACCESS_URL);
	for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it("every Pro option is covered", () => {
	expect(Object.keys(ASKS).sort()).toEqual(Object.keys(PRO_OPTIONS).sort());
});

it.skipIf(!MODEL.ok)("values that ask for nothing Pro launch", async () => {
	stubHost("lin");
	const launch = await utils.launchOptions({
		headless: true,
		os: "linux",
		executable_path: BUNDLE_EXE,
		exclude_addons: ["UBO"],
		env: { HOME },
		i_know_what_im_doing: true,
		managed: false,
		farm_gpu: false,
	});
	for (const name of Object.keys(PRO_OPTIONS))
		expect(launch).not.toHaveProperty(name);
});

it("login says where to make an account", async () => {
	let output = "";
	vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		output += String(chunk);
		return true;
	});
	const argv = process.argv;
	process.argv = ["node", "camouwolf", "login"];
	try {
		vi.resetModules();
		await import("../src/__main__.js");
		await new Promise((resolve) => setTimeout(resolve, 0));
	} finally {
		process.argv = argv;
	}
	expect(output).toContain(EARLY_ACCESS_URL);
	expect(process.exitCode).toBe(1);
});
