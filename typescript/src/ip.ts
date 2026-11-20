/**
 * Helpers to find the user's public IP address for geolocation.
 *
 * TypeScript twin of python/src/camoucore/ip.py. Python sends the lookup with
 * `requests`; here it goes through node:https, tunnelled by hand through an
 * HTTP(S) CONNECT or SOCKS5 proxy, so the package needs no HTTP client.
 */
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as tls from "node:tls";
import { InvalidIP, InvalidProxy } from "./exceptions.js";

export interface ProxyConfig {
	server: string;
	username?: string;
	password?: string;
	bypass?: string;
}

/** urllib.parse.quote(value, safe=''): everything but unreserved characters. */
function quote(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

// biome-ignore lint/complexity/noStaticOnlyClass: these are the Python Proxy dataclass's methods; the data itself is ProxyConfig
export class ProxyHelper {
	/** Parses the proxy server string. */
	static parseServer(server: string): {
		schema?: string;
		url: string;
		port?: string;
	} {
		const proxyMatch = server.match(/^(?:(\w+):\/\/)?(.*?)(?::(\d+))?$/);
		if (!proxyMatch) {
			throw new InvalidProxy(`Invalid proxy server: ${server}`);
		}
		return { schema: proxyMatch[1], url: proxyMatch[2], port: proxyMatch[3] };
	}

	static asString(proxy: ProxyConfig): string {
		const { schema, url, port } = ProxyHelper.parseServer(proxy.server);
		let result = `${schema || "http"}://`;
		// Percent-encode the credentials: a raw `#`, `/`, `?` or `@` breaks the
		// URL, and a raw `%XX` is decoded into a different password.
		if (proxy.username) {
			result += quote(proxy.username);
			if (proxy.password) {
				result += `:${quote(proxy.password)}`;
			}
			result += "@";
		}
		result += url;
		if (port) {
			result += `:${port}`;
		}
		return result;
	}
}

export function validIPv4(ip: string | false): boolean {
	return ip ? net.isIPv4(ip) : false;
}

export function validIPv6(ip: string | false): boolean {
	return ip ? net.isIPv6(ip) : false;
}

export function validateIP(ip: string): void {
	if (!validIPv4(ip) && !validIPv6(ip)) {
		throw new InvalidIP(`Invalid IP address: ${ip}`);
	}
}

// Probing the exit IP through a proxy adds a hop and a TLS handshake behind it;
// 5 s is not enough for a proxy that routes the long way round, and every URL
// timing out fails the whole launch. Direct probes keep 5 s.
export const DIRECT_IP_TIMEOUT_MS = 5000;
export const PROXIED_IP_TIMEOUT_MS = 15000;

function once<T>(
	timeoutMs: number,
	what: string,
	run: (resolve: (v: T) => void, reject: (e: unknown) => void) => void,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`${what} timed out after ${timeoutMs} ms`)),
			timeoutMs,
		);
		run(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});
}

/** Where an HTTP(S) proxy listens. */
function proxyEndpoint(proxy: URL): { host: string; port: string | number } {
	return {
		host: proxy.hostname.replace(/^\[(.*)\]$/, "$1"),
		port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
	};
}

/** Basic auth for an HTTP(S) proxy, when its URL carries credentials. */
function proxyAuthorization(proxy: URL): Record<string, string> {
	if (!proxy.username) return {};
	const auth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
	return {
		"Proxy-Authorization": `Basic ${Buffer.from(auth).toString("base64")}`,
	};
}

/** A TCP stream to host:port through an HTTP(S) proxy's CONNECT. */
function connectTunnel(
	proxy: URL,
	host: string,
	port: number,
	timeoutMs: number,
): Promise<net.Socket> {
	return once(timeoutMs, "proxy CONNECT", (resolve, reject) => {
		const request = (proxy.protocol === "https:" ? https : http).request({
			...proxyEndpoint(proxy),
			method: "CONNECT",
			path: `${host}:${port}`,
			headers: { Host: `${host}:${port}`, ...proxyAuthorization(proxy) },
		});
		request.on("connect", (response, socket) => {
			if (response.statusCode === 200) resolve(socket);
			else {
				socket.destroy();
				reject(
					new Error(
						`proxy refused CONNECT: ${response.statusCode} ${response.statusMessage}`,
					),
				);
			}
		});
		request.on("error", reject);
		request.end();
	});
}

