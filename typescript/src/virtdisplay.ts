/**
 * The display headless="virtual" runs the browser on.
 *
 * Linux uses Xvfb. macOS and Windows have no X server to give each browser a
 * private screen, so they use vfb (github.com/JWriter20/vfb), a small server
 * with Xvfb's command line that adds a real monitor to the logged-in desktop:
 * a CGVirtualDisplay on macOS, a Virtual Display Driver monitor on Windows.
 * The system compositor draws it on the GPU like a physical panel. The browser
 * has to put its window there itself, so on those systems `bounds` says where
 * the monitor sits on the desktop.
 *
 * TypeScript twin of python/src/camoucore/virtdisplay.py.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import {
	CannotExecuteVfb,
	CannotExecuteXvfb,
	CannotFindVfb,
	CannotFindXvfb,
	VirtualDisplayNotSupported,
} from "./exceptions.js";
import { OS_NAME } from "./host.js";
import type { Product } from "./product.js";

/**
 * Safe timeout for Xvfb writing the display num; prevents an infinite hang. A
 * cold first Xvfb on a fresh host took 0.6-8.4 s to report, so 10 s failed
 * launches that would have succeeded.
 */
const DISPLAYFD_READ_TIMEOUT_MS = 30_000;

/**
 * Xvfb's screen for headless="virtual" comes from the engine (Product.engine)
 * until the launcher fits it to the identity. <LAUNCHER>_VIRTUAL_DISPLAY_SIZE=
 * "<width>x<height>[x<depth>]" fixes the size instead, and the identity's
 * screen is then kept within it.
 */
export const SCREEN_KEY = "VIRTUAL_DISPLAY_SIZE";

/**
 * The Composite extension stays disabled (Xvfb's `-extension COMPOSITE`);
 * setting <LAUNCHER>_VIRTUAL_DISPLAY_COMPOSITE to 1 enables it.
 */
export const COMPOSITE_KEY = "VIRTUAL_DISPLAY_COMPOSITE";

/**
 * <LAUNCHER>_VFB_PATH names the vfb binary on macOS and Windows; otherwise it
 * is looked up on PATH.
 */
export const VFB_KEY = "VFB_PATH";

/**
 * The monitor size on macOS and Windows until the launcher fit()s it. A real
 * monitor has to hold the browser's window, so Xvfb's tiny root won't do.
 */
const VFB_DEFAULT_SCREEN = "1920x1080x24";

/** How long kill() lets vfb detach its monitor after stdin closes. */
const VFB_STOP_TIMEOUT_MS = 5_000;

