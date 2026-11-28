/**
 * Proxy telemetry: how often anti-bot providers let a launch through, challenge
 * it or block it, counted per provider and reported with the proxy provider's
 * domain.
 *
 * TypeScript twin of python/camoucore/src/camoucore/telemetry.py, which documents what is
 * collected and what never is. In short: outcome counts per anti-bot provider
 * and the launch's dimensions (launcher, versions, cross-OS, passthrough,
 * proxy provider domain, and `pro`, always false until Pro ships). Never a URL, site, page content, cookie, header
 * value, IP address, proxy credential, or any identifier of the user.
 *
 * Off with `telemetry: false`, `<NAME>_TELEMETRY=0`, or `DO_NOT_TRACK=1`.
 */
import * as net from "node:net";
import { loadDataFile } from "./data.js";
import type { Product } from "./product.js";

export const DEFAULT_ENDPOINT = "https://api.camoufox.com/v1/telemetry/antibot";
export const SCHEMA = 1;
export const OUTCOMES = ["success", "challenge", "block", "unknown"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type Counts = Record<string, Record<Outcome, number>>;
export const FLUSH_INTERVAL_MS = 600_000;
export const SEND_TIMEOUT_MS = 3_000;
export const BODY_LIMIT = 65536;
const OFF = new Set(["0", "false", "off", "no"]);

export const RULES_DATA: any = loadDataFile("antibot-rules.json");

/** Whether to report: the launch's setting, unless the environment turns it off. */
export function telemetryEnabled(
	product: Product,
	setting: boolean | null | undefined,
): boolean {
	if (setting === false) return false;
	if (OFF.has((product.getenv("TELEMETRY") ?? "").trim().toLowerCase()))
		return false;
	const dnt = (process.env.DO_NOT_TRACK ?? "").trim().toLowerCase();
	return !(dnt && !OFF.has(dnt));
}

// ---------------------------------------------------------------- domains

const SUFFIXES = new Set<string>(RULES_DATA.multi_label_suffixes);

/** The domain a business registers: 'gate.example.co.uk' -> 'example.co.uk'. */
export function registrableDomain(host: string): string {
	const labels = host.toLowerCase().replace(/\.$/, "").split(".");
	const keep = SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
	return labels.slice(-keep).join(".");
}

// Loopback, private, link-local, carrier-grade NAT (tailnets) and unique-local.
const SELF_HOSTED = new net.BlockList();
for (const [address, prefix] of [
	["127.0.0.0", 8],
	["10.0.0.0", 8],
	["172.16.0.0", 12],
	["192.168.0.0", 16],
	["169.254.0.0", 16],
	["100.64.0.0", 10],
] as const)
	SELF_HOSTED.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
	["::1", 128],
	["fc00::", 7],
	["fe80::", 10],
] as const)
	SELF_HOSTED.addSubnet(address, prefix, "ipv6");

export type ProxySetting =
	| null
	| undefined
	| string
	| { server?: string; [key: string]: unknown };

function proxyHost(proxy: ProxySetting): string | null {
	let server = typeof proxy === "string" ? proxy : proxy?.server;
	if (!server) return null;
	server = String(server).trim();
	if (!server.includes("://")) server = `http://${server}`;
	try {
		return new URL(server).hostname.replace(/^\[|\]$/g, "") || null;
	} catch {
		return null;
	}
}

/**
 * The proxy provider's registrable domain, and nothing else of the proxy:
 * 'none' without one, 'ip-address' for a bare IP, 'self-hosted' for a
 * loopback, private or tailnet host.
 */
export function proxyProvider(proxy: ProxySetting): string {
	const host = proxyHost(proxy);
	if (!host) return "none";
	const family = net.isIP(host);
	if (family)
		return SELF_HOSTED.check(host, family === 4 ? "ipv4" : "ipv6")
			? "self-hosted"
			: "ip-address";
	if (
		!host.includes(".") ||
		/\.(local|internal|lan|ts\.net|localhost)$/i.test(host)
	)
		return "self-hosted";
	return registrableDomain(host);
}

// ---------------------------------------------------------------- rules

