/**
 * The built server driving a real launcher's browser, humanized, on local
 * pages: a form, and a login whose secret is typed, redacted and kept on its
 * domain. CAMOUCORE_MCP_LAUNCHER names the launcher package (camouwolf in CI),
 * whose browser must be installed.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prerequisite } from "../../typescript/tests/prereq.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = process.env.CAMOUCORE_MCP_LAUNCHER ?? "";

const PASSWORD = "correct-horse-battery";

/** The pages by path; `{other}` is this server's origin under another host name. */
const PAGES: Record<string, string> = {
	"/": `<!doctype html><title>Form</title>
<label>Name <input id="name"></label>
<label>PIN <input type="password"></label>
<button onclick="document.querySelector('p').textContent = 'Hello ' + document.getElementById('name').value">Greet</button>
<p>Nobody yet</p>`,
	"/login": `<!doctype html><title>Log in</title>
<label>Password <input id="password" type="password"></label>
<button onclick="document.querySelector('p').textContent = 'You typed ' + document.getElementById('password').value">Show</button>
<p>Nothing typed</p>
<iframe src="{other}/frame"></iframe>
<a href="{other}/">Elsewhere</a>`,
	"/frame": `<!doctype html><label>Card password <input type="password"></label>`,
	// One file input as itself, and one behind a button, as most sites style it.
	"/upload": `<!doctype html><title>Upload</title>
<nav><a href="#">Home</a><a href="#">Help</a></nav>
<form aria-label="Documents">
<label>Letter <input type="file" id="letter"></label>
<input type="file" id="hidden" hidden>
<button type="button" onclick="document.getElementById('hidden').click()">Choose invoice</button>
<button type="button" onclick="document.querySelector('output').textContent = [...document.querySelectorAll('input[type=file]')].map((input) => input.files[0]?.name ?? 'none').join(', ')">Check</button>
<output>Nothing chosen</output>
</form>`,
};

