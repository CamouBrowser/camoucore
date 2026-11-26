/**
 * `camoufox login` before Camoufox Pro launches: it says where to make an
 * account, unless a Pro build is installed or a Pro API is named.
 * Twin of the login tests in python/tests/test_pro_gate.py.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const EARLY_ACCESS_URL = "https://camoufox.com/early-access/";
const VARIABLES = [
	"XDG_CACHE_HOME",
	"CAMOUFOX_PRO_API",
	"CAMOUFOX_EXECUTABLE_PATH",
];

let tmp: string;
let saved: Record<string, string | undefined>;
let savedArgv: string[];
let signIns: number;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "camoufox-login-"));
	saved = Object.fromEntries(
		VARIABLES.map((name) => [name, process.env[name]]),
	);
	savedArgv = process.argv;
	for (const name of VARIABLES) delete process.env[name];
	// Nothing is installed here, so no Pro build is either.
	process.env.XDG_CACHE_HOME = tmp;
	signIns = 0;
	vi.resetModules();
	vi.doMock("../src/pro.js", async (load) => ({
		...(await load<typeof import("../src/pro.js")>()),
		login: async () => {
			signIns += 1;
			return {
				account: { name: "acct" },
				user: { github_login: "someone" },
				path: "/x",
			};
		},
	}));
});

afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	process.argv = savedArgv;
	process.exitCode = undefined;
	vi.doUnmock("../src/pro.js");
	vi.restoreAllMocks();
	fs.rmSync(tmp, { recursive: true, force: true });
});

async function login(): Promise<string> {
	let output = "";
	vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		output += String(chunk);
		return true;
	});
	process.argv = ["node", "camoufox", "login"];
	await import("../src/__main__.js");
	await vi.waitFor(() => {
		if (process.exitCode === undefined && signIns === 0)
			throw new Error("still running");
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	vi.mocked(process.stdout.write).mockRestore();
	return output;
}

it("says where to make an account", async () => {
	const output = await login();
	expect(process.exitCode).toBe(1);
	expect(output).toContain(EARLY_ACCESS_URL);
	expect(output).toContain("has not launched");
	expect(signIns).toBe(0);
});

it("signs in with a Pro API", async () => {
	process.env.CAMOUFOX_PRO_API = "https://api.example.com";
	const output = await login();
	expect(process.exitCode ?? 0).toBe(0);
	expect(signIns).toBe(1);
	expect(output).not.toContain(EARLY_ACCESS_URL);
});
