/**
 * Captcha solving with CaptchaKraken: the `captcha` launch option.
 *
 * TypeScript twin of python/camoucore/src/camoucore/captcha.py. The option names where
 * solves go and with which key, in one of three ways:
 *
 * - an account key (`cfp_live_...`), the same key every service of the
 *   launcher's account takes, which solves at the product's captcha endpoint;
 * - a CaptchaKraken key (`ck_live_...`), which solves at CaptchaKraken's API;
 * - the URL of a CaptchaKraken server you host (`http://localhost:8000/v1`).
 *
 * `captcha: true` reads the same three from the environment. With none of them
 * set it throws CaptchaKeyMissing, which lists a free account first and hosting
 * the solver yourself second. The client is an optional peer dependency, so
 * asking for captcha without it installed throws CaptchaKrakenMissing at launch
 * rather than at the first solve.
 */
import { createRequire } from "node:module";
import { CaptchaKeyMissing, CaptchaKrakenMissing } from "./exceptions.js";
import { earlyAccessUrl } from "./pro.js";
import type { Product } from "./product.js";

export const ACCOUNT_KEY_PREFIX = "cfp_live_";
export const CAPTCHAKRAKEN_KEY_PREFIX = "ck_live_";
export const CAPTCHAKRAKEN_ENDPOINT = "https://api.captchakraken.com/v1";
/** The CaptchaKraken client's own variable for its key. */
export const CAPTCHAKRAKEN_KEY_ENV = "CAPTCHA_KRAKEN_API_KEY";
/** The CaptchaKraken client reads which client sent a hosted solve from here. */
export const CAPTCHAKRAKEN_CLIENT_ENV = "CAPTCHA_KRAKEN_CLIENT";

export type CaptchaOption =
	| undefined
	| null
	| boolean
	| string
	| { endpoint?: string | null; key?: string | null };
export type CaptchaSource = "account" | "captchakraken" | "self-hosted";

/**
 * The part of captchakraken's CaptchaKrakenSolver a launcher calls, declared
 * here so these types build without the optional client installed.
 */
export interface PageSolver {
	readonly baseUrl: string | undefined;
	solve(page: unknown): Promise<unknown>;
	watch(page: unknown, options?: Record<string, unknown>): unknown;
}

interface Client {
	CaptchaKrakenSolver: new (config: Record<string, unknown>) => PageSolver;
}

/** Where solves go, and the key they carry (undefined for a server that wants none). */
export class Captcha {
	readonly #key: string | undefined;

	constructor(
		readonly endpoint: string,
		key: string | undefined,
		readonly source: CaptchaSource,
	) {
		// Private, so the key stays out of JSON.stringify and console.log.
		this.#key = key;
	}

	get key(): string | undefined {
		return this.#key;
	}

	/**
	 * A CaptchaKrakenSolver that solves at this endpoint with this key. `config`
	 * is the rest of its CaptchaKrakenConfig (maxSolveLoops, speed, ...).
	 */
	async solver(
		product: Product,
		config: Record<string, unknown> = {},
	): Promise<PageSolver> {
		const { CaptchaKrakenSolver } = await loadClient(product);
		// The hosted API counts solves per client; a caller's own value stays.
		process.env[CAPTCHAKRAKEN_CLIENT_ENV] ??= product.name;
		return new CaptchaKrakenSolver({
			...config,
			baseUrl: this.endpoint,
			...(this.#key ? { apiKey: this.#key } : {}),
		});
	}
}

const require = createRequire(import.meta.url);

/** Throw CaptchaKrakenMissing unless the client can be loaded. */
export function requireClient(product: Product): void {
	try {
		require.resolve("captchakraken");
	} catch (error) {
		throw new CaptchaKrakenMissing(
			`captcha needs the CaptchaKraken client: npm install captchakraken (a peer dependency of ${product.name}).`,
			{ cause: error },
		);
	}
}

async function loadClient(product: Product): Promise<Client> {
	requireClient(product);
	// A variable specifier, so tsc does not need the client to build.
	const name = "captchakraken";
	const loaded = (await import(name)) as Client & { default?: Client };
	// The client is CommonJS: its exports may arrive on `default`.
	return loaded.default?.CaptchaKrakenSolver ? loaded.default : loaded;
}

/**
 * The solver the `captcha` option asks for, or undefined when it asks for none.
 * Throws before anything launches when the option cannot be used.
 */
export function resolveCaptcha(
	product: Product,
	option: CaptchaOption,
): Captcha | undefined {
	if (option === undefined || option === null || option === false)
		return undefined;
	let captcha: Captcha;
	if (option === true) captcha = fromEnvironment(product);
	else if (typeof option === "string")
		captcha = fromString(product, option.trim(), "captcha");
	else if (typeof option === "object" && !Array.isArray(option))
		captcha = fromObject(product, option);
	else
		throw new TypeError(
			`captcha takes true, a key, a server URL, or {endpoint, key}; got ${typeof option}.`,
		);
	requireClient(product);
	return captcha;
}

function isUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "http:" || url.protocol === "https:") && !!url.host
		);
	} catch {
		return false;
	}
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

