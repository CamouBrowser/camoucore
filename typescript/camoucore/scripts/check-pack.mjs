#!/usr/bin/env node
/**
 * The npm twin of `twine check`: prove the tarball `npm publish` would upload is
 * a working package before it goes anywhere.
 *
 *   1. its version equals the Python package's (one release, so a user
 *      comparing `camoufox version` across the two drivers sees one number);
 *   2. it carries every file src/ reads at runtime -- the core's and each
 *      launcher's DATA_FILES, taken from python/camoucore/src/camoucore, and
 *      every compiled module -- since a missing file only shows up on a user's
 *      machine, as an ENOENT from inside dist/;
 *   3. packed and installed into an empty project, it imports at each entry
 *      point; and a throwaway wrapper per launcher, built as RELEASING.md's
 *      "The wrapper packages" says, runs its CLI and `<launcher> mcp`, and its
 *      pin wins over camoucore's.
 *
 * Run after `pnpm build`: node scripts/check-pack.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { LAUNCHERS } from "./launchers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const problems = [];

// 1. version lockstep with the Python package
const pyproject = readFileSync(
	join(root, "..", "..", "python", "camoucore", "pyproject.toml"),
	"utf8",
);
const pyVersion = pyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
// One release, spelled for each registry: npm's 0.5.8-beta.2 is PyPI's 0.5.8b2.
const asPep440 = (v) => v.replace(/-beta\.(\d+)$/, "b$1");
if (pyVersion !== asPep440(pkg.version)) {
	problems.push(
		`package.json version ${pkg.version} != python/camoucore/pyproject.toml ${pyVersion}`,
	);
}
if (pkg.private)
	problems.push("package.json is private: npm will refuse to publish it");
if (JSON.stringify(pkg).includes('"workspace:'))
	problems.push("package.json has a workspace: dependency");

// 2. every runtime file is in the tarball
// npm 10 still runs `prepare` (the build) on pack despite --ignore-scripts, and
// its banner lands on stdout ahead of the JSON.
const packOut = execFileSync(
	"npm",
	["pack", "--dry-run", "--json", "--ignore-scripts"],
	{ cwd: root, encoding: "utf8" },
);
const packed = JSON.parse(packOut.slice(packOut.search(/^\[/m)))[0];
const inTarball = new Set(packed.files.map((f) => f.path));
function walk(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
	);
}
const src = join(root, "src");
for (const file of walk(src)) {
	const rel = relative(src, file);
	if (/\.ts$/.test(rel)) {
		const js = `dist/${rel.replace(/\.ts$/, ".js")}`;
		if (!rel.endsWith(".d.ts") && !inTarball.has(js))
			problems.push(`missing ${js}`);
	} else if (!inTarball.has(`dist/${rel}`)) {
		problems.push(
			`missing dist/${rel} (a non-TS file under src/ that copy-files does not ship)`,
		);
	}
}
const dataFiles = [["data.js", "dist/data-files"]].concat(
	LAUNCHERS.map((l) => [`${l}/paths.js`, `dist/${l}/data-files`]),
);
for (const [module, dir] of dataFiles) {
	const { DATA_FILES } = await import(join(root, "dist", module));
	for (const name of DATA_FILES) {
		if (!inTarball.has(`${dir}/${name}`))
			problems.push(`missing ${dir}/${name}`);
	}
}
console.log(
	`${packed.filename}: ${packed.entryCount} files, ${(packed.size / 1e6).toFixed(1)} MB packed`,
);

/** A wrapper as a browser repository publishes it (RELEASING.md). */
function writeWrapper(dir, launcher, pin) {
	mkdirSync(join(dir, `${launcher}_pin`), { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: launcher,
			version: "0.0.0-wrapper-check",
			type: "module",
			exports: {
				".": "./index.js",
				[`./${launcher}_pin/browser-pin.json`]: `./${launcher}_pin/browser-pin.json`,
			},
			bin: { [launcher]: "cli.js" },
			dependencies: { camoucore: pkg.version },
			peerDependencies: {
				"playwright-core": pkg.peerDependencies["playwright-core"],
			},
		}),
	);
	writeFileSync(
		join(dir, "index.js"),
		`export * from "camoucore/${launcher}";\n`,
	);
	writeFileSync(
		join(dir, "cli.js"),
		`#!/usr/bin/env node\nimport "camoucore/${launcher}/cli.js";\n`,
	);
	writeFileSync(
		join(dir, `${launcher}_pin`, "browser-pin.json"),
		JSON.stringify(pin),
	);
}

