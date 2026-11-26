/** The built server as a client runs it: spawned, speaking MCP on stdio. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "dist", "cli.js");

let client: Client | undefined;
afterEach(async () => {
	await client?.close();
});

describe("camoucore-mcp", () => {
	it("keeps the launcher's output off the protocol and launches its engine", async () => {
		const log = path.join(
			fs.mkdtempSync(path.join(os.tmpdir(), "camoucore-mcp-")),
			"calls.log",
		);
		client = new Client({ name: "test", version: "1.0.0" });
		const protocolErrors: Error[] = [];
		client.onerror = (error) => protocolErrors.push(error);
		await client.connect(
			new StdioClientTransport({
				command: process.execPath,
				args: [CLI, path.join(HERE, "fake-launcher.mjs")],
				env: { PATH: process.env.PATH ?? "", FAKE_LAUNCHER_LOG: log },
				stderr: "ignore",
			}),
		);
		const opened: any = await client.callTool({
			name: "session_open",
			arguments: {},
		});
		expect(opened.isError).toBeFalsy();
		expect(protocolErrors).toEqual([]);
		// The browser type comes from the Playwright the launcher resolves.
		const launch = JSON.parse(fs.readFileSync(log, "utf8").split("\n")[0]);
		expect(launch.engine).toBe("firefox");
	});

	it("refuses a package that is not a launcher, a missing profile, and no package at all", () => {
		const notLauncher = spawnSync(process.execPath, [CLI, "zod"], {
			encoding: "utf8",
		});
		expect(notLauncher.status).not.toBe(0);
		expect(notLauncher.stderr).toContain(
			"zod does not export PRODUCT and NewBrowser",
		);

		const noProfile = spawnSync(
			process.execPath,
			[CLI, "zod", "--profile", path.join(HERE, "no-such-profile")],
			{ encoding: "utf8" },
		);
		expect(noProfile.status).toBe(2);
		expect(noProfile.stderr).toContain("no-such-profile is not a directory");

		const noUploads = spawnSync(
			process.execPath,
			[CLI, "zod", "--uploads", path.join(HERE, "no-such-uploads")],
			{ encoding: "utf8" },
		);
		expect(noUploads.status).toBe(2);
		expect(noUploads.stderr).toContain("no-such-uploads is not a directory");

		const none = spawnSync(process.execPath, [CLI], { encoding: "utf8" });
		expect(none.status).toBe(2);
		expect(none.stderr).toContain("usage: camoucore-mcp <launcher>");
	});
});