function accountEndpoint(product: Product): string {
	return product.getenv("CAPTCHA_ENDPOINT")?.trim() || product.captchaEndpoint;
}

function fromKey(product: Product, key: string, named: string): Captcha {
	if (key.startsWith(ACCOUNT_KEY_PREFIX))
		return new Captcha(accountEndpoint(product), key, "account");
	if (key.startsWith(CAPTCHAKRAKEN_KEY_PREFIX))
		return new Captcha(CAPTCHAKRAKEN_ENDPOINT, key, "captchakraken");
	// The value is never echoed: it may be a key with a typo.
	throw new Error(
		`${named} is not a key this launcher knows: it takes a ${product.title} account key ` +
			`(${ACCOUNT_KEY_PREFIX}...), a CaptchaKraken key (${CAPTCHAKRAKEN_KEY_PREFIX}...), or the URL ` +
			"of a CaptchaKraken server you host (http://...).",
	);
}

function fromString(product: Product, value: string, named: string): Captcha {
	if (isUrl(value))
		return new Captcha(trimSlash(value), undefined, "self-hosted");
	return fromKey(product, value, named);
}

function fromObject(
	product: Product,
	option: { endpoint?: string | null; key?: string | null },
): Captcha {
	const unknown = Object.keys(option).filter(
		(name) => name !== "endpoint" && name !== "key",
	);
	if (unknown.length)
		throw new Error(
			`captcha takes "endpoint" and "key"; it does not take ${unknown.sort().join(", ")}.`,
		);
	const endpoint = option.endpoint?.trim() ?? "";
	const key = option.key?.trim() || undefined;
	if (endpoint) {
		if (!isUrl(endpoint))
			throw new Error(
				`captcha.endpoint must be an http(s) URL; got ${JSON.stringify(endpoint)}.`,
			);
		const source: CaptchaSource = key?.startsWith(ACCOUNT_KEY_PREFIX)
			? "account"
			: key?.startsWith(CAPTCHAKRAKEN_KEY_PREFIX)
				? "captchakraken"
				: "self-hosted";
		return new Captcha(trimSlash(endpoint), key, source);
	}
	if (key) return fromKey(product, key, "captcha.key");
	throw missing(product);
}

function fromEnvironment(product: Product): Captcha {
	for (const variable of [
		product.envVar("PRO_KEY"),
		CAPTCHAKRAKEN_KEY_ENV,
		product.envVar("CAPTCHA_URL"),
	]) {
		const value = process.env[variable]?.trim();
		if (value) return fromString(product, value, variable);
	}
	throw missing(product);
}

function missing(product: Product): CaptchaKeyMissing {
	const url = earlyAccessUrl(product);
	return new CaptchaKeyMissing(
		"Captcha solving needs a key or a server, and none was given. Either:\n" +
			`  1. Make a free ${product.title} account at ${url} (it comes with 10,000 free captcha ` +
			`credits), then pass its key: captcha: "${ACCOUNT_KEY_PREFIX}...", or set ` +
			`${product.envVar("PRO_KEY")}. The same key works for every ${product.title} service.\n` +
			'  2. Host CaptchaKraken yourself (pip install "captchakraken[serve]", then ' +
			'`captchakraken server start`) and pass its URL: captcha: "http://localhost:8000/v1", or set ' +
			`${product.envVar("CAPTCHA_URL")}.\n` +
			`A CaptchaKraken key (${CAPTCHAKRAKEN_KEY_PREFIX}...) works too, passed the same way or set as ` +
			`${CAPTCHAKRAKEN_KEY_ENV}.`,
		url,
	);
}