/** Find `name` on PATH, or null. */
function onPath(name: string): string | null {
	try {
		const out = execFileSync(OS_NAME === "win" ? "where" : "which", [name], {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return out.split(/\r?\n/)[0].trim() || null;
	} catch {
		return null;
	}
}

/** Screen geometry for Xvfb's -screen argument. */
function resolveScreen(product: Product): string {
	const value = (product.getenv(SCREEN_KEY) ?? "").trim();
	if (!value) return product.engine.virtualScreen;
	const parts = value.toLowerCase().split("x");
	const valid =
		(parts.length === 2 || parts.length === 3) &&
		parts.every((p) => /^\d+$/.test(p) && Number.parseInt(p, 10) > 0);
	if (!valid) {
		throw new VirtualDisplayNotSupported(
			`${product.envVar(SCREEN_KEY)} must look like '1920x1080' or '1920x1080x24', got '${value}'`,
		);
	}
	if (parts.length === 2) parts.push("24");
	return parts.join("x");
}

export class VirtualDisplay {
	readonly product: Product;
	debug: boolean;
	screen: string;
	/** A size the caller chose; fit() leaves it alone. */
	fixed: boolean;
	composite: boolean;
	/**
	 * Device pixels per point. vfb on macOS makes a HiDPI monitor from it;
	 * Xvfb draws at 1. Once vfb is up it holds the scale vfb reported, which
	 * on Windows is the user's display scaling.
	 */
	scale: number;
	proc: ChildProcess | null = null;
	/** The end of vfb's stderr, for the error when it fails to start. */
	private stderrTail = "";
	protected _display: number | null = null;
	/**
	 * Where vfb's monitor sits on the desktop, as [x, y, width, height] in the
	 * desktop's units (points on macOS, pixels on Windows); null on Linux,
	 * where the display is the browser's alone.
	 */
	bounds: [number, number, number, number] | null = null;
	/** What get() calls the server in its errors. */
	protected serverName = OS_NAME === "lin" ? "Xvfb" : "vfb";

	constructor(
		product: Product,
		debug: boolean = false,
		screen?: string,
		composite?: boolean,
		scale: number = 1,
	) {
		this.product = product;
		this.debug = debug;
		this.fixed = Boolean(screen || (product.getenv(SCREEN_KEY) ?? "").trim());
		this.screen =
			screen ||
			(this.fixed || OS_NAME === "lin"
				? resolveScreen(product)
				: VFB_DEFAULT_SCREEN);
		this.composite =
			composite ??
			["1", "true"].includes((product.getenv(COMPOSITE_KEY) ?? "0").trim());
		this.scale = scale;
	}

	/** The display's width and height in pixels. */
	get size(): [number, number] {
		const [width, height] = this.screen.toLowerCase().split("x");
		return [Number.parseInt(width, 10), Number.parseInt(height, 10)];
	}

	/**
	 * Size a display that is not yet started to `width` x `height` pixels at
	 * `scale` device pixels per point, unless its size was fixed.
	 */
	fit(width: number, height: number, scale: number = 1): void {
		if (this.fixed || this.proc !== null) return;
		const depth = this.screen.toLowerCase().split("x")[2];
		this.screen = `${width}x${height}x${depth}`;
		this.scale = scale;
	}

	get vfbPath(): string {
		const path = (this.product.getenv(VFB_KEY) ?? "").trim() || onPath("vfb");
		if (!path || !fs.existsSync(path) || !fs.statSync(path).isFile()) {
			throw new CannotFindVfb(
				"headless='virtual' on this system needs vfb (https://github.com/JWriter20/vfb): " +
					`put it on PATH or set ${this.product.envVar(VFB_KEY)} to its path.`,
			);
		}
		try {
			fs.accessSync(path, fs.constants.X_OK);
		} catch {
			throw new CannotExecuteVfb(
				`I do not have permission to execute vfb: ${path}`,
			);
		}
		return path;
	}

	get vfbArgs(): string[] {
		const [width, height] = this.size;
		const args = ["-report", "geometry", "-eofexit"];
		if (OS_NAME === "mac" && this.scale >= 1.5) {
			// vfb takes the mode in points and backs it with 2x pixels.
			args.push(
				"-screen",
				"0",
				`${Math.round(width / 2)}x${Math.round(height / 2)}`,
				"-scale",
				"2",
			);
		} else {
			args.push("-screen", "0", `${width}x${height}`);
		}
		return args;
	}

	get xvfbArgs(): string[] {
		return [
			"-screen",
			"0",
			this.screen,
			"-ac",
			"-nolisten",
			"tcp",
			"-extension",
			"RENDER",
			"+extension",
			"GLX",
			this.composite ? "+extension" : "-extension",
			"COMPOSITE",
			"-extension",
			"XVideo",
			"-extension",
			"XVideo-MotionCompensation",
			"-extension",
			"XINERAMA",
			"-fp",
			"built-ins",
			"-nocursor",
			"-br",
		];
	}

	get xvfbPath(): string {
		let resolved: string;
		try {
			resolved = execFileSync("which", ["Xvfb"], {
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			throw new CannotFindXvfb("Please install Xvfb to use headless mode.");
		}
		if (!resolved) {
			throw new CannotFindXvfb("Please install Xvfb to use headless mode.");
		}
		try {
			fs.accessSync(resolved, fs.constants.X_OK);
		} catch {
			throw new CannotExecuteXvfb(
				`I do not have permission to execute Xvfb: ${resolved}`,
			);
		}
		return resolved;
	}

	get setprivPath(): string {
		try {
			return execFileSync("which", ["setpriv"], {
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			throw new CannotFindXvfb(
				"Please install util-linux (for setpriv) to use headless mode.",
			);
		}
	}

	/** The error get() raises when the server fails. */
	protected error(message: string): Error {
		return OS_NAME === "lin"
			? new CannotExecuteXvfb(message)
			: new CannotExecuteVfb(message);
	}

	/**
	 * What execs the server. setpriv's parent-death signal stops Xvfb when this
	 * process dies without reaching kill(), even by SIGKILL; SIGTERM lets Xvfb
	 * remove its own lock and socket. See xvfb-dies-with-its-launcher in
	 * ci/tribal-rules.yml. vfb watches its parent itself.
	 */
	protected wrapper(): string[] {
		if (OS_NAME !== "lin") return [];
		return [this.setprivPath, "--pdeathsig", "TERM"];
	}

	/** The server's argv, less -displayfd, which get() adds. */
	protected command(): string[] {
		if (OS_NAME !== "lin") return [this.vfbPath, ...this.vfbArgs];
		return [this.xvfbPath, ...this.xvfbArgs];
	}

	protected serverEnv(): NodeJS.ProcessEnv {
		if (OS_NAME !== "lin") return process.env;
		return {
			...process.env,
			// Force Mesa software GLX; we don't use the GPU anyway.
			__GLX_VENDOR_LIBRARY_NAME: "mesa",
			LIBGL_ALWAYS_SOFTWARE: "1",
		};
	}

	/** Called once the server has reported its display. */
	protected async ready(): Promise<void> {}

	/**
	 * Spawn the server (if it isn't already running) and return its ":N" display.
	 *
	 * Uses `-displayfd` so the server itself picks a free display number
	 * atomically and reports it back, avoiding userspace races. Python's
	 * `pass_fds` keeps the fd at its parent number; Node's `stdio` array
	 * renumbers extra pipes from 3 upward, so we hand the server fd 3 and read
	 * the pipe at index 3. On Windows a child inherits no extra fd, so vfb
	 * reports on stdout there. vfb runs until its stdin closes (-eofexit), so
	 * it gets a pipe only this process holds.
	 */
	async get(): Promise<string> {
		if (this.proc === null) {
			const win = OS_NAME === "win";
			const [program, ...args] = this.command();
			const fd = win ? "1" : "3";
			const cmd = [...this.wrapper(), program, "-displayfd", fd, ...args];
			if (this.debug) {
				console.log("Starting virtual display:", cmd.join(" "));
			}
			const out = this.debug ? "inherit" : "ignore";
			// Xvfb's stderr is noise; vfb's is a reason (no free monitor, a mode
			// the driver lacks), kept for the error when vfb fails to start.
			const err = this.debug
				? "inherit"
				: OS_NAME === "lin"
					? "ignore"
					: "pipe";
			this.proc = spawn(cmd[0], cmd.slice(1), {
				stdio: win
					? ["pipe", "pipe", err]
					: [OS_NAME === "lin" ? "ignore" : "pipe", out, err, "pipe"],
				// A detached child on Windows gets its own console window.
				detached: !win,
				windowsHide: true,
				env: this.serverEnv(),
			});

			// A spawn that fails after spawn() returns (EACCES, ENOEXEC, a noexec
			// mount) is an 'error' event on the child; with no listener Node
			// treats it as uncaught and exits. readDisplayNumber() turns it into
			// this.error(); this keeps any later one from killing the process.
			this.proc.on("error", () => {});
			this.stderrTail = "";
			this.proc.stderr?.on("data", (chunk: Buffer) => {
				this.stderrTail = (this.stderrTail + chunk.toString()).slice(-2000);
			});

			const displayFd = this.proc.stdio[
				win ? 1 : 3
			] as NodeJS.ReadableStream | null;
			if (!displayFd) {
				this.kill();
				throw this.error(`Could not open ${this.serverName}'s -displayfd pipe`);
			}

			this.report(await this.readDisplayNumber(displayFd));
			await this.ready();
		} else if (this.debug) {
			console.log(`Using virtual display: ${this._display}`);
		}

		return `:${this._display}`;
	}

	/** Take the server's report: "N", or vfb's "N X Y W H SCALE". */
	private report(raw: string): void {
		const fields = raw.trim().split(/\s+/);
		const numbers = fields.map((f) => (/^-?\d+$/.test(f) ? Number(f) : NaN));
		if (
			Number.isNaN(numbers[0]) ||
			(fields.length >= 5 && numbers.slice(1, 5).some(Number.isNaN))
		) {
			this.kill();
			throw this.error(
				`${this.serverName} wrote non-integer display: '${raw}'`,
			);
		}
		this._display = numbers[0];
		if (fields.length >= 5) {
			const [x, y, width, height] = numbers.slice(1, 5);
			this.bounds = [x, y, width, height];
		}
		if (fields.length >= 6) {
			const scale = Number(fields[5]);
			if (!(scale > 0)) {
				this.kill();
				throw this.error(`${this.serverName} wrote a bad scale: '${raw}'`);
			}
			// The scale the system gave the monitor, which on Windows is the
			// user's display scaling, not one vfb chose.
			this.scale = scale;
		}
	}

	/**
	 * Where a browser window that fills the monitor goes, as [x, y, width,
	 * height]: the position in desktop units and the size in the browser's
	 * CSS pixels. macOS desktop points are already CSS pixels; Windows desktop
	 * units are device pixels, so the size there is divided by the monitor's
	 * scale. null on Linux.
	 */
	get window(): [number, number, number, number] | null {
		if (this.bounds === null) return null;
		const [x, y, width, height] = this.bounds;
		if (OS_NAME === "win") {
			return [
				x,
				y,
				Math.round(width / this.scale),
				Math.round(height / this.scale),
			];
		}
		return this.bounds;
	}

	/** Stop the server that exited without a report, and say why. */
	private async noReport(got: string): Promise<string> {
		const proc = this.proc;
		const running = proc && proc.exitCode === null && proc.signalCode === null;
		if (proc && (running || (proc.stderr && !proc.stderr.readableEnded))) {
			// 'close' comes once stderr is drained too.
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, VFB_STOP_TIMEOUT_MS);
				proc.once("close", () => {
					clearTimeout(timer);
					resolve();
				});
			});
		}
		const code = proc?.exitCode;
		const why = this.stderrTail.trim();
		this.kill();
		if (why) return `${this.serverName} did not report a display: ${why}`;
		return `${this.serverName} did not report a display (got '${got}', exit=${code})`;
	}

	private readDisplayNumber(stream: NodeJS.ReadableStream): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			let buf = "";
			let settled = false;

			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				stream.removeAllListeners("data");
				stream.removeAllListeners("end");
				stream.removeAllListeners("error");
				stream.on("error", () => {}); // a late pipe error is not fatal
				proc?.removeListener("error", onSpawnError);
				fn();
			};

			const proc = this.proc;
			const onSpawnError = (error: Error) =>
				finish(() => {
					this.kill();
					reject(this.error(`Could not start ${this.serverName}: ${error}`));
				});
			proc?.once("error", onSpawnError);

			const timer = setTimeout(() => {
				finish(() => {
					this.kill();
					reject(
						this.error(
							`${this.serverName} did not report a display within ${DISPLAYFD_READ_TIMEOUT_MS}ms`,
						),
					);
				});
			}, DISPLAYFD_READ_TIMEOUT_MS);

			stream.on("data", (chunk) => {
				buf += chunk.toString();
				if (buf.includes("\n")) {
					finish(() => resolve(buf));
				}
			});
			stream.on("end", () => {
				finish(() => {
					if (buf.includes("\n")) {
						resolve(buf);
						return;
					}
					this.noReport(buf).then((message) => reject(this.error(message)));
				});
			});
			stream.on("error", (error) => {
				finish(() => {
					this.kill();
					reject(
						this.error(`Failed to read ${this.serverName}'s display: ${error}`),
					);
				});
			});
		});
	}

	/**
	 * Stop Xvfb if it is running, and remove its lock and socket either way: a
	 * killed Xvfb leaves its socket behind, and every stranded one pushes
	 * -displayfd's next display number higher.
	 */
	kill(): void {
		if (!this.proc) return;

		if (OS_NAME !== "lin") {
			// vfb leaves no files; its monitor goes with the process.
			this.stopVfb(this.proc);
			this.proc = null;
			return;
		}

		if (this.proc.exitCode === null && this.proc.signalCode === null) {
			if (this.debug) {
				console.log("Terminating virtual display:", this._display);
			}
			try {
				this.proc.kill("SIGKILL");
			} catch {
				// Already gone.
			}
		} else if (this.debug) {
			console.log("Virtual display already exited:", this._display);
		}

		for (const stale of [
			`/tmp/.X${this._display}-lock`,
			`/tmp/.X11-unix/X${this._display}`,
		]) {
			try {
				fs.unlinkSync(stale);
			} catch {
				// Missing is the normal case; anything else (a permission error
				// from a number another user has since claimed) must not take
				// down a teardown path.
			}
		}

		this.proc = null;
	}

	/**
	 * Close vfb's stdin so it detaches its monitor and exits, and kill it if it
	 * has not within VFB_STOP_TIMEOUT_MS.
	 */
	private stopVfb(proc: ChildProcess): void {
		if (this.debug) {
			console.log("Terminating virtual display:", this._display);
		}
		if (proc.exitCode !== null || proc.signalCode !== null) return;
		const timer = setTimeout(() => {
			try {
				proc.kill("SIGKILL");
			} catch {
				// Already gone.
			}
		}, VFB_STOP_TIMEOUT_MS);
		timer.unref();
		proc.once("exit", () => clearTimeout(timer));
		proc.stdin?.on("error", () => {});
		proc.stdin?.end();
		proc.stdout?.destroy();
	}
}
