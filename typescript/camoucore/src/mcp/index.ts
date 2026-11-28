/**
 * camoucore/mcp: an MCP server that drives a launcher's browser. serve() is
 * the stdio server as each launcher's `mcp` command runs it; createServer()
 * and loadLauncher() build one for a transport of your own.
 */
export { type ServeOptions, serve } from "./cli.js";
export { Secrets } from "./secrets.js";
export {
	createServer,
	type Launcher,
	loadLauncher,
	type ServerOptions,
} from "./server.js";
