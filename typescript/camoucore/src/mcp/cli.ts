#!/usr/bin/env node
/** camoucore-mcp <launcher>: serve a launcher's browser over MCP on stdio. */
import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { Secrets } from "./secrets.js";
import { createServer, loadLauncher } from "./server.js";

// stdout is the protocol, and launchers print to it, so everything but the
// transport goes to stderr. This comes before the launcher is imported, since
// importing it can print too.
const protocolWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(
	process.stderr,
) as typeof process.stdout.write;
const protocolStream = new Writable({
	write: (chunk, encoding, done) => void protocolWrite(chunk, encoding, done),
});

const USAGE =
	"usage: camoucore-mcp <launcher> [--secrets <file>] [--allowed-domains <pattern,...>] [--profile <dir>] [--uploads <dir>]\n" +
	"  <launcher>  the launcher package to drive: camoucore-camoufox or camoucore-camouwolf\n" +
	"  --profile   your own browser profile, which session_open { profile: true } runs a copy of\n" +
	"  --uploads   the one directory upload_file may attach files from";
let parsed: ReturnType<typeof parse>;
function parse() {
	return parseArgs({
		allowPositionals: true,
		options: {
			secrets: { type: "string" },
			"allowed-domains": { type: "string" },
			profile: { type: "string" },
			uploads: { type: "string" },
		},
	});
}
try {
	parsed = parse();
} catch (error) {
	console.error(`${(error as Error).message}\n${USAGE}`);
	process.exit(2);
}
const [specifier] = parsed.positionals;
if (!specifier || parsed.positionals.length > 1) {
	console.error(USAGE);
	process.exit(2);
}
// Read before anything launches, so a bad file stops the server at start.
const secrets = parsed.values.secrets
	? Secrets.load(parsed.values.secrets)
	: undefined;
const profile = parsed.values.profile
	? path.resolve(parsed.values.profile)
	: undefined;
if (
	profile &&
	!fs.statSync(profile, { throwIfNoEntry: false })?.isDirectory()
) {
	console.error(`--profile ${profile} is not a directory.`);
	process.exit(2);
}
const uploads = parsed.values.uploads
	? path.resolve(parsed.values.uploads)
	: undefined;
if (
	uploads &&
	!fs.statSync(uploads, { throwIfNoEntry: false })?.isDirectory()
) {
	console.error(`--uploads ${uploads} is not a directory.`);
	process.exit(2);
}
const allowedDomains = parsed.values["allowed-domains"]
	?.split(",")
	.map((pattern) => pattern.trim())
	.filter(Boolean);

const { launcher, browserType } = await loadLauncher(specifier);
const { server, closeAll } = createServer(launcher, browserType, {
	secrets,
	allowedDomains,
	profile,
	uploads,
});

/** A client going away must not leave its browsers running. */
let shuttingDown = false;
async function shutdown(): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	await closeAll();
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport(process.stdin, protocolStream));
