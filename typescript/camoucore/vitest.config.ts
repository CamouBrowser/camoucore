import { defineConfig } from "vitest/config";

/**
 * One project per suite, run together by `pnpm test` or alone with
 * `pnpm test:<suite>`. The mcp suite spawns the built server, so it needs
 * `pnpm build` first.
 */
export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "core",
					include: ["tests/core/*.test.ts"],
					testTimeout: 30_000,
					hookTimeout: 30_000,
				},
			},
			{
				test: {
					name: "camoufox",
					include: ["tests/camoufox/**/*.test.ts"],
					// Records the goldens from the Python twin before any test reads them.
					globalSetup: ["tests/camoufox/golden-setup.ts"],
					testTimeout: 30_000,
					hookTimeout: 30_000,
				},
			},
			{
				test: {
					name: "camouwolf",
					include: ["tests/camouwolf/*.test.ts"],
					setupFiles: ["tests/camouwolf/setup.ts"],
					testTimeout: 30_000,
					hookTimeout: 30_000,
				},
			},
			{
				test: {
					name: "mcp",
					include: ["tests/mcp/*.test.ts"],
					testTimeout: 120_000,
					hookTimeout: 120_000,
				},
			},
		],
	},
});
