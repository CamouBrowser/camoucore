/**
 * Downloads, checksums and archives, for every launcher's browser and the
 * GeoIP databases.
 *
 * TypeScript twin of python/camoucore/src/camoucore/download.py.
 */
import { createHash } from "node:crypto";
import { once } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Writable } from "node:stream";
import AdmZip from "adm-zip";
import cliProgress, { type Options as BarOptions } from "cli-progress";
import prettyBytes from "pretty-bytes";
import { CorruptedDownload } from "./exceptions.js";

/** GITHUB_TOKEN, as the Python twin reads it: once, at import. */
export const GITHUB_TOKEN: string | undefined = process.env.GITHUB_TOKEN;

/** Bearer auth for GitHub API calls only (never for asset downloads). */
export function githubHeaders(url: string): Record<string, string> {
	return url.includes("api.github") && GITHUB_TOKEN
		? { Authorization: `Bearer ${GITHUB_TOKEN}` }
		: {};
}

/** Delays before each retry of a request that failed without a response. */
const NETWORK_RETRY_DELAYS_MS = [1000, 2000];

/**
 * fetch(), retried when the request fails without any response, and naming
 * the URL and cause when it gives up. Node's own error is only "fetch failed",
 * which says neither what was being downloaded nor why (DNS, refused, reset,
 * timeout).
 *
 * Unlike requests.get(), which opens a connection per call, fetch() reuses
 * pooled keep-alive connections, and a server may close one just as it is
 * reused ("other side closed"). On GitHub's runners that failed a launcher's
 * `fetch` right after the browser download, before any byte of the GeoIP
 * request was answered. HTTP errors are responses, never retried.
 */
export async function request(
	url: string,
	init: RequestInit,
): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fetch(url, init);
		} catch (error) {
			if (attempt < NETWORK_RETRY_DELAYS_MS.length) {
				await new Promise((resolve) =>
					setTimeout(resolve, NETWORK_RETRY_DELAYS_MS[attempt]),
				);
				continue;
			}
			const cause = (error as { cause?: { code?: string; message?: string } })
				.cause;
			const detail = cause
				? `${cause.code ?? ""} ${cause.message ?? ""}`.trim()
				: "";
			throw new Error(
				`Could not download ${url}: ${(error as Error).message}${detail ? ` (${detail})` : ""}`,
				{ cause: error },
			);
		}
	}
}

/** requests' raise_for_status() message, so callers can match "404". */
export function raiseForStatus(response: Response, url: string): void {
	if (response.ok) return;
	const kind = response.status < 500 ? "Client Error" : "Server Error";
	throw new Error(
		`${response.status} ${kind}: ${response.statusText} for url: ${url}`,
	);
}

const ANSI: Record<string, string> = {
	red: "31",
	green: "32",
	yellow: "33",
	blue: "34",
	cyan: "36",
	bright_black: "90",
};

/** click.style: ANSI-styled text, plain when stdout is not a colour terminal. */
export function style(
	text: string,
	{ fg, bold, dim }: { fg?: string | null; bold?: boolean; dim?: boolean } = {},
): string {
	if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
	const codes: string[] = [];
	if (bold) codes.push("1");
	if (dim) codes.push("2");
	if (fg && ANSI[fg]) codes.push(ANSI[fg]);
	return codes.length ? `\x1b[${codes.join(";")}m${text}\x1b[0m` : text;
}

/** Print a bold, optionally coloured message, as the Python twin's `rich` print. */
/** Print a bold, optionally coloured message, as the Python twin's `rich` print. */
export function rprint(msg: string, fg?: string, nl: boolean = true): void {
	process.stdout.write(style(msg, { fg, bold: true }) + (nl ? "\n" : ""));
}

const formatBytes = (v: number, _: BarOptions, type: string) =>
	type === "total" || type === "value" ? prettyBytes(v) : String(v);

export type ProgressCallback = (downloaded: number, total: number) => void;

/**
 * Download a file from the given URL. Streams into `buffer` when one is given,
 * otherwise accumulates and returns the bytes.
 *
 * An HTTP error raises requests' "<status> Client Error: ... for url: ..."
 * message, like the Python twin; see request() for network failures.
 */
