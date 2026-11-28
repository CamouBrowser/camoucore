#!/usr/bin/env node
/**
 * `node dist/mcp/main.js <launcher> [options]`: the MCP server for any
 * launcher module, named on the command line. Users run it through their
 * launcher instead (`npx camoufox mcp`).
 */
import { serve } from "./cli.js";

await serve(process.argv.slice(2));
