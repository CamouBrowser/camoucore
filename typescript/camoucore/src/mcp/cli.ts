/**
 * The MCP server as a command: serve(argv, options) runs the stdio server
 * for one launcher. Each launcher's bin runs it as `<launcher> mcp`
 * (src/<launcher>/cli.ts); main.ts runs it for any launcher module named on
 * the command line.
 */
import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { Secrets } from "./secrets.js";
import { createServer, loadLauncher } from "./server.js";

export interface ServeOptions {
	/**
	 * The launcher module to drive (a specifier or file URL). Without it the
	 * first positional argument names it.
	 */
	launcher?: string;
	/** The command as the user typed it, for the usage line. */
	program?: string;
}

/**
 * Serve a launcher's browser over MCP on stdio until the client goes away.
 * Bad arguments print the usage and exit 2. Call it before the launcher is
 * imported anywhere: launchers print as they load, and stdout is the protocol.
 */
export async function serve(
	argv: string[],
	options: ServeOptions = {},
): Promise<void> {
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

	const program = options.program ?? "camoucore-mcp";
	const flags =
		"[--secrets <file>] [--allowed-domains <pattern,...>] [--profile <dir>] [--uploads <dir>]";
	const USAGE =
		(options.launcher
			? `usage: ${program} ${flags}\n`
			: `usage: ${program} <launcher> ${flags}\n` +
				"  <launcher>  the launcher module to drive: camoucore/camoufox or camoucore/camouwolf\n") +
		"  --profile   your own browser profile, which session_open { profile: true } runs a copy of\n" +
		"  --uploads   the one directory upload_file may attach files from";
	let parsed: ReturnType<typeof parse>;
	function parse() {
		return parseArgs({
			args: argv,
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
	const positionals = options.launcher
		? [options.launcher, ...parsed.positionals]
		: parsed.positionals;
	const [specifier] = positionals;
	if (!specifier || positionals.length > 1) {
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
}