/** What a rule may look at: one response, reduced to the fields rules test. */
export interface ResponseView {
	url: string;
	method: string;
	status: number;
	/** Lower-case names. */
	headers: Record<string, string>;
	document: boolean;
	requestHeaderNames?: Iterable<string>;
	/** With set-cookie, fetched on demand. */
	allHeaders?: Record<string, string>;
	/** Fetched on demand. */
	body?: string;
}

/** A rule's other conditions hold, and it needs these to decide. */
export interface Need {
	need: true;
	headers: boolean;
	body: boolean;
}

/** provider, verdict, transient, opens */
export type Observation = [string, string, boolean, boolean];

interface CompiledRule {
	verdict: string;
	transient: boolean;
	opens: boolean;
	document: boolean;
	edge: boolean;
	method?: string;
	status?: string[];
	url?: RegExp;
	query: [string, RegExp][];
	headers: [string, RegExp][];
	body?: RegExp;
	requestHeaderName?: RegExp;
}

interface CompiledProvider {
	edge: [RegExp, RegExp | null][];
	rules: CompiledRule[];
	unresolved: Outcome;
}

const rx = (pattern: string) => new RegExp(pattern, "i");

function statusOk(status: number, wanted: string[]): boolean {
	const s = String(status);
	return wanted.some((w) => s === w || (w.endsWith("xx") && s[0] === w[0]));
}

function splitUrl(url: string): {
	hostPath: string;
	query: Map<string, string[]>;
} {
	try {
		const u = new URL(url);
		const query = new Map<string, string[]>();
		for (const [k, v] of u.searchParams)
			query.set(k, [...(query.get(k) ?? []), v]);
		return { hostPath: u.hostname + u.pathname, query };
	} catch {
		return { hostPath: "", query: new Map() };
	}
}

export class Rules {
	readonly providers = new Map<string, CompiledProvider>();

	constructor(data: any = RULES_DATA) {
		for (const [name, spec] of Object.entries<any>(data.providers)) {
			this.providers.set(name, {
				edge: (spec.edge ?? []).map((e: any) => [
					rx(e.name),
					"value" in e ? rx(e.value) : null,
				]),
				unresolved: spec.unresolved,
				rules: spec.rules.map(
					(r: any): CompiledRule => ({
						verdict: r.verdict,
						transient: Boolean(r.transient),
						opens: r.opens ?? true,
						document: Boolean(r.document),
						edge: Boolean(r.edge),
						method: r.method,
						status: r.status,
						url: r.url ? rx(r.url) : undefined,
						query: Object.entries<string>(r.query ?? {}).map(([k, v]) => [
							k,
							rx(v),
						]),
						headers: Object.entries<string>(r.headers ?? {}).map(([k, v]) => [
							k,
							rx(v),
						]),
						body: r.body ? rx(r.body) : undefined,
						requestHeaderName: r.request_header_name
							? rx(r.request_header_name)
							: undefined,
					}),
				),
			});
		}
	}

	private static isEdge(
		edge: [RegExp, RegExp | null][],
		headers: Record<string, string>,
	): boolean {
		return edge.some(([name, value]) =>
			Object.entries(headers).some(
				([k, v]) => name.test(k) && (value === null || value.test(v)),
			),
		);
	}

