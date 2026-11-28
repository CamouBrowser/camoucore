/** Twin of python/camoucore/tests/test_telemetry.py. */
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { FIREFOX, Product } from "../../src/product.js";
import {
	type Observation,
	proxyProvider,
	type ResponseView,
	RULES_DATA,
	Rules,
	registrableDomain,
	Tally,
	Telemetry,
	telemetryEnabled,
} from "../../src/telemetry.js";

const PRODUCT = new Product("camoufox", "Camoufox", FIREFOX);
const RULES = new Rules();
const UUID = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";

afterEach(() => {
	for (const key of ["TELEMETRY", "TELEMETRY_URL"])
		delete process.env[PRODUCT.envVar(key)];
	delete process.env.DO_NOT_TRACK;
});

function view(
	url: string,
	opts: Partial<ResponseView> & { headers?: Record<string, string> } = {},
): ResponseView {
	const headers = Object.fromEntries(
		Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
	);
	return {
		method: "GET",
		status: 200,
		document: false,
		...opts,
		url,
		headers,
	};
}

/** Classify, fetching what a rule asks for the way the browser glue does. */
function classify(v: ResponseView): [string, string, boolean][] {
	let result = RULES.classify(v);
	if ("need" in result) {
		if (result.headers && v.allHeaders === undefined)
			v.allHeaders = { ...v.headers };
		if (result.body && v.body === undefined) v.body = "";
		result = RULES.classify(v);
	}
	if (!Array.isArray(result)) throw new Error("still needs a fetch");
	return result.map(([p, verdict, transient]) => [p, verdict, transient]);
}

describe("the rules file", () => {
	it("ties every rule to its provider", () => {
		for (const [name, spec] of Object.entries<any>(RULES_DATA.providers)) {
			expect(["success", "unknown"], name).toContain(spec.unresolved);
			for (const rule of spec.rules) {
				expect(["presence", "success", "challenge", "block"]).toContain(
					rule.verdict,
				);
				expect(
					"url" in rule || rule.edge || "request_header_name" in rule,
				).toBe(true);
			}
		}
	});

	it("reads a body only from a provider endpoint or a provider error page", () => {
		for (const spec of Object.values<any>(RULES_DATA.providers))
			for (const rule of spec.rules) {
				if (!("body" in rule)) continue;
				const onEndpoint = "url" in rule;
				const onErrorPage =
					rule.edge &&
					(rule.status ?? ["2xx"]).every((s: string) => "45".includes(s[0]));
				expect(onEndpoint || onErrorPage).toBe(true);
			}
	});

	it("matches nothing and reads nothing on an ordinary response", () => {
		expect(
			RULES.classify(view("https://shop.example/", { document: true })),
		).toEqual([]);
		expect(
			RULES.classify(view("https://shop.example/api/cart", { method: "POST" })),
		).toEqual([]);
		expect(
			RULES.classify(
				view("https://shop.example/", { status: 403, document: true }),
			),
		).toEqual([]);
	});
});

