/** The tools over the protocol, in process, against a launcher with no browser. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Browser, BrowserType } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Secrets } from "../../src/mcp/secrets.js";
import {
	createServer,
	type Launcher,
	type ServerOptions,
} from "../../src/mcp/server.js";
// Plain JavaScript, so the spawned server in cli.test.ts can import it too.
import * as fake from "./fake-launcher.mjs";

const calls: any[] = fake.calls;
const firefox = { name: () => "firefox" } as unknown as BrowserType;

interface Connected {
	tool(
		name: string,
		args?: Record<string, unknown>,
	): Promise<{ json: any; text: string; raw: any; isError: boolean }>;
	toolNames(): Promise<string[]>;
	launched: (Browser & { crash(): void })[];
}

let client: Client | undefined;

async function connect(
	overrides: Partial<Launcher> = {},
	options: ServerOptions = {},
): Promise<Connected> {
	const launched: Connected["launched"] = [];
	const launcher: Launcher = {
		PRODUCT: fake.PRODUCT,
		NewBrowser: async (browserType, options) => {
			const browser = await fake.NewBrowser(browserType, options);
			launched.push(browser);
			return browser;
		},
		...overrides,
	};
	const { server } = createServer(launcher, firefox, options);
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	await server.connect(serverSide);
	client = new Client({ name: "test", version: "1.0.0" });
	await client.connect(clientSide);
	const connected = client;
	return {
		launched,
		async toolNames() {
			const { tools } = await connected.listTools();
			return tools.map((tool) => tool.name).sort();
		},
		async tool(name, args = {}) {
			const raw: any = await connected.callTool({ name, arguments: args });
			const text: string = raw.content.find(
				(part: any) => part.type === "text",
			)?.text;
			// The SDK words a schema refusal itself, as text.
			const json = text.startsWith("{") ? JSON.parse(text) : null;
			return { raw, json, text, isError: Boolean(raw.isError) };
		},
	};
}

async function open(
	mcp: Connected,
	args: Record<string, unknown> = {},
): Promise<string> {
	const opened = await mcp.tool("session_open", args);
	expect(opened.isError, JSON.stringify(opened.json)).toBe(false);
	return opened.json.session_id;
}

const pageCalls = (action: string) => calls.filter((c) => c.action === action);

describe("camoucore-mcp tools", () => {
	beforeEach(() => {
		calls.length = 0;
		fake.page.tree = '- button "Go" [ref=e2]';
		fake.page.fileInput = true;
		fake.page.navigatesDuringSnapshot = undefined;
	});
	afterEach(async () => {
		await client?.close();
	});

	it("offers type_secret only with secrets", async () => {
		const base = [
			"click",
			"go_back",
			"hand_off",
			"hover",
			"navigate",
			"press_key",
			"screenshot",
			"scroll",
			"select_option",
			"session_close",
			"session_open",
			"snapshot",
			"switch_tab",
			"tabs",
			"type",
		];
		expect(await (await connect()).toolNames()).toEqual(base);
		await client?.close();
		const withSecrets = await connect(
			{},
			{ secrets: new Secrets({ "example.com": { password: "hunter22" } }) },
		);
		expect(await withSecrets.toolNames()).toEqual(
			[...base, "type_secret"].sort(),
		);
	});

	it("launches headless and humanized unless asked otherwise", async () => {
		const mcp = await connect();
		await open(mcp);
		await open(mcp, { os: "windows", visible: true, humanize: false });
		expect(pageCalls("launch")).toEqual([
			{
				action: "launch",
				engine: "firefox",
				options: { headless: true, humanize: true },
			},
			{
				action: "launch",
				engine: "firefox",
				options: { headless: false, humanize: false, os: "windows" },
			},
		]);
	});

	it("acts on the page by aria ref", async () => {
		const mcp = await connect();
		const session_id = await open(mcp);
		const navigated = await mcp.tool("navigate", {
			session_id,
			url: "https://example.com/",
		});
		expect(navigated.json).toEqual({
			url: "https://example.com/",
			title: "A page",
			status: 200,
		});
		const snap = await mcp.tool("snapshot", { session_id });
		expect(snap.json.snapshot).toContain("[ref=e2]");
		expect(pageCalls("ariaSnapshot")[0].options).toEqual({ mode: "ai" });

		await mcp.tool("click", { session_id, ref: "e2" });
		await mcp.tool("hover", { session_id, ref: "e3" });
		await mcp.tool("type", { session_id, ref: "e4", text: "hi", submit: true });
		await mcp.tool("scroll", { session_id, ref: "e5", delta_y: 300 });
		expect(
			calls
				.filter((c) => c.selector)
				.map((c) => [c.action, c.selector, c.argument]),
		).toEqual([
			["click", "aria-ref=e2", undefined],
			["hover", "aria-ref=e3", undefined],
			["click", "aria-ref=e4", undefined],
			["pressSequentially", "aria-ref=e4", "hi"],
			["press", "aria-ref=e4", "Enter"],
			["scrollIntoViewIfNeeded", "aria-ref=e5", undefined],
			["hover", "aria-ref=e5", undefined],
		]);
		expect(pageCalls("wheel")).toEqual([{ action: "wheel", x: 0, y: 300 }]);

		const shot = await mcp.tool("screenshot", { session_id });
		expect(shot.raw.content[1]).toMatchObject({
			type: "image",
			mimeType: "image/png",
		});
	});

	it("selects, presses keys and goes back", async () => {
		const mcp = await connect();
		const session_id = await open(mcp);
		const selected = await mcp.tool("select_option", {
			session_id,
			ref: "e7",
			options: ["Blue"],
		});
		expect(selected.json).toEqual({ selected: ["Blue"] });
		await mcp.tool("press_key", { session_id, key: "Escape" });
		await mcp.tool("go_back", { session_id });
		expect(
			calls
				.filter((c) => ["selectOption", "key", "goBack"].includes(c.action))
				.map((c) => [c.action, c.selector ?? c.key]),
		).toEqual([
			["selectOption", "aria-ref=e7"],
			["key", "Escape"],
			["goBack", undefined],
		]);
	});

	it("reads only the part of the page asked for", async () => {
		const mcp = await connect();
		const session_id = await open(mcp);
		fake.page.tree = [
			"- main [ref=e1]:",
			"  - generic [ref=e2]:",
			'    - heading "Identity validations" [level=2] [ref=e3]',
			'    - grid "Identity validations" [ref=e4]:',
			"      - row [ref=e5]:",
			'        - gridcell "CamoufoxCloud LLC" [ref=e6]',
			'        - gridcell "Action Required" [ref=e7]',
			'  - button "Refresh" [ref=e8]',
		].join("\n");

		const found = await mcp.tool("snapshot", {
			session_id,
			find: "action required",
		});
		// The match, under its named ancestors; the bare container is left out.
		expect(found.json.snapshot).toBe(
			[
				"- main [ref=e1]:",
				'    - grid "Identity validations" [ref=e4]:',
				"      - row [ref=e5]:",
				'        - gridcell "Action Required" [ref=e7]',
			].join("\n"),
		);
		const missing = await mcp.tool("snapshot", {
			session_id,
			find: "Completed",
		});
		expect(missing.json.snapshot).toBe('Nothing here contains "Completed".');

		await mcp.tool("snapshot", { session_id, ref: "e4", depth: 2 });
		expect(pageCalls("ariaSnapshot").at(-1)).toEqual({
			action: "ariaSnapshot",
			selector: "aria-ref=e4",
			options: { mode: "ai", depth: 2 },
		});
	});

	it("searches a snapshot only after its secrets are redacted", async () => {
		const secrets = new Secrets({ "example.com": { password: "hunter22" } });
		const mcp = await connect({}, { secrets });
		const session_id = await open(mcp);
		fake.page.tree = '- textbox "Password" [ref=e2]: hunter22';
		const probe = await mcp.tool("snapshot", { session_id, find: "hunter2" });
		expect(probe.json.snapshot).toBe('Nothing here contains "hunter2".');
		const named = await mcp.tool("snapshot", { session_id, find: "secret" });
		expect(named.json.snapshot).toBe(
			'- textbox "Password" [ref=e2]: <secret:password>',
		);
	});

	it("uploads only files inside the uploads directory", async () => {
		expect(await (await connect()).toolNames()).not.toContain("upload_file");
		await client?.close();

		const base = fs.mkdtempSync(path.join(os.tmpdir(), "camoucore-mcp-test-"));
		const uploads = path.join(base, "uploads");
		fs.mkdirSync(uploads);
		fs.writeFileSync(path.join(uploads, "letter.pdf"), "%PDF");
		fs.mkdirSync(path.join(uploads, "folder"));
		fs.writeFileSync(path.join(base, "private.txt"), "not for pages");
		fs.symlinkSync(
			path.join(base, "private.txt"),
			path.join(uploads, "link.txt"),
		);
		try {
			const mcp = await connect({}, { uploads });
			expect(client?.getInstructions()).toContain(uploads);
			const session_id = await open(mcp);

			const uploaded = await mcp.tool("upload_file", {
				session_id,
				ref: "e9",
				files: ["letter.pdf"],
			});
			expect(uploaded.json).toEqual({ uploaded: ["letter.pdf"], ref: "e9" });
			const letter = fs.realpathSync(path.join(uploads, "letter.pdf"));
			expect(pageCalls("setInputFiles")).toEqual([
				{
					action: "setInputFiles",
					selector: "aria-ref=e9",
					argument: [letter],
				},
			]);

			// A button that opens the picker: the picker is answered instead.
			fake.page.fileInput = false;
			await mcp.tool("upload_file", {
				session_id,
				ref: "e10",
				files: ["letter.pdf"],
			});
			expect(pageCalls("click").at(-1).selector).toBe("aria-ref=e10");
			expect(pageCalls("chooserSetFiles")).toEqual([
				{ action: "chooserSetFiles", event: "filechooser", files: [letter] },
			]);

			for (const [name, message] of [
				["../private.txt", "outside the uploads directory"],
				// Whether a file exists out there is not the agent's to learn.
				["../no-such-file", "outside the uploads directory"],
				[path.join(base, "private.txt"), "outside the uploads directory"],
				["link.txt", "outside the uploads directory"],
				["folder", "not a file"],
				["missing.pdf", "There is no missing.pdf"],
			]) {
				const refused = await mcp.tool("upload_file", {
					session_id,
					ref: "e9",
					files: [name],
				});
				expect(refused.isError, name).toBe(true);
				expect(refused.json.message).toContain(message);
			}
			expect(pageCalls("setInputFiles")).toHaveLength(1);
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	});

	it("tells the agent its secrets by name and never sends a placeholder as text", async () => {
		const secrets = new Secrets({ "example.com": { password: "hunter22" } });
		const mcp = await connect({}, { secrets });
		const instructions = client?.getInstructions() ?? "";
		expect(instructions).toContain('{"example.com":["password"]}');
		expect(instructions).not.toContain("hunter22");

		const session_id = await open(mcp);
		const refused = await mcp.tool("type", {
			session_id,
			ref: "e4",
			text: "<secret:password>",
		});
		expect(refused.isError).toBe(true);
		expect(refused.json.message).toContain("type_secret");
		expect(pageCalls("pressSequentially")).toEqual([]);
	});

	it("says a tool failed because the page left the allowed domains", async () => {
		// A click's navigation can commit while the next tool reads the page; the
		// frames detaching under it is a symptom, the domain is what to report.
		const mcp = await connect({}, { allowedDomains: ["*.example.com"] });
		const session_id = await open(mcp);
		await mcp.tool("navigate", { session_id, url: "https://www.example.com/" });
		fake.page.navigatesDuringSnapshot = "https://example.org/";
		const refused = await mcp.tool("snapshot", { session_id });
		expect(refused.isError).toBe(true);
		expect(refused.json.message).toContain("outside the allowed domains");
		expect(refused.json.message).not.toContain("detached");
		expect(pageCalls("goto").at(-1).url).toBe("about:blank");
	});

	it("navigates only inside the allowed domains", async () => {
		const mcp = await connect({}, { allowedDomains: ["*.example.com"] });
		const session_id = await open(mcp);
		const refused = await mcp.tool("navigate", {
			session_id,
			url: "https://example.org/",
		});
		expect(refused.isError).toBe(true);
		expect(refused.json.message).toContain("outside the allowed domains");
		expect(
			(
				await mcp.tool("navigate", {
					session_id,
					url: "https://www.example.com/",
				})
			).isError,
		).toBe(false);
		expect(pageCalls("goto").map((c) => c.url)).toEqual([
			"https://www.example.com/",
		]);
	});

	it("navigates to web pages only", async () => {
		const mcp = await connect();
		const session_id = await open(mcp);
		for (const url of ["file:///etc/passwd", "about:config", "data:,x"]) {
			const refused = await mcp.tool("navigate", { session_id, url });
			expect(refused.isError).toBe(true);
			expect(refused.text).toContain("navigate takes an http or https URL");
		}
		expect(pageCalls("goto")).toEqual([]);
	});

	it("refuses an unknown session and a failed action without dropping the session", async () => {
		const mcp = await connect();
		const unknown = await mcp.tool("snapshot", { session_id: "nope" });
		expect(unknown.isError).toBe(true);
		expect(unknown.json.message).toContain("No open session nope");

		const session_id = await open(mcp);
		const stale = await mcp.tool("click", { session_id, ref: "gone" });
		expect(stale.isError).toBe(true);
		expect(stale.json.message).toContain("stale ref");
		expect((await mcp.tool("snapshot", { session_id })).isError).toBe(false);
	});

	it("refuses a launch that fails", async () => {
		const mcp = await connect({
			NewBrowser: async () => {
				throw new Error("The launch failed");
			},
		});
		const refused = await mcp.tool("session_open");
		expect(refused.isError).toBe(true);
		expect(refused.json.message).toBe("The launch failed");
	});

	it("hands off only a session with a window", async () => {
		const mcp = await connect();
		const headless = await open(mcp);
		const refused = await mcp.tool("hand_off", {
			session_id: headless,
			reason: "Log in",
		});
		expect(refused.isError).toBe(true);
		expect(refused.json.message).toContain("visible: true");

		const visible = await open(mcp, { visible: true });
		const handed = await mcp.tool("hand_off", {
			session_id: visible,
			reason: "Log in",
		});
		expect(handed.json).toEqual({ handed_off: true, reason: "Log in" });
		expect(pageCalls("bringToFront")).toHaveLength(1);
	});

	it("forgets a session that was closed or whose browser went away", async () => {
		const mcp = await connect();
		const closed = await open(mcp);
		expect(
			(await mcp.tool("session_close", { session_id: closed })).json,
		).toEqual({
			closed: true,
		});
		expect(pageCalls("close")).toHaveLength(1);
		expect((await mcp.tool("snapshot", { session_id: closed })).isError).toBe(
			true,
		);

		const crashed = await open(mcp);
		mcp.launched[1].crash();
		expect((await mcp.tool("snapshot", { session_id: crashed })).isError).toBe(
			true,
		);
	});

	it("launches passthrough only on a launcher that takes it, and with no os", async () => {
		const refused = await connect();
		const old = await refused.tool("session_open", { passthrough: true });
		expect(old.isError).toBe(true);
		expect(old.json.message).toContain("does not take passthrough");
		expect(pageCalls("launch")).toEqual([]);
		await client?.close();

		const mcp = await connect({ PASSTHROUGH: true });
		const withOs = await mcp.tool("session_open", {
			passthrough: true,
			os: "windows",
		});
		expect(withOs.isError).toBe(true);
		expect(withOs.json.message).toContain("takes no `os`");
		await open(mcp, { passthrough: true });
		expect(pageCalls("launch")[0].options).toEqual({
			headless: true,
			humanize: true,
			passthrough: true,
		});
	});

	/** A Firefox profile as a running browser leaves it: locked, with a cache. */
	function makeProfile(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "camoucore-mcp-test-"));
		fs.writeFileSync(path.join(dir, "prefs.js"), "// prefs\n");
		fs.writeFileSync(path.join(dir, "cookies.sqlite"), "cookies");
		fs.writeFileSync(path.join(dir, "lock"), "");
		fs.writeFileSync(path.join(dir, ".parentlock"), "");
		fs.mkdirSync(path.join(dir, "cache2"));
		fs.writeFileSync(path.join(dir, "cache2", "entry"), "cached");
		return dir;
	}

	it("offers profile only when one is configured", async () => {
		// session_open's arguments, on the client connected last.
		const schemaOf = async () => {
			const { tools } = await (client as Client).listTools();
			return Object.keys(
				tools.find((tool) => tool.name === "session_open")?.inputSchema
					.properties ?? {},
			);
		};
		const without = await connect();
		expect(await schemaOf()).not.toContain("profile");
		// An unknown argument is dropped by the schema, so nothing runs on a profile.
		await open(without, { profile: true });
		expect(pageCalls("launch")[0].options.user_data_dir).toBeUndefined();
		await client?.close();

		await connect({}, { profile: makeProfile() });
		expect(await schemaOf()).toContain("profile");
	});

	it("runs a session on a private copy of the profile, removed at close", async () => {
		const profile = makeProfile();
		const mcp = await connect({}, { profile });
		const session_id = await open(mcp, { profile: true, visible: true });
		const { options } = pageCalls("launch")[0];
		expect(options.persistent_context).toBe(true);
		const copy: string = options.user_data_dir;
		expect(copy).not.toBe(profile);
		expect(fs.statSync(copy).mode & 0o077).toBe(0);
		expect(fs.readdirSync(copy).sort()).toEqual(["cookies.sqlite", "prefs.js"]);
		// The persistent context's own tab is the one the tools act on.
		expect((await mcp.tool("snapshot", { session_id })).isError).toBe(false);

		await mcp.tool("session_close", { session_id });
		expect(fs.existsSync(copy)).toBe(false);
		expect(fs.readdirSync(profile).sort()).toEqual([
			".parentlock",
			"cache2",
			"cookies.sqlite",
			"lock",
			"prefs.js",
		]);
	});

	it("removes the profile copy when the browser goes away", async () => {
		const mcp = await connect({}, { profile: makeProfile() });
		const session_id = await open(mcp, { profile: true });
		const copy: string = pageCalls("launch")[0].options.user_data_dir;
		mcp.launched[0].crash();
		await expect.poll(() => fs.existsSync(copy)).toBe(false);
		expect((await mcp.tool("snapshot", { session_id })).isError).toBe(true);
	});

	it("keeps serving when a profile copy cannot be removed", async () => {
		const mcp = await connect({}, { profile: makeProfile() });
		const session_id = await open(mcp, { profile: true });
		const copy: string = pageCalls("launch")[0].options.user_data_dir;
		// Regression: removal ran synchronously in the browser's close event and
		// threw (ENOTEMPTY in a real run), which ended the server process.
		fs.chmodSync(copy, 0o500);
		try {
			mcp.launched[0].crash();
			await new Promise((resolve) => setTimeout(resolve, 1500));
			expect((await mcp.tool("snapshot", { session_id })).isError).toBe(true);
			expect((await mcp.tool("session_open")).isError).toBe(false);
		} finally {
			fs.chmodSync(copy, 0o700);
			fs.rmSync(copy, { recursive: true, force: true });
		}
	});

	it("refuses a profile that is not the engine's, and a failed launch keeps no copy", async () => {
		const chromium = fs.mkdtempSync(
			path.join(os.tmpdir(), "camoucore-mcp-test-"),
		);
		fs.writeFileSync(path.join(chromium, "Local State"), "{}");
		const wrong = await connect({}, { profile: chromium });
		const refused = await wrong.tool("session_open", { profile: true });
		expect(refused.isError).toBe(true);
		expect(refused.json.message).toContain("has no prefs.js");
		expect(pageCalls("launch")).toEqual([]);
		await client?.close();

		const before = new Set(fs.readdirSync(os.tmpdir()));
		const failing = await connect(
			{
				NewBrowser: async () => {
					throw new Error("no browser installed");
				},
			},
			{ profile: makeProfile() },
		);
		expect(
			(await failing.tool("session_open", { profile: true })).isError,
		).toBe(true);
		const left = fs
			.readdirSync(os.tmpdir())
			.filter(
				(name) =>
					!before.has(name) && name.startsWith("camoucore-mcp-profile-"),
			);
		expect(left).toEqual([]);
	});
});
