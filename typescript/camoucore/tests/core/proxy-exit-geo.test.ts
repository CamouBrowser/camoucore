/**
 * Mirrors python/camoucore/tests/test_proxy_exit_geo.py: where a proxy exits, looked up
 * through it. A local HTTP proxy answers in place of ip-api.com.
 */
import * as http from "node:http";
import * as net from "node:net";
import { afterEach, expect, it } from "vitest";
import { InvalidIP } from "../../src/exceptions.js";
import { proxyExitGeo } from "../../src/ip.js";

const EXIT = {
	status: "success",
	query: "203.0.113.7",
	timezone: "Europe/Paris",
	countryCode: "FR",
	lat: 48.8566,
	lon: 2.3522,
};

interface Seen {
	url?: string;
	host?: string;
	auth?: string;
}

let server: http.Server | net.Server | undefined;

afterEach(() => {
	server?.close();
	server = undefined;
});

/** An HTTP proxy that answers every request with `body`, and the request it saw. */
async function proxy(body: unknown, status = 200): Promise<[string, Seen]> {
	const seen: Seen = {};
	server = http.createServer((request, response) => {
		seen.url = request.url;
		seen.host = request.headers.host;
		seen.auth = request.headers["proxy-authorization"];
		response.writeHead(status, { "Content-Type": "application/json" });
		response.end(JSON.stringify(body));
	});
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as net.AddressInfo;
	return [`127.0.0.1:${port}`, seen];
}

it("reads the exit whole, asking the proxy in absolute form with its credentials", async () => {
	const [address, seen] = await proxy(EXIT);
	expect(await proxyExitGeo(`http://u%40x:p%23w@${address}`)).toEqual({
		ip: "203.0.113.7",
		timezone: "Europe/Paris",
		country: "FR",
		latitude: 48.8566,
		longitude: 2.3522,
	});
	expect(seen.url).toMatch(/^http:\/\/ip-api\.com\/json\?fields=/);
	expect(seen.host).toBe("ip-api.com");
	expect(seen.auth).toBe(`Basic ${Buffer.from("u@x:p#w").toString("base64")}`);
});

it.each([
	"query",
	"timezone",
	"countryCode",
	"lat",
	"lon",
])("raises on a lookup without %s", async (missing) => {
	const partial: Record<string, unknown> = { ...EXIT };
	delete partial[missing];
	const [address] = await proxy(partial);
	await expect(proxyExitGeo(`http://${address}`)).rejects.toThrow(
		/webrtc_ip, timezoneId, locale and geolocation/,
	);
});

it.each([
	["a failed lookup", { status: "fail", message: "private range" }, 200],
	["a proxy error", {}, 502],
])("raises InvalidIP on %s", async (_, body, status) => {
	const [address] = await proxy(body, status);
	await expect(proxyExitGeo(`http://${address}`)).rejects.toThrow(InvalidIP);
});

it("raises InvalidIP when the proxy is unreachable", async () => {
	const [address] = await proxy(EXIT);
	server?.close();
	await new Promise((resolve) => server?.once("close", resolve));
	await expect(proxyExitGeo(`http://${address}`)).rejects.toThrow(InvalidIP);
});

it("tunnels the lookup through a SOCKS5 proxy with its credentials", async () => {
	const seen: { auth?: string; target?: string; request?: string } = {};
	server = net.createServer((socket) => {
		let buffered = Buffer.alloc(0);
		let step = 0;
		socket.on("data", (chunk) => {
			buffered = Buffer.concat([buffered, chunk]);
			if (step === 0 && buffered.length >= 4) {
				buffered = buffered.subarray(2 + buffered[1]);
				socket.write(Buffer.from([5, 2]));
				step = 1;
			}
			if (step === 1 && buffered.length >= 2) {
				const user = buffered.subarray(2, 2 + buffered[1]);
				const rest = buffered.subarray(2 + buffered[1]);
				if (rest.length < 1 || rest.length < 1 + rest[0]) return;
				seen.auth = `${user}:${rest.subarray(1, 1 + rest[0])}`;
				buffered = rest.subarray(1 + rest[0]);
				socket.write(Buffer.from([1, 0]));
				step = 2;
			}
			if (step === 2 && buffered.length >= 5) {
				const length = buffered[4];
				if (buffered.length < 7 + length) return;
				const port = buffered.readUInt16BE(5 + length);
				seen.target = `${buffered.subarray(5, 5 + length)}:${port}`;
				buffered = buffered.subarray(7 + length);
				socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
				step = 3;
			}
			if (step === 3 && buffered.includes("\r\n\r\n")) {
				seen.request = buffered.toString().split("\r\n")[0];
				const body = JSON.stringify(EXIT);
				socket.end(
					`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
				);
				step = 4;
			}
		});
	});
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as net.AddressInfo;
	const exit = await proxyExitGeo(`socks5://u:p@127.0.0.1:${port}`);
	expect(exit.ip).toBe("203.0.113.7");
	expect(seen).toEqual({
		auth: "u:p",
		target: "ip-api.com:80",
		request: expect.stringMatching(/^GET \/json\?fields=\S+ HTTP\/1\.1$/),
	});
});