// 3. installs and imports in a clean project
if (problems.length === 0) {
	const tmp = mkdtempSync(join(tmpdir(), "camoucore-pack-"));
	try {
		// The pnpm running this script, or the one on PATH.
		const pnpm = /\.[cm]?js$/.test(process.env.npm_execpath ?? "")
			? [process.execPath, process.env.npm_execpath]
			: ["pnpm"];
		// pnpm prints the tarball last, as a path or a bare name.
		const out = execFileSync(
			pnpm[0],
			[...pnpm.slice(1), "pack", "--pack-destination", tmp],
			{ cwd: root, encoding: "utf8" },
		);
		const tgz = join(tmp, basename(out.trim().split("\n").pop()));
		const manifest = execFileSync(
			"tar",
			["-xOzf", tgz, "package/package.json"],
			{
				encoding: "utf8",
			},
		);
		if (manifest.includes('"workspace:'))
			throw new Error(`${tgz} still has a workspace: dependency`);

		const pins = {};
		const wrappers = LAUNCHERS.map((launcher) => {
			const dir = join(tmp, "wrappers", launcher);
			pins[launcher] = {
				tag: `v1.0.0-${launcher}-wrapper-check`,
				repo: "wrapper/check",
			};
			writeWrapper(dir, launcher, pins[launcher]);
			const wrapped = execFileSync(
				"npm",
				["pack", "--pack-destination", tmp, "--ignore-scripts"],
				{ cwd: dir, encoding: "utf8" },
			);
			return join(tmp, wrapped.trim().split("\n").pop());
		});

		const project = join(tmp, "project");
		mkdirSync(project);
		writeFileSync(
			join(project, "package.json"),
			'{"name":"pack-check","private":true,"type":"module"}',
		);
		execFileSync(
			"npm",
			[
				"install",
				"--no-audit",
				"--no-fund",
				tgz,
				...wrappers,
				`playwright-core@${pkg.peerDependencies["playwright-core"]}`,
			],
			{ cwd: project, stdio: "inherit" },
		);
		const probe = `
			const core = await import("camoucore");
			if (typeof core.Product !== "function") throw new Error("camoucore: no Product");
			const mcp = await import("camoucore/mcp");
			for (const name of ["serve", "createServer", "loadLauncher"]) {
				if (typeof mcp[name] !== "function") throw new Error("camoucore/mcp: no " + name);
			}
			const pins = ${JSON.stringify(pins)};
			for (const launcher of ${JSON.stringify(LAUNCHERS)}) {
				const impl = await import("camoucore/" + launcher);
				const wrapper = await import(launcher);
				if (typeof impl.NewBrowser !== "function" || !impl.PRODUCT?.engine)
					throw new Error("camoucore/" + launcher + ": not a launcher");
				if (wrapper.NewBrowser !== impl.NewBrowser)
					throw new Error(launcher + ": the wrapper is not the launcher");
				const { loadPin } = await import("camoucore/" + launcher + "/browser-pin.js");
				if (loadPin()?.tag !== pins[launcher].tag)
					throw new Error(launcher + ": the wrapper's pin does not win");
			}
			console.log("entry points OK:", ["camoucore", "camoucore/mcp", ...${JSON.stringify(LAUNCHERS)}].join(", "));
		`;
		execFileSync("node", ["--input-type=module", "-e", probe], {
			cwd: project,
			stdio: "inherit",
		});
		for (const launcher of LAUNCHERS) {
			const bin = join(project, "node_modules", ".bin", launcher);
			const help = spawnSync(bin, ["--help"], {
				cwd: project,
				encoding: "utf8",
			});
			if (help.status !== 0 || !help.stdout.includes("fetch"))
				problems.push(`${launcher} --help failed: ${help.stderr}`);
			// A stray positional: the server refuses with its usage before
			// loading anything, so this needs no browser.
			const mcp = spawnSync(bin, ["mcp", "extra"], {
				cwd: project,
				encoding: "utf8",
			});
			if (mcp.status !== 2 || !mcp.stderr.includes(`usage: ${launcher} mcp`))
				problems.push(
					`${launcher} mcp did not reach the MCP server: ${mcp.stderr}`,
				);
		}
	} catch (err) {
		problems.push(`clean install failed: ${err.message}`);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

if (problems.length) {
	console.error(problems.map((p) => `  - ${p}`).join("\n"));
	process.exit(1);
}
console.log("pack check OK");
