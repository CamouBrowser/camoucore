/**
 * What the MCP server needs of a launcher (src/mcp/server.ts, Launcher):
 * PRODUCT and NewBrowser from the launcher's entry point.
 */
import { describe, expect, it } from "vitest";

import * as camoufox from "../../src/camoufox/index.js";

describe("the package entry point", () => {
	it("exports what the MCP server drives a launcher through", () => {
		expect(camoufox.PRODUCT.name).toBe("camoufox");
		expect(typeof camoufox.NewBrowser).toBe("function");
	});
});