export async function webdl(
	url: string,
	desc?: string,
	bar: boolean = true,
	buffer: Writable | null = null,
	{ progressCallback }: { progressCallback?: ProgressCallback } = {},
): Promise<Buffer> {
	const response = await request(url, { headers: githubHeaders(url) });
	raiseForStatus(response, url);

	const totalSize = Number.parseInt(
		response.headers.get("content-length") || "0",
		10,
	);
	let progressBar: cliProgress.SingleBar | null = null;
	if (!progressCallback && bar) {
		progressBar = new cliProgress.SingleBar(
			{
				format: `${desc || "Downloading"} [{bar}] {percentage}% | ETA: {eta_formatted} | {value}/{total}`,
				formatValue: formatBytes,
				noTTYOutput: true,
			},
			cliProgress.Presets.shades_classic,
		);
		progressBar.start(totalSize, 0);
	}

	const chunks: Uint8Array[] = [];
	let downloaded = 0;
	let lastUpdate = 0;
	try {
		if (!response.body) {
			throw new Error(`Response from ${url} had no body`);
		}
		for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
			if (buffer) {
				// A stream that already failed (disk full) never drains: surface
				// its error instead of waiting on it. When it is merely slow,
				// wait for it, or the whole archive ends up queued in memory.
				if (buffer.errored) throw buffer.errored;
				if (!buffer.write(chunk)) await once(buffer, "drain");
			} else {
				chunks.push(chunk);
			}
			downloaded += chunk.length;
			if (progressCallback) {
				if (downloaded - lastUpdate >= 65536 || downloaded === totalSize) {
					progressCallback(downloaded, totalSize);
					lastUpdate = downloaded;
				}
			} else if (progressBar) {
				progressBar.increment(chunk.length);
			} else if (totalSize) {
				const pct = (downloaded / totalSize) * 100;
				process.stdout.write(`\r${desc}: ${pct.toFixed(0)}%`);
			}
		}
	} finally {
		progressBar?.stop();
	}
	if (!progressCallback && !bar) {
		process.stdout.write(desc ? `\r${desc}: Complete\n` : "\n");
	}

	return Buffer.concat(chunks);
}

/**
 * Check a downloaded file against its expected sha256 digest.
 *
 * Takes the downloaded bytes or the path of the file they were written to.
 * Raises CorruptedDownload on mismatch. Skips (with a warning) when no digest
 * is known, so installs from sources that publish no digest still work.
 */
export function verifySha256(
	buffer: Buffer | Uint8Array | string,
	expected: string | null | undefined,
	desc: string = "asset",
): void {
	if (!expected) {
		rprint(
			`Warning: no sha256 published for ${desc}; skipping verification.`,
			"yellow",
		);
		return;
	}

	const digest = createHash("sha256");
	if (typeof buffer === "string") {
		const fd = fs.openSync(buffer, "r");
		try {
			const block = Buffer.alloc(1024 * 1024);
			let read = fs.readSync(fd, block, 0, block.length, null);
			while (read > 0) {
				digest.update(block.subarray(0, read));
				read = fs.readSync(fd, block, 0, block.length, null);
			}
		} finally {
			fs.closeSync(fd);
		}
	} else {
		digest.update(buffer);
	}

	const actual = digest.digest("hex");
	if (actual !== expected.toLowerCase()) {
		throw new CorruptedDownload(
			`Checksum mismatch for ${desc}.\n` +
				`  expected sha256: ${expected.toLowerCase()}\n` +
				`  actual   sha256: ${actual}\n` +
				"The download was corrupted or tampered with. Installation aborted.",
		);
	}
}

/**
 * Extract a zip file to the given path.
 */
export function unzip(
	zipFile: Buffer | string,
	extractPath: string,
	desc?: string,
	bar: boolean = true,
): void {
	const zip = new AdmZip(zipFile);
	const entries = zip.getEntries();

	if (bar) {
		rprint(desc || "Extracting");
		for (const entry of entries) {
			zip.extractEntryTo(entry, extractPath, true, true);
		}
		return;
	}

	entries.forEach((entry, i) => {
		zip.extractEntryTo(entry, extractPath, true, true);
		if (desc) {
			const pct = ((i + 1) / entries.length) * 100;
			process.stdout.write(`\r${desc}: ${pct.toFixed(0)}%`);
		}
	});
	if (desc) process.stdout.write(`\r${desc}: Complete\n`);
}

/**
 * Move the contents of an archive's single top-level directory up.
 *
 * A release zip can hold one directory (camouwolf-<version>-<release>/); the
 * launcher expects the binary and version.json directly in the install
 * directory.
 */
export function flattenSingleRoot(extractPath: string): void {
	const entries = fs.readdirSync(extractPath);
	if (entries.length !== 1) return;
	const inner = path.join(extractPath, entries[0]);
	if (!fs.statSync(inner).isDirectory() || path.extname(inner) === ".app")
		return;
	for (const child of fs.readdirSync(inner)) {
		fs.renameSync(path.join(inner, child), path.join(extractPath, child));
	}
	fs.rmdirSync(inner);
}
