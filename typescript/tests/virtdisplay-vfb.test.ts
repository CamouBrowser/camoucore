/**
 * The vfb path of virtdisplay: what headless="virtual" runs on macOS and
 * Windows.
 *
 * A fake vfb that speaks vfb's protocol -- the display (and, with -report
 * geometry, its desktop rectangle) on the -displayfd fd, exit when stdin
 * closes -- stands in for the real one, so the launch, report and stop logic
 * is tested on any POSIX runner with OS_NAME mocked. Mirrors
 * python/tests/test_virtdisplay_vfb.py.
 */

import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CannotExecuteVfb, CannotFindVfb } from "../src/exceptions.js";
import { PRODUCT } from "./launcher.js";

const host = vi.hoisted(() => ({ os: "mac" as "mac" | "win" }));
vi.mock("../src/host.js", async (original) => {
	const real = await original<typeof import("../src/host.js")>();
	return {
		...real,
		get OS_NAME() {
			return host.os;
		},
	};
});

const { VFB_KEY, VirtualDisplay } = await import("../src/virtdisplay.js");

const VFB_ENV_VAR = PRODUCT.envVar(VFB_KEY);

function fake(dir: string, report = "7 -1440 0 1440 900 2\n"): string {
	const log = path.join(dir, "log.jsonl");
	const file = path.join(dir, "vfb");
	fs.writeFileSync(
		file,
		`#!${process.execPath}
const fs = require("node:fs");
const argv = process.argv.slice(2);
const note = (k) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(k) + "\\n");
note({ argv });
const fd = Number(argv[argv.indexOf("-displayfd") + 1]);
fs.writeSync(fd, ${JSON.stringify(report)});
if (fd !== 1) fs.closeSync(fd);
process.stdin.resume();
process.stdin.on("end", () => { note({ stopped: "stdin closed" }); process.exit(0); });
`,
	);
	fs.chmodSync(file, 0o755);
	return file;
}

