/**
 * What camoucore-mcp needs of a launcher package (mcp/src/server.ts, Launcher):
 * PRODUCT and NewBrowser from the package's entry point.
 */
import { describe, expect, it } from "vitest";

import * as camoufox from "../src/index.js";

describe("the package entry point", () => {
	it("exports what camoucore-mcp drives a launcher through", () => {
		expect(camoufox.PRODUCT.name).toBe("camoufox");
		expect(typeof camoufox.NewBrowser).toBe("function");
	});
});
