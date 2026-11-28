/**
 * Mirrors python/camoucore/tests/camoufox/test_proxy_dns.py: who resolves names behind a proxy
 * (docs/proxy-dns.md).
 *
 * The proxy does unless the caller picks `proxy_dns: "doh"` behind a SOCKS5
 * proxy: then the browser resolves by DoH through the proxy. The default is
 * "exit" because no released browser yet carries HTTP/3 over SOCKS5, the half
 * that makes "doh" match a Firefox at the exit.
 */
import { afterEach, expect, it, vi } from "vitest";
import {
	applyProxyDns,
	PROXY_DOH_PREFS,
	utilsDeps,
} from "../../src/camoufox/utils.js";

const SOCKS = {
	server: "socks5://proxy.example:1080",
	username: "u",
	password: "p",
};
const DOH = {
	...PROXY_DOH_PREFS,
	"network.trr.excluded-domains": "proxy.example",
};

async function apply(
	proxyDns: string | undefined,
	proxy: Record<string, string> | undefined,
	exitLookedUp = false,
	config: Record<string, any> = {},
	prefs: Record<string, any> = {},
) {
	await applyProxyDns(proxyDns, proxy, config, prefs, exitLookedUp);
	return [config, prefs];
}

afterEach(() => {
	vi.restoreAllMocks();
});

it.each([
	undefined,
	"exit",
])("names go to the proxy by default (%s)", async (mode) => {
	const asked = vi.spyOn(utilsDeps, "publicIpv6");
	expect(await apply(mode, SOCKS, true)).toEqual([{}, {}]);
	expect(asked).not.toHaveBeenCalled();
});

it("doh resolves through the SOCKS5 proxy", async () => {
	expect(PROXY_DOH_PREFS["network.trr.mode"]).toBe(3);
	expect(await apply("doh", SOCKS)).toEqual([{}, DOH]);
});

it("a proxy named by address needs no exclusion", async () => {
	for (const server of [
		"socks5://127.0.0.1:1080",
		"socks5://[2001:db8::1]:1080",
	]) {
		expect(await apply("doh", { server })).toEqual([{}, PROXY_DOH_PREFS]);
	}
});

it.each([
	undefined,
	{ server: "http://proxy.example:8080" },
	{ server: "proxy.example:8080" },
	{ server: "socks4://proxy.example:1080" },
])("only SOCKS5 resolves by DoH (%j)", async (proxy) => {
	expect(await apply(undefined, proxy)).toEqual([{}, {}]);
	expect(await apply("exit", proxy)).toEqual([{}, {}]);
	await expect(apply("doh", proxy)).rejects.toThrow(/socks5/);
});

it("an unknown mode throws", async () => {
	await expect(apply("system", SOCKS)).rejects.toThrow(/proxy_dns/);
});

it("the caller's prefs are kept", async () => {
	const mine = {
		"network.trr.uri": "https://dns.example/dns-query",
		"network.trr.excluded-domains": "a.example",
	};
	const [, prefs] = await apply("doh", SOCKS, false, {}, { ...mine });
	expect(prefs).toEqual({ ...mine, "network.trr.mode": 3 });
});

it.each([
	[null, { "network:ipv4Only": true }],
	["2001:db8::7", {}],
])("an exit without IPv6 is an IPv4-only network (%s)", async (ipv6, expected) => {
	const asked = vi.spyOn(utilsDeps, "publicIpv6").mockResolvedValue(ipv6);
	expect((await apply("doh", SOCKS, true))[0]).toEqual(expected);
	expect(asked.mock.calls).toEqual([["socks5://u:p@proxy.example:1080"]]);
});

it("the exit's IPv6 is not asked when already known", async () => {
	const asked = vi.spyOn(utilsDeps, "publicIpv6");
	expect((await apply("doh", SOCKS, false))[0]).toEqual({});
	for (const known of [
		{ "webrtc:ipv6": "2001:db8::7" },
		{ "network:ipv4Only": false },
	]) {
		expect((await apply("doh", SOCKS, true, { ...known }))[0]).toEqual(known);
	}
	expect(asked).not.toHaveBeenCalled();
});