describe("per provider", () => {
	it("cloudflare", () => {
		const edge = { "cf-ray": "8a1b2c3d4e5f-LAX", server: "cloudflare" };
		expect(
			classify(
				view("https://a.example/", {
					status: 403,
					headers: { ...edge, "cf-mitigated": "challenge" },
					document: true,
				}),
			),
		).toEqual([["cloudflare", "challenge", true]]);
		expect(
			classify(
				view("https://a.example/", {
					status: 403,
					headers: edge,
					document: true,
					body: "Sorry, you have been blocked",
				}),
			),
		).toEqual([["cloudflare", "block", false]]);
		expect(
			classify(
				view("https://a.example/missing", {
					status: 403,
					headers: edge,
					document: true,
					body: "Forbidden by the origin",
				}),
			),
		).toEqual([]);
		expect(
			classify(view("https://a.example/", { headers: edge, document: true })),
		).toEqual([["cloudflare", "success", false]]);
		expect(
			classify(view("https://challenges.cloudflare.com/turnstile/v0/api.js")),
		).toEqual([["turnstile", "presence", false]]);
	});

	it("datadome", () => {
		expect(
			classify(view("https://geo.captcha-delivery.com/captcha/?t=bv&cid=y")),
		).toEqual([["datadome", "block", false]]);
		expect(
			classify(view("https://geo.captcha-delivery.com/captcha/?t=fe&cid=y")),
		).toEqual([["datadome", "challenge", false]]);
		expect(
			classify(view("https://geo.captcha-delivery.com/interstitial/?x=1")),
		).toEqual([["datadome", "challenge", true]]);
		expect(
			classify(
				view("https://api-js.datadome.co/js/", {
					method: "POST",
					body: '{"status":200}',
				}),
			),
		).toEqual([["datadome", "success", false]]);
	});

	it("akamai", () => {
		expect(
			classify(
				view("https://a.example/", {
					status: 403,
					headers: { server: "AkamaiGHost" },
					document: true,
					body: "Access Denied ... Reference #18.abc",
				}),
			),
		).toEqual([["akamai", "block", false]]);
		const sensor = (cookie: string) =>
			view("https://a.example/x7Gh/sensor", {
				status: 201,
				method: "POST",
				headers: { "akamai-grn": "0.1" },
				allHeaders: { "akamai-grn": "0.1", "set-cookie": cookie },
			});
		expect(classify(sensor("_abck=ABC~0~YAAQ~-1~||; Path=/"))).toEqual([
			["akamai", "success", false],
		]);
		expect(classify(sensor("_abck=ABC~-1~YAAQ~-1~; Path=/"))).toEqual([]);
	});

	it("perimeterx, kasada, imperva, awswaf", () => {
		expect(
			classify(
				view("https://collector-pxabc123.px-cloud.net/api/v2/collector", {
					method: "POST",
					body: '{"do":["bake|_px3|330|abc"]}',
				}),
			),
		).toEqual([["perimeterx", "success", false]]);
		expect(
			classify(
				view("https://a.example/", {
					status: 429,
					headers: { "x-kpsdk-ct": "a" },
					document: true,
				}),
			),
		).toEqual([["kasada", "challenge", true]]);
		expect(
			classify(view(`https://a.example/${UUID}/${UUID}/tl`, { status: 400 })),
		).toEqual([["kasada", "block", false]]);
		expect(
			classify(
				view("https://a.example/", {
					status: 403,
					headers: { "x-iinfo": "1" },
					document: true,
					body: "Incapsula incident ID: 1",
				}),
			),
		).toEqual([["imperva", "block", false]]);
		expect(
			classify(
				view("https://a.example/", {
					status: 405,
					headers: { "x-amzn-waf-action": "captcha" },
					document: true,
				}),
			),
		).toEqual([["awswaf", "challenge", false]]);
	});

	it("captcha widgets and presence-only providers", () => {
		expect(
			classify(
				view("https://api.hcaptcha.com/getcaptcha/abc", {
					method: "POST",
					body: '{"generated_pass_UUID":"P1_abc"}',
				}),
			),
		).toEqual([["hcaptcha", "success", false]]);
		expect(
			classify(
				view("https://api.hcaptcha.com/getcaptcha/abc", {
					method: "POST",
					body: '{"tasklist":[{}]}',
				}),
			),
		).toEqual([["hcaptcha", "challenge", false]]);
		expect(
			classify(view("https://www.google.com/recaptcha/api2/payload?p=x")),
		).toEqual([["recaptcha", "challenge", false]]);
		expect(
			classify(
				view("https://client-api.arkoselabs.com/fc/gt2/public_key/ABC", {
					method: "POST",
					body: '{"token":"1.2|r=us|sup=1|pk=ABC"}',
				}),
			),
		).toEqual([["arkose", "success", false]]);
		expect(classify(view("https://shop.queue-it.net/softblock/?c=s"))).toEqual([
			["queueit", "challenge", false],
		]);
		expect(
			classify(
				view("https://a.example/api", {
					requestHeaderNames: ["x-1a2b3c4d-a", "accept"],
				}),
			),
		).toEqual([["shape", "presence", false]]);
		expect(
			classify(view("https://h.online-metrix.net/fp/tags.js?org_id=x")),
		).toEqual([["threatmetrix", "presence", false]]);
		expect(classify(view("https://www.google.com/js/bg/abc.js"))).toEqual([
			["botguard", "presence", false],
		]);
	});

	it("never reads a URL's query to find a provider", () => {
		expect(
			classify(
				view("https://shop.example/search?q=captcha-delivery.com/captcha/"),
			),
		).toEqual([]);
	});
});