/** A TCP stream to host:port through a SOCKS5 proxy (RFC 1928, RFC 1929). */
function connectSocks5(
	proxy: URL,
	host: string,
	port: number,
	timeoutMs: number,
): Promise<net.Socket> {
	return once(timeoutMs, "SOCKS5 handshake", (resolve, reject) => {
		const username = decodeURIComponent(proxy.username);
		const password = decodeURIComponent(proxy.password);
		const socket = net.connect({
			host: proxy.hostname.replace(/^\[(.*)\]$/, "$1"),
			port: Number(proxy.port || 1080),
		});
		let buffered = Buffer.alloc(0);
		let step: "greeting" | "auth" | "connect" = "greeting";
		const fail = (message: string) => {
			socket.destroy();
			reject(new Error(message));
		};
		const sendConnect = () => {
			step = "connect";
			const name = Buffer.from(host);
			socket.write(
				Buffer.concat([
					Buffer.from([5, 1, 0, 3, name.length]),
					name,
					Buffer.from([port >> 8, port & 0xff]),
				]),
			);
		};
		socket.on("error", reject);
		socket.on("connect", () => {
			socket.write(Buffer.from(username ? [5, 2, 0, 2] : [5, 1, 0]));
		});
		const onData = (chunk: Buffer) => {
			buffered = Buffer.concat([buffered, chunk]);
			if (step === "greeting") {
				if (buffered.length < 2) return;
				const method = buffered[1];
				buffered = buffered.subarray(2);
				if (method === 0) sendConnect();
				else if (method === 2 && username) {
					step = "auth";
					const user = Buffer.from(username);
					const pass = Buffer.from(password);
					socket.write(
						Buffer.concat([
							Buffer.from([1, user.length]),
							user,
							Buffer.from([pass.length]),
							pass,
						]),
					);
				} else fail("SOCKS5 proxy offered no usable authentication method");
			} else if (step === "auth") {
				if (buffered.length < 2) return;
				const status = buffered[1];
				buffered = buffered.subarray(2);
				if (status !== 0) fail("SOCKS5 proxy rejected the credentials");
				else sendConnect();
			} else {
				if (buffered.length < 5) return;
				if (buffered[1] !== 0) {
					fail(`SOCKS5 proxy refused the connection (code ${buffered[1]})`);
					return;
				}
				const addr = buffered[3];
				const length =
					addr === 1 ? 10 : addr === 4 ? 22 : addr === 3 ? 7 + buffered[4] : -1;
				if (length < 0) {
					fail("SOCKS5 proxy sent a malformed reply");
					return;
				}
				if (buffered.length < length) return;
				socket.off("data", onData);
				const rest = buffered.subarray(length);
				if (rest.length) socket.unshift(rest);
				resolve(socket);
			}
		};
		socket.on("data", onData);
	});
}

function parseProxy(proxy: string): URL {
	try {
		return new URL(proxy);
	} catch (error) {
		throw new InvalidProxy(`Invalid proxy server: ${proxy}`, { cause: error });
	}
}

function proxySocket(
	url: URL,
	host: string,
	port: number,
	timeoutMs: number,
): Promise<net.Socket> {
	switch (url.protocol) {
		case "http:":
		case "https:":
			return connectTunnel(url, host, port, timeoutMs);
		case "socks5:":
		case "socks5h:":
			return connectSocks5(url, host, port, timeoutMs);
		default:
			throw new InvalidProxy(
				`Unsupported proxy scheme for the public IP lookup: ${url.protocol}//. ` +
					"Supported: http, https, socks5.",
			);
	}
}

/**
 * GET a URL's body, directly or through `proxy`, as requests.get() sends it:
 * https is tunnelled and its certificate verified; plain http goes to an
 * HTTP(S) proxy in absolute form, and through a SOCKS5 tunnel otherwise.
 */
async function getText(url: string, proxy?: string): Promise<string> {
	const timeoutMs = proxy ? PROXIED_IP_TIMEOUT_MS : DIRECT_IP_TIMEOUT_MS;
	const target = new URL(url);
	const secure = target.protocol === "https:";
	const options: https.RequestOptions = {
		agent: false,
		headers: { Connection: "close" },
	};
	let client: typeof http | typeof https = secure ? https : http;
	let socket: net.Socket | undefined;
	const proxyUrl = proxy ? parseProxy(proxy) : undefined;
	if (proxyUrl && !secure && proxyUrl.protocol.startsWith("http")) {
		client = proxyUrl.protocol === "https:" ? https : http;
		Object.assign(options, proxyEndpoint(proxyUrl), {
			path: url,
			headers: {
				...options.headers,
				Host: target.host,
				...proxyAuthorization(proxyUrl),
			},
		});
	} else if (proxyUrl) {
		const port = Number(target.port || (secure ? 443 : 80));
		const raw = await proxySocket(proxyUrl, target.hostname, port, timeoutMs);
		const stream = secure
			? tls.connect({ socket: raw, servername: target.hostname })
			: raw;
		socket = stream;
		// Node ignores createConnection when an agent is given, `false`
		// included, and would connect to the target itself, around the proxy.
		options.agent = undefined;
		options.createConnection = () => stream;
	}
	return once<string>(timeoutMs, `GET ${url}`, (resolve, reject) => {
		const onResponse = (response: http.IncomingMessage) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.on("error", reject);
			response.on("end", () => {
				const status = response.statusCode ?? 0;
				if (status >= 400) {
					// requests' raise_for_status()
					reject(
						new Error(
							`${status} Error: ${response.statusMessage} for url: ${url}`,
						),
					);
				} else resolve(Buffer.concat(chunks).toString("utf8"));
			});
		};
		const request = options.path
			? client.get(options, onResponse)
			: client.get(url, options, onResponse);
		request.on("error", reject);
	}).finally(() => socket?.destroy());
}