describe.runIf(
	prerequisite(
		"CAMOUCORE_MCP_LAUNCHER",
		Boolean(LAUNCHER),
		"the launcher package to drive, with its browser installed",
	),
)(`camoucore-mcp on ${LAUNCHER}`, () => {
	let site: http.Server;
	let url: string;
	let client: Client;
	let uploads: string;

	beforeAll(async () => {
		site = http.createServer((request, response) => {
			const port = (site.address() as AddressInfo).port;
			response.setHeader("Content-Type", "text/html");
			response.end(
				(PAGES[request.url ?? ""] ?? "").replaceAll(
					"{other}",
					`http://localhost:${port}`,
				),
			);
		});
		await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
		const origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
		url = `${origin}/`;
		// The secret and the allowed domain are this origin; localhost, the
		// same server under another name, is outside both.
		const secrets = path.join(
			fs.mkdtempSync(path.join(os.tmpdir(), "camoucore-mcp-")),
			"secrets.json",
		);
		fs.writeFileSync(
			secrets,
			JSON.stringify({ [origin]: { password: PASSWORD } }),
			{
				mode: 0o600,
			},
		);
		uploads = fs.mkdtempSync(path.join(os.tmpdir(), "camoucore-mcp-uploads-"));
		fs.writeFileSync(path.join(uploads, "letter.pdf"), "%PDF-1.4");
		fs.writeFileSync(path.join(uploads, "invoice.pdf"), "%PDF-1.4");
		client = new Client({ name: "test", version: "1.0.0" });
		await client.connect(
			new StdioClientTransport({
				command: process.execPath,
				args: [
					path.join(HERE, "..", "dist", "cli.js"),
					LAUNCHER,
					"--secrets",
					secrets,
					"--allowed-domains",
					origin,
					"--uploads",
					uploads,
				],
				env: process.env as Record<string, string>,
				stderr: "inherit",
			}),
		);
	});

	afterAll(async () => {
		await client?.close();
		site?.close();
		if (uploads) fs.rmSync(uploads, { recursive: true, force: true });
	});

	const call = async (name: string, args: Record<string, unknown> = {}) => {
		const raw: any = await client.callTool(
			{ name, arguments: args },
			undefined,
			{ timeout: 120_000 },
		);
		const text: string = raw.content[0].text;
		expect(text).not.toContain(PASSWORD);
		return { isError: Boolean(raw.isError), json: JSON.parse(text) };
	};
	const tool = async (name: string, args: Record<string, unknown> = {}) => {
		const { isError, json } = await call(name, args);
		expect(isError, JSON.stringify(json)).toBe(false);
		return json;
	};
	const refusal = async (name: string, args: Record<string, unknown>) => {
		const { isError, json } = await call(name, args);
		expect(isError, JSON.stringify(json)).toBe(true);
		return json.message as string;
	};

	/** The ref the latest snapshot gives the line containing `label`. */
	const refOf = (snapshot: string, label: string) => {
		const line = snapshot.split("\n").find((l) => l.includes(label));
		const ref = line?.match(/\[ref=((?:f\d+)?e\d+)\]/)?.[1];
		expect(ref, `${label} in\n${snapshot}`).toBeDefined();
		return ref as string;
	};

	it("fills a form and clicks by ref", async () => {
		const { session_id } = await tool("session_open");
		expect((await tool("navigate", { session_id, url })).status).toBe(200);

		let { snapshot } = await tool("snapshot", { session_id });
		await tool("type", {
			session_id,
			ref: refOf(snapshot, 'textbox "Name"'),
			text: "Ada",
		});
		await tool("click", { session_id, ref: refOf(snapshot, 'button "Greet"') });
		// As a person would during a hand_off: a password no secret configures.
		await tool("type", {
			session_id,
			ref: refOf(snapshot, 'textbox "PIN"'),
			text: "typed-by-hand",
		});

		({ snapshot } = await tool("snapshot", { session_id }));
		expect(snapshot).toContain("Hello Ada");
		expect(
			snapshot.split("\n").find((l) => l.includes('textbox "PIN"')),
		).toMatch(/: <hidden password>$/);
		expect(snapshot).not.toContain("typed-by-hand");
		expect(await tool("session_close", { session_id })).toEqual({
			closed: true,
		});
	});

	it("reads one part of the page, and acts on the refs it gives", async () => {
		const { session_id } = await tool("session_open");
		await tool("navigate", { session_id, url: `${url}upload` });

		const whole = (await tool("snapshot", { session_id })).snapshot as string;
		const formRef = refOf(whole, 'form "Documents"');
		const found = (await tool("snapshot", { session_id, find: "choose" }))
			.snapshot as string;
		expect(found).toContain('button "Choose invoice"');
		expect(found).not.toContain("Help");

		const form = (await tool("snapshot", { session_id, ref: formRef }))
			.snapshot as string;
		expect(form).toContain('button "Check"');
		expect(form).not.toContain('link "Help"');
		expect(form.length).toBeLessThan(whole.length);

		// A file input itself, and a button that opens a picker.
		expect(
			await tool("upload_file", {
				session_id,
				ref: refOf(form, 'button "Letter"'),
				files: ["letter.pdf"],
			}),
		).toMatchObject({ uploaded: ["letter.pdf"] });
		await tool("upload_file", {
			session_id,
			ref: refOf(form, 'button "Choose invoice"'),
			files: ["invoice.pdf"],
		});
		await tool("click", { session_id, ref: refOf(form, 'button "Check"') });
		const result = (await tool("snapshot", { session_id, find: ".pdf" }))
			.snapshot as string;
		expect(result).toContain("letter.pdf, invoice.pdf");

		expect(
			await refusal("upload_file", {
				session_id,
				ref: refOf(form, 'button "Letter"'),
				files: ["../secrets.json"],
			}),
		).toContain("outside the uploads directory");
		await tool("session_close", { session_id });
	});

	it("types a secret only on its domain and never shows it", async () => {
		const { session_id } = await tool("session_open");
		await tool("navigate", { session_id, url: `${url}login` });
		const login = await tool("snapshot", { session_id });
		expect(login.secrets_here).toEqual(["password"]);
		let snapshot: string = login.snapshot;

		// The iframe is another origin: the page's URL matches, its frame's does not.
		expect(
			await refusal("type_secret", {
				session_id,
				ref: refOf(snapshot, 'textbox "Card password"'),
				name: "password",
			}),
		).toContain("this field's frame is at http://localhost:");

		await tool("type_secret", {
			session_id,
			ref: refOf(snapshot, 'textbox "Password"'),
			name: "password",
		});
		await tool("click", { session_id, ref: refOf(snapshot, 'button "Show"') });
		({ snapshot } = await tool("snapshot", { session_id }));
		expect(snapshot).toContain("You typed <secret:password>");
		expect(await refusal("screenshot", { session_id })).toContain(
			"holds a secret",
		);

		// A link off the allowed domain is refused, on the click or on the call
		// after it, whichever its navigation commits before; no call shows it.
		const results = [
			await call("click", {
				session_id,
				ref: refOf(snapshot, 'link "Elsewhere"'),
			}),
		];
		while (results.every(({ isError }) => !isError)) {
			results.push(await call("snapshot", { session_id }));
		}
		const refused = results.at(-1)?.json;
		expect(refused.message).toContain("outside the allowed domains");
		expect(JSON.stringify(results)).not.toContain('"url": "http://localhost');
		expect((await tool("snapshot", { session_id })).url).toBe("about:blank");
		await tool("session_close", { session_id });
	});
});