function readLog(dir: string): Record<string, unknown>[] {
	return fs
		.readFileSync(path.join(dir, "log.jsonl"), "utf-8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

function exited(proc: ChildProcess, timeoutMs: number): Promise<number | null> {
	return new Promise((resolve) => {
		if (proc.exitCode !== null) return resolve(proc.exitCode);
		const timer = setTimeout(() => resolve(null), timeoutMs);
		proc.once("exit", (code) => {
			clearTimeout(timer);
			resolve(code);
		});
	});
}

describe.skipIf(process.platform === "win32").each(["mac", "win"] as const)(
	"vfb on %s",
	(os_) => {
		let dir: string;
		const started: InstanceType<typeof VirtualDisplay>[] = [];
		const track = (vd: InstanceType<typeof VirtualDisplay>) => {
			started.push(vd);
			return vd;
		};

		beforeEach(() => {
			host.os = os_;
			dir = fs.mkdtempSync(path.join(os.tmpdir(), "camoucore-vfb-"));
			process.env[VFB_ENV_VAR] = fake(dir);
		});
		afterEach(() => {
			for (const vd of started.splice(0)) vd.kill();
			delete process.env[VFB_ENV_VAR];
			fs.rmSync(dir, { recursive: true, force: true });
		});

		it("reports the display and where it sits", async () => {
			const vd = track(new VirtualDisplay(PRODUCT));
			expect(await vd.get()).toBe(":7");
			expect(vd.bounds).toEqual([-1440, 0, 1440, 900]);
			const argv = readLog(dir)[0].argv as string[];
			const fd = argv[argv.indexOf("-displayfd") + 1];
			// Windows children inherit no extra fd: vfb reports on stdout there.
			if (os_ === "win") expect(fd).toBe("1");
			else expect(["0", "1", "2"]).not.toContain(fd);
			expect(argv[argv.indexOf("-report") + 1]).toBe("geometry");
			expect(argv).toContain("-eofexit");
			// -eofexit stops vfb when stdin closes, so stdin must stay open while
			// the display is in use: an ignored stdin would end it at once.
			expect(await exited(vd.proc as ChildProcess, 500)).toBeNull();
		});

		it.each([
			"5 3456 0 3456 2160 2\n",
			"5 3456 0 3456 2160 2.5\n",
		])("window fills the monitor in CSS pixels (%s)", async (report) => {
			// Windows reports device pixels and the user's display scaling; a
			// window sized in device pixels came out twice the monitor's width
			// on win-i9.
			process.env[VFB_ENV_VAR] = fake(dir, report);
			const vd = track(new VirtualDisplay(PRODUCT));
			await vd.get();
			const scale = Number(report.split(" ")[5]);
			expect(vd.scale).toBe(scale);
			if (os_ === "win") {
				expect(vd.window).toEqual([
					3456,
					0,
					Math.round(3456 / scale),
					Math.round(2160 / scale),
				]);
			} else {
				expect(vd.window).toEqual(vd.bounds);
			}
		});

		it("a vfb that reports a bad scale fails", async () => {
			process.env[VFB_ENV_VAR] = fake(dir, "5 0 0 3456 2160 0\n");
			const vd = new VirtualDisplay(PRODUCT);
			await expect(vd.get()).rejects.toThrow(CannotExecuteVfb);
			expect(vd.proc).toBeNull();
		});

		function dying(stderr: string): string {
			const file = path.join(dir, "vfb-dies");
			fs.writeFileSync(
				file,
				`#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(stderr)});\nprocess.exitCode = 1;\n`,
			);
			fs.chmodSync(file, 0o755);
			return file;
		}

		it("a vfb that fails to start says why", async () => {
			// vfb explains a failure on stderr (no free monitor, a mode the driver
			// lacks); the error has to carry that, not just "did not report".
			const why =
				"vfb: all 1 virtual monitors are in use; raise <monitors><count>";
			process.env[VFB_ENV_VAR] = dying(`${why}\n`);
			const vd = new VirtualDisplay(PRODUCT);
			await expect(vd.get()).rejects.toThrow(/raise <monitors><count>/);
			expect(vd.proc).toBeNull();
		});

		it("a vfb that exits silently gives its exit code", async () => {
			process.env[VFB_ENV_VAR] = dying("");
			const vd = new VirtualDisplay(PRODUCT);
			const error = await vd.get().catch((e) => e);
			expect(error).toBeInstanceOf(CannotExecuteVfb);
			expect(String(error.message)).toContain("exit=1");
			expect(vd.proc).toBeNull();
		});

		it("kill() lets vfb stop itself so it can detach its monitor", async () => {
			// A killed vfb on Windows leaves its monitor attached to the desktop,
			// so kill() closes stdin rather than sending a signal.
			const vd = new VirtualDisplay(PRODUCT);
			await vd.get();
			const proc = vd.proc as ChildProcess;
			vd.kill();
			expect(vd.proc).toBeNull();
			expect(await exited(proc, 5000)).toBe(0);
			expect(readLog(dir).at(-1)).toEqual({ stopped: "stdin closed" });
		});

		it("starts at a monitor size, not the engine's tiny root", () => {
			expect(new VirtualDisplay(PRODUCT).screen).toBe("1920x1080x24");
		});

		it("fit() sizes the monitor", async () => {
			const vd = track(new VirtualDisplay(PRODUCT));
			vd.fit(2880, 1800, 2);
			await vd.get();
			const argv = readLog(dir)[0].argv as string[];
			const screen = argv[argv.indexOf("-screen") + 2];
			if (os_ === "mac") {
				// A HiDPI mode: points, backed by 2x pixels.
				expect(screen).toBe("1440x900");
				expect(argv[argv.indexOf("-scale") + 1]).toBe("2");
			} else {
				expect(screen).toBe("2880x1800");
				expect(argv).not.toContain("-scale");
			}
		});

		it("a missing vfb says how to get one", async () => {
			process.env[VFB_ENV_VAR] = path.join(dir, "nowhere");
			const vd = new VirtualDisplay(PRODUCT);
			await expect(vd.get()).rejects.toThrow(CannotFindVfb);
			await expect(vd.get()).rejects.toThrow(VFB_ENV_VAR);
		});

		it("a vfb that reports junk fails and is stopped", async () => {
			process.env[VFB_ENV_VAR] = fake(dir, "oops\n");
			const vd = new VirtualDisplay(PRODUCT);
			await expect(vd.get()).rejects.toThrow(CannotExecuteVfb);
			expect(vd.proc).toBeNull();
		});
	},
);