	/** The observations this response makes, or what has to be fetched first. */
	classify(view: ResponseView): Need | Observation[] {
		const { hostPath, query } = splitUrl(view.url);
		const requestHeaderNames = [...(view.requestHeaderNames ?? [])];
		const out: Observation[] = [];
		let needHeaders = false;
		let needBody = false;
		for (const [name, provider] of this.providers) {
			let isEdge: boolean | null = null;
			for (const rule of provider.rules) {
				if (rule.document && !view.document) continue;
				if (rule.method && rule.method !== view.method) continue;
				if (rule.url && !rule.url.test(hostPath)) continue;
				if (rule.status && !statusOk(view.status, rule.status)) continue;
				if (rule.edge) {
					isEdge ??= Rules.isEdge(provider.edge, view.headers);
					if (!isEdge) continue;
				}
				if (
					rule.query.some(
						([k, p]) => !(query.get(k) ?? []).some((v) => p.test(v)),
					)
				)
					continue;
				if (
					rule.requestHeaderName &&
					!requestHeaderNames.some((h) => rule.requestHeaderName?.test(h))
				)
					continue;
				if (rule.headers.length) {
					if (
						rule.headers.some(([k]) => k === "set-cookie") &&
						view.allHeaders === undefined
					) {
						needHeaders = true;
						break;
					}
					const headers = view.allHeaders ?? view.headers;
					if (rule.headers.some(([k, p]) => !p.test(headers[k] ?? "")))
						continue;
				}
				if (rule.body) {
					if (view.body === undefined) {
						needBody = true;
						break;
					}
					if (!rule.body.test(view.body)) continue;
				}
				out.push([name, rule.verdict, rule.transient, rule.opens]);
				break;
			}
		}
		if (needHeaders || needBody)
			return { need: true, headers: needHeaders, body: needBody };
		return out;
	}

	unresolved(provider: string): Outcome {
		const p = this.providers.get(provider);
		if (!p) throw new Error(`unknown provider ${provider}`);
		return p.unresolved;
	}
}

// ---------------------------------------------------------------- encounters

interface Encounter {
	site: string;
	blocked: boolean;
	/** A challenge that does not clear by itself. */
	challenged: boolean;
	/** 'success' or a transient 'challenge', the latest. */
	last: string | null;
}

/** Encounters in progress and the outcome counts of finished ones. */
export class Tally {
	private counts: Counts = {};
	private readonly open = new Map<unknown, Map<string, Encounter>>();

	constructor(readonly rules: Rules) {}

	observe(page: unknown, site: string, observation: Observation): void {
		const [provider, verdict, transient, opens] = observation;
		let encounters = this.open.get(page);
		let enc = encounters?.get(provider);
		if (enc && enc.site !== site) {
			this.finish(page, provider);
			enc = undefined;
		}
		if (!enc) {
			if (!opens) return;
			enc = { site, blocked: false, challenged: false, last: null };
			if (!encounters) {
				encounters = new Map();
				this.open.set(page, encounters);
			}
			encounters.set(provider, enc);
		}
		if (verdict === "block") enc.blocked = true;
		else if (verdict === "challenge" && !transient) enc.challenged = true;
		else if (verdict === "success" || verdict === "challenge")
			enc.last = verdict;
	}

	/** A page's main frame now shows `site`: encounters on another site are over. */
	navigated(page: unknown, site: string): void {
		for (const [provider, enc] of this.open.get(page) ?? [])
			if (enc.site !== site) this.finish(page, provider);
	}

	closePage(page: unknown): void {
		for (const provider of [...(this.open.get(page)?.keys() ?? [])])
			this.finish(page, provider);
	}

	closeAll(): void {
		for (const page of [...this.open.keys()]) this.closePage(page);
	}

	/** The finished counts, reset. */
	take(): Counts {
		const counts = this.counts;
		this.counts = {};
		return counts;
	}

	private finish(page: unknown, provider: string): void {
		const encounters = this.open.get(page);
		const enc = encounters?.get(provider);
		if (!encounters || !enc) return;
		encounters.delete(provider);
		if (!encounters.size) this.open.delete(page);
		let outcome: Outcome;
		if (enc.blocked) outcome = "block";
		else if (enc.challenged || enc.last === "challenge") outcome = "challenge";
		else if (enc.last === "success") outcome = "success";
		else outcome = this.rules.unresolved(provider);
		this.counts[provider] ??= {
			success: 0,
			challenge: 0,
			block: 0,
			unknown: 0,
		};
		this.counts[provider][outcome] += 1;
	}
}

// ---------------------------------------------------------------- reporting

function siteOf(url: string): string {
	try {
		const host = new URL(url).hostname;
		return host ? registrableDomain(host) : "";
	} catch {
		return "";
	}
}

export type Sender = (url: string, payload: object) => Promise<void>;