const PROXY_LOOKUP_FAILED =
	"Could not look up where the proxy exits. Pass webrtc_ip, timezoneId, " +
	"locale and geolocation explicitly to skip the lookup";

/** Where a proxy exits: its IP and that IP's timezone, country and position. */
export interface ExitGeo {
	ip: string;
	timezone: string;
	country: string;
	latitude: number;
	longitude: number;
}

/**
 * Where `proxy` exits, looked up through the proxy. Throws InvalidIP when the
 * lookup fails: a context that silently kept the host's WebRTC IP and timezone
 * behind a proxy would be a leak.
 */
export async function proxyExitGeo(proxy: string): Promise<ExitGeo> {
	let data: {
		status?: string;
		message?: string;
		query?: string;
		timezone?: string;
		countryCode?: string;
		lat?: number;
		lon?: number;
	};
	try {
		data = JSON.parse(
			await getText(
				"http://ip-api.com/json?fields=status,message,query,timezone,countryCode,lat,lon",
				proxy,
			),
		);
	} catch (error) {
		throw new InvalidIP(`${PROXY_LOOKUP_FAILED}: ${error}`, { cause: error });
	}
	if (
		data.status !== "success" ||
		!data.query ||
		!data.timezone ||
		!data.countryCode ||
		data.lat == null ||
		data.lon == null
	) {
		throw new InvalidIP(
			`${PROXY_LOOKUP_FAILED}: ${data.message ?? JSON.stringify(data)}`,
		);
	}
	validateIP(data.query);
	return {
		ip: data.query,
		timezone: data.timezone,
		country: data.countryCode,
		latitude: data.lat,
		longitude: data.lon,
	};
}

const PUBLIC_IP_URLS = [
	// Prefers IPv4
	"https://api.ipify.org",
	"https://checkip.amazonaws.com",
	"https://ipinfo.io/ip",
	// IPv4 & IPv6
	"https://icanhazip.com",
	"https://ifconfig.co/ip",
	"https://ipecho.net/plain",
];

// Python memoizes public_ip() with lru_cache; mirror that so repeated launches
// through the same proxy don't re-hit the API endpoints.
const publicIPCache = new Map<string, Promise<string>>();

/** Sends a request to a public IP api. */
export function publicIP(proxy?: string): Promise<string> {
	const key = proxy ?? "";
	const cached = publicIPCache.get(key);
	if (cached) return cached;
	const pending = resolvePublicIP(proxy).catch((error) => {
		// Never cache a failure: the next launch should retry.
		publicIPCache.delete(key);
		throw error;
	});
	publicIPCache.set(key, pending);
	return pending;
}

let publicIPv6Cache: Promise<string | null> | undefined;

/**
 * This host's public IPv6 address, or null when it has none it can reach the
 * internet from. The hosts have AAAA records only, so an answer proves the route.
 */
export function publicIPv6(): Promise<string | null> {
	publicIPv6Cache ??= (async () => {
		for (const url of ["https://api6.ipify.org", "https://v6.ident.me"]) {
			try {
				const ip = (await getText(url)).trim();
				if (validIPv6(ip)) return ip;
			} catch {}
		}
		return null;
	})();
	return publicIPv6Cache;
}

async function resolvePublicIP(proxy?: string): Promise<string> {
	let endException: unknown;
	for (const url of PUBLIC_IP_URLS) {
		try {
			const ip = (await getText(url, proxy)).trim();
			validateIP(ip);
			return ip;
		} catch (error) {
			endException = error;
		}
	}
	const detail =
		endException instanceof Error ? endException.message : String(endException);
	throw new InvalidIP(`Failed to get IP address: ${detail}`, {
		cause: endException,
	});
}
