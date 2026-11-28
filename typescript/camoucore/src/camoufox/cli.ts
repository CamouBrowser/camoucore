#!/usr/bin/env node
/**
 * The `camoufox` command, the bin of the browser repository's `camoufox` package
 * (RELEASING.md, "The wrapper packages"). `camoufox mcp ...` serves the browser
 * over MCP; everything else is the CLI in __main__.ts.
 */
// First: fail with the Node.js floor before any module needs it.
import "./node-floor.js";

if (process.argv[2] === "mcp") {
	// Imported only here, and before the launcher: the server takes stdout for
	// the protocol before anything the launcher loads can print to it.
	const { serve } = await import("../mcp/cli.js");
	await serve(process.argv.slice(3), {
		launcher: new URL("./index.js", import.meta.url).href,
		program: "camoufox mcp",
	});
} else {
	await import("./__main__.js");
}