async function post(url: string, payload: object): Promise<void> {
	try {
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
		});
	} catch {
		// Telemetry never affects a launch: an unreachable endpoint loses the report.
	}
}

export interface TelemetryOptions {
	version: string;
	browserVersion: string;
	crossOs: boolean;
	passthrough: boolean;
	proxy: ProxySetting;
	rules?: Rules;
	send?: Sender;
	/** 0 turns the periodic flush off. */
	intervalMs?: number;
}

/**
 * One launch's reporter. A launcher creates it when telemetry is enabled,
 * hands it each browser context with `watch`, and awaits `close` when the
 * browser closes. Counts are sent every FLUSH_INTERVAL_MS and at close.
 */
export class Telemetry {
	readonly endpoint: string;
	readonly dimensions: Record<string, string | boolean>;
	readonly rules: Rules;
	readonly tally: Tally;
	private readonly send: Sender;
	private readonly timer?: NodeJS.Timeout;
	private closed = false;
	private readonly onExit = () => void this.close();

	constructor(product: Product, options: TelemetryOptions) {
		this.endpoint = product.getenv("TELEMETRY_URL") || DEFAULT_ENDPOINT;
		this.dimensions = {
			product: product.name,
			version: options.version,
			browser_version: options.browserVersion,
			// The ingest keys every report on it and refuses one without it.
			pro: false,
			cross_os: Boolean(options.crossOs),
			passthrough: Boolean(options.passthrough),
			// The domain is all that is kept of the proxy.
			proxy_provider: proxyProvider(options.proxy),
		};
		this.rules = options.rules ?? new Rules();
		this.tally = new Tally(this.rules);
		this.send = options.send ?? post;
		const interval = options.intervalMs ?? FLUSH_INTERVAL_MS;
		if (interval > 0) {
			this.timer = setInterval(() => void this.flush(), interval);
			this.timer.unref();
		}
		process.once("beforeExit", this.onExit);
	}

	payload(counts: Counts): object {
		return { schema: SCHEMA, ...this.dimensions, counts };
	}

	async flush(): Promise<void> {
		const counts = this.tally.take();
		if (!Object.keys(counts).length) return;
		await this.send(this.endpoint, this.payload(counts));
	}

	/** Count every open encounter and send what is left. Safe to call twice. */
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		if (this.timer) clearInterval(this.timer);
		process.removeListener("beforeExit", this.onExit);
		this.tally.closeAll();
		await this.flush();
	}

	/** Listen to a Playwright BrowserContext. */
	watch(context: any): void {
		context.on("response", (response: any) => void this.onResponse(response));
		context.on("page", (page: any) => this.watchPage(page));
		for (const page of context.pages()) this.watchPage(page);
		context.on("close", () => {
			for (const page of context.pages()) this.tally.closePage(page);
		});
	}

	/** Count and send everything when the browser closes or disconnects. */
	watchBrowser(browser: any): void {
		browser.on("disconnected", () => void this.close());
	}

	private watchPage(page: any): void {
		const main = page.mainFrame();
		page.on("framenavigated", (frame: any) => {
			if (frame === main) this.tally.navigated(page, siteOf(frame.url()));
		});
		page.on("close", () => this.tally.closePage(page));
	}

	private async onResponse(response: any): Promise<void> {
		try {
			let page: any;
			try {
				page = response.frame().page();
			} catch {
				return; // a service worker's response has no page
			}
			const request = response.request();
			const site = siteOf(page.mainFrame().url());
			const view: ResponseView = {
				url: response.url(),
				method: request.method(),
				status: response.status(),
				headers: response.headers(),
				document: request.resourceType() === "document",
				requestHeaderNames: Object.keys(request.headers()),
			};
			let result = this.rules.classify(view);
			if ("need" in result) {
				if (result.headers) view.allHeaders = await response.allHeaders();
				if (result.body)
					view.body = (await response.body())
						.subarray(0, BODY_LIMIT)
						.toString("utf-8");
				result = this.rules.classify(view);
			}
			if (Array.isArray(result))
				for (const observation of result)
					this.tally.observe(page, site, observation);
		} catch {
			// Telemetry never affects a launch.
		}
	}
}