describe("encounters", () => {
	type Step = [string, boolean, boolean];
	function finished(steps: Step[], provider = "datadome") {
		const tally = new Tally(RULES);
		for (const [verdict, transient, opens] of steps)
			tally.observe(1, "shop.example", [
				provider,
				verdict,
				transient,
				opens,
			] as Observation);
		tally.closeAll();
		return tally.take()[provider];
	}

	it("counts an encounter's worst outcome once", () => {
		expect(
			finished([
				["presence", false, true],
				["success", false, true],
			]),
		).toEqual({ success: 1, challenge: 0, block: 0, unknown: 0 });
		expect(
			finished([
				["challenge", false, true],
				["success", false, true],
			]).challenge,
		).toBe(1);
		expect(
			finished([
				["success", false, true],
				["block", false, true],
			]).block,
		).toBe(1);
	});

	it("counts a transient challenge that clears as a success", () => {
		expect(
			finished([
				["challenge", true, true],
				["success", false, true],
			]).success,
		).toBe(1);
		expect(finished([["challenge", true, true]]).challenge).toBe(1);
	});

	it("counts presence alone as the provider's unresolved outcome", () => {
		expect(finished([["presence", false, true]], "datadome").success).toBe(1);
		expect(finished([["presence", false, true]], "hcaptcha").unknown).toBe(1);
	});

	it("needs an open encounter for a verdict that does not open one", () => {
		expect(finished([["success", false, false]], "cloudflare")).toBeUndefined();
		expect(
			finished(
				[
					["presence", false, true],
					["success", false, false],
				],
				"cloudflare",
			).success,
		).toBe(1);
	});

	it("closes an encounter when the page goes to another site", () => {
		const tally = new Tally(RULES);
		tally.observe(1, "a.example", ["datadome", "challenge", false, true]);
		tally.navigated(1, "a.example");
		expect(tally.take()).toEqual({});
		tally.navigated(1, "b.example");
		expect(tally.take()).toEqual({
			datadome: { success: 0, challenge: 1, block: 0, unknown: 0 },
		});
	});
});

describe("proxy provider", () => {
	it.each<[unknown, string]>([
		[null, "none"],
		[{}, "none"],
		[
			{
				server: "http://gate.smartproxy.com:7000",
				username: "user-abc",
				password: "hunter2",
			},
			"smartproxy.com",
		],
		[{ server: "socks5://user:pass@pr.oxylabs.io:7777" }, "oxylabs.io"],
		["brd.superproxy.io:22225", "superproxy.io"],
		[{ server: "http://proxy.example.co.uk:8080" }, "example.co.uk"],
		[{ server: "http://203.0.113.9:8080" }, "ip-address"],
		[{ server: "http://[2001:db8::1]:8080" }, "ip-address"],
		[{ server: "socks5://127.0.0.1:1080" }, "self-hosted"],
		[{ server: "http://192.168.1.4:3128" }, "self-hosted"],
		[{ server: "socks5://100.101.102.103:1080" }, "self-hosted"],
		[{ server: "http://node.tailnet-abc.ts.net:1080" }, "self-hosted"],
		[{ server: "http://localhost:8080" }, "self-hosted"],
	])("%j -> %s", (proxy, expected) => {
		expect(proxyProvider(proxy as any)).toBe(expected);
	});

	it("finds the registrable domain", () => {
		expect(registrableDomain("a.b.example.com")).toBe("example.com");
		expect(registrableDomain("x.example.com.au")).toBe("example.com.au");
	});
});

