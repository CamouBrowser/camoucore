/**
 * webdl() streams into the caller's file. A slow disk must hold the download
 * back rather than queue it in memory, and a network failure must say what
 * failed to download and why.
 */
import * as net from "node:net";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webdl } from "../src/download.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

it("waits for a slow stream to drain instead of queueing the download", async () => {
	const chunks = 64;
	const size = 1024;
	vi.stubGlobal(
		"fetch",
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						for (let i = 0; i < chunks; i++)
							controller.enqueue(new Uint8Array(size));
						controller.close();
					},
				}),
				{ headers: { "content-length": String(chunks * size) } },
			),
	);
	let peak = 0;
	let received = 0;
	const slow: Writable = new Writable({
		highWaterMark: size,
		write(chunk, _enc, done) {
			received += chunk.length;
			setTimeout(() => {
				// What is still queued behind this chunk once the disk catches up.
				peak = Math.max(peak, slow.writableLength);
				done();
			}, 2);
		},
	});
	await webdl("https://example.invalid/x.zip", "x", false, slow, {
		progressCallback: () => {},
	});
	await new Promise<void>((r) => slow.end(r));
	expect(received).toBe(chunks * size);
	// Without waiting for 'drain' all 64 KiB sit in the stream's buffer.
	expect(peak).toBeLessThanOrEqual(2 * size);
});

it("a network failure names the URL and its cause", async () => {
	// Node's own error is only "fetch failed".
	// A port that was just free, so nothing is listening on it.
	const server = net.createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as net.AddressInfo;
	await new Promise((resolve) => server.close(resolve));
	const url = `http://127.0.0.1:${port}/geoip.zip`;
	await expect(webdl(url, "x", false)).rejects.toThrow(
		`Could not download ${url}: fetch failed (ECONNREFUSED`,
	);
});

describe("webdl network failures", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("retries a request that failed before any response", async () => {
		const closed = Object.assign(new TypeError("fetch failed"), {
			cause: { code: "UND_ERR_SOCKET", message: "other side closed" },
		});
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(closed)
			.mockResolvedValueOnce(new Response("mmdb"));
		vi.stubGlobal("fetch", fetchMock);
		const body = await webdl(
			"https://example.test/a.zip",
			undefined,
			false,
			null,
			{
				progressCallback: () => {},
			},
		);
		expect(body.toString()).toBe("mmdb");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("does not retry an HTTP error", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response("", { status: 404, statusText: "Not Found" }),
			);
		vi.stubGlobal("fetch", fetchMock);
		await expect(
			webdl("https://example.test/missing.zip", undefined, false, null, {
				progressCallback: () => {},
			}),
		).rejects.toThrow("404 Client Error");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