describe("reports", () => {
	function reporter(sent: [string, any][], proxy: any = null) {
		return new Telemetry(PRODUCT, {
			version: "1.2.3",
			browserVersion: "146.0",
			crossOs: true,
			passthrough: false,
			proxy,
			intervalMs: 0,
			send: async (url, payload) => {
				sent.push([url, payload]);
			},
		});
	}

	it("holds counts and launch dimensions only", async () => {
		const sent: [string, any][] = [];
		const t = reporter(sent, {
			server: "http://user:secret@gate.smartproxy.com:7000",
			username: "user-abc",
			password: "hunter2",
		});
		t.tally.observe(1, "shop.example", ["datadome", "block", false, true]);
		await t.close();
		expect(sent).toEqual([
			[
				"https://api.camoufox.com/v1/telemetry/antibot",
				{
					schema: 1,
					product: "camoufox",
					version: "1.2.3",
					browser_version: "146.0",
					// fp-process's ingest refuses a report without a boolean `pro`.
					pro: false,
					cross_os: true,
					passthrough: false,
					proxy_provider: "smartproxy.com",
					counts: {
						datadome: { success: 0, challenge: 0, block: 1, unknown: 0 },
					},
				},
			],
		]);
		const text = JSON.stringify(sent[0][1]);
		for (const secret of [
			"user",
			"secret",
			"hunter2",
			"gate.",
			"7000",
			"shop.example",
		])
			expect(text).not.toContain(secret);
	});

	it("sends nothing without an encounter, and once at close", async () => {
		const sent: [string, any][] = [];
		const t = reporter(sent);
		await t.close();
		await t.close();
		expect(sent).toEqual([]);
	});

	it("takes the endpoint from the environment", async () => {
		process.env[PRODUCT.envVar("TELEMETRY_URL")] = "http://127.0.0.1:9/ingest";
		const t = reporter([]);
		expect(t.endpoint).toBe("http://127.0.0.1:9/ingest");
		await t.close();
	});

	it.each<[boolean | null, Record<string, string>, boolean]>([
		[true, {}, true],
		[null, {}, true],
		[false, {}, false],
		[true, { TELEMETRY: "0" }, false],
		[true, { TELEMETRY: "off" }, false],
		[true, { TELEMETRY: "1" }, true],
		[true, { DO_NOT_TRACK: "1" }, false],
		[true, { DO_NOT_TRACK: "0" }, true],
	])("opt-out: setting %s env %j -> %s", (setting, env, expected) => {
		for (const [key, value] of Object.entries(env))
			process.env[key === "DO_NOT_TRACK" ? key : PRODUCT.envVar(key)] = value;
		expect(telemetryEnabled(PRODUCT, setting)).toBe(expected);
	});
});

describe("browser glue", () => {
	class FakePage extends EventEmitter {
		private readonly frame: any;
		constructor(url: string) {
			super();
			this.frame = { url: () => url, page: () => this };
		}
		mainFrame() {
			return this.frame;
		}
		goto(url: string) {
			this.frame.url = () => url;
			this.emit("framenavigated", this.frame);
		}
	}
	class FakeResponse {
		bodyReads = 0;
		constructor(
			private readonly page: FakePage,
			private readonly u: string,
			private readonly opts: {
				status?: number;
				body?: string;
				document?: boolean;
				method?: string;
				fail?: boolean;
			} = {},
		) {}
		frame() {
			return this.page.mainFrame();
		}
		url() {
			return this.u;
		}
		status() {
			return this.opts.status ?? 200;
		}
		headers() {
			return {};
		}
		async allHeaders() {
			return {};
		}
		async body() {
			this.bodyReads++;
			if (this.opts.fail) throw new Error("target closed");
			return Buffer.from(this.opts.body ?? "");
		}
		request() {
			return {
				method: () => this.opts.method ?? "GET",
				resourceType: () => (this.opts.document ? "document" : "fetch"),
				headers: () => ({}),
			};
		}
	}
	class FakeContext extends EventEmitter {
		private readonly list: FakePage[] = [];
		pages() {
			return this.list;
		}
		newPage() {
			const page = new FakePage("about:blank");
			this.list.push(page);
			this.emit("page", page);
			return page;
		}
	}
	const settle = () => new Promise((r) => setImmediate(r));

	it("counts an encounter and never reads a page body", async () => {
		const sent: [string, any][] = [];
		const t = new Telemetry(PRODUCT, {
			version: "1",
			browserVersion: "1",
			crossOs: false,
			passthrough: false,
			proxy: null,
			intervalMs: 0,
			send: async (url, payload) => {
				sent.push([url, payload]);
			},
		});
		const ctx = new FakeContext();
		t.watch(ctx);
		const page = ctx.newPage();
		page.goto("https://shop.example/");
		const ordinary = new FakeResponse(page, "https://shop.example/", {
			body: "<html>secret</html>",
			document: true,
		});
		ctx.emit("response", ordinary);
		ctx.emit(
			"response",
			new FakeResponse(page, "https://geo.captcha-delivery.com/captcha/?t=fe"),
		);
		ctx.emit(
			"response",
			new FakeResponse(page, "https://api-js.datadome.co/js/", {
				method: "POST",
				body: '{"status":200}',
			}),
		);
		await settle();
		page.goto("https://other.example/");
		ctx.emit(
			"response",
			new FakeResponse(page, "https://api.hcaptcha.com/getcaptcha/x", {
				method: "POST",
				fail: true,
			}),
		);
		await settle();
		await t.close();
		expect(ordinary.bodyReads).toBe(0);
		expect(sent[0][1].counts).toEqual({
			datadome: { success: 0, challenge: 1, block: 0, unknown: 0 },
		});
	});
});
