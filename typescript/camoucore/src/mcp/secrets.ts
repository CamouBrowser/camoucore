/**
 * Secrets the agent can type but never read, after browser-use's
 * `sensitive_data`: the model names a secret, the server types its value into
 * a field whose frame is on the secret's domain, and every value is replaced
 * by `<secret:name>` in whatever goes back to the model.
 */
import { createHmac } from "node:crypto";
import fs from "node:fs";

/**
 * A URL pattern: `[scheme://]host[:port][/path]`. The scheme is `https`,
 * `http` or `http*` (both), and `https` when left out. `*.example.com` is
 * example.com and its subdomains. A port must match when given. A path is a
 * glob on the URL's path, where `*` is any run of characters.
 */
export class UrlPattern {
	private readonly schemes: string[];
	private readonly host: string;
	private readonly subdomains: boolean;
	private readonly port: string | undefined;
	private readonly path: RegExp | undefined;

	constructor(readonly source: string) {
		const parts =
			/^(?:(https|http|http\*):\/\/)?(\*\.)?([^/:*?#]+)(?::(\d+))?(\/[^?#]*)?$/i.exec(
				source,
			);
		if (!parts) {
			throw new Error(
				`${source} is not a URL pattern: [https|http|http*://][*.]host[:port][/path]`,
			);
		}
		const [, scheme = "https", wildcard, host, port, path] = parts;
		this.schemes =
			scheme === "http*" ? ["http:", "https:"] : [`${scheme.toLowerCase()}:`];
		// The URL parser's hostname: lowercase, IDN as punycode, as a URL's is.
		this.host = new URL(`https://${host}`).hostname;
		this.subdomains = Boolean(wildcard);
		this.port = port;
		this.path =
			path === undefined
				? undefined
				: new RegExp(
						`^${path
							.split("*")
							.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
							.join(".*")}$`,
					);
	}

	matches(url: string): boolean {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return false;
		}
		const defaultPort = parsed.protocol === "https:" ? "443" : "80";
		return (
			this.schemes.includes(parsed.protocol) &&
			(parsed.hostname === this.host ||
				(this.subdomains && parsed.hostname.endsWith(`.${this.host}`))) &&
			(this.port === undefined || (parsed.port || defaultPort) === this.port) &&
			(this.path === undefined || this.path.test(parsed.pathname))
		);
	}
}

function base32Decode(text: string): Buffer {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	const clean = text.replace(/[\s=-]/g, "").toUpperCase();
	let bits = "";
	for (const char of clean) {
		const value = alphabet.indexOf(char);
		if (value < 0) throw new Error("a TOTP seed is base32");
		bits += value.toString(2).padStart(5, "0");
	}
	const bytes = bits.match(/.{8}/g) ?? [];
	return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
}

/** RFC 6238 with the defaults every authenticator app uses: SHA-1, 30 s, 6 digits. */
export function totp(seed: string, at: number = Date.now()): string {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
	const hmac = createHmac("sha1", base32Decode(seed)).update(counter).digest();
	const offset = (hmac.at(-1) as number) & 0xf;
	const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
	return code.toString().padStart(6, "0");
}

type Value = string | { totp: string };

interface Entry {
	pattern: UrlPattern;
	name: string;
	value: Value;
}

/** Below this a value would be redacted out of ordinary text too often. */
const MIN_LENGTH = 4;

export class Secrets {
	private readonly entries: Entry[] = [];
	/** Each literal value with its name, longest first, for redaction. */
	private readonly literals: [string, string][];

	/**
	 * `byPattern` maps a URL pattern to that domain's secrets: a name to its
	 * value, or to `{ totp: "<base32 seed>" }` for a one-time code.
	 */
	constructor(byPattern: Record<string, Record<string, Value>>) {
		for (const [source, secrets] of Object.entries(byPattern)) {
			if (typeof secrets !== "object" || secrets === null) {
				throw new Error(
					`Secrets are scoped to a URL pattern: give ${source} an object of name to value.`,
				);
			}
			const pattern = new UrlPattern(source);
			for (const [name, value] of Object.entries(secrets)) {
				const literal = typeof value === "string" ? value : value?.totp;
				if (typeof literal !== "string") {
					throw new Error(
						`Secret ${name} for ${source} is a string or { "totp": "<base32 seed>" }.`,
					);
				}
				if (literal.length < MIN_LENGTH) {
					throw new Error(
						`Secret ${name} for ${source} is shorter than ${MIN_LENGTH} characters, too short to keep out of page text.`,
					);
				}
				if (typeof value !== "string") totp(value.totp);
				this.entries.push({ pattern, name, value });
			}
		}
		this.literals = this.entries
			.map((entry): [string, string] => [
				typeof entry.value === "string" ? entry.value : entry.value.totp,
				entry.name,
			])
			.sort(([a], [b]) => b.length - a.length);
	}

	/** Reads a JSON secrets file that only its owner can read. */
	static load(file: string): Secrets {
		if (process.platform !== "win32" && fs.statSync(file).mode & 0o077) {
			throw new Error(
				`${file} can be read by other users. \`chmod 600 ${file}\` makes it the owner's alone.`,
			);
		}
		return new Secrets(JSON.parse(fs.readFileSync(file, "utf8")));
	}

	get empty(): boolean {
		return this.entries.length === 0;
	}

	/** Every pattern and the names under it; neither is secret. */
	names(): Record<string, string[]> {
		const names: Record<string, string[]> = {};
		for (const { pattern, name } of this.entries) {
			names[pattern.source] ??= [];
			names[pattern.source].push(name);
		}
		return names;
	}

	/** The names usable on a page at `url`. */
	namesFor(url: string): string[] {
		return [
			...new Set(
				this.entries.filter((e) => e.pattern.matches(url)).map((e) => e.name),
			),
		];
	}

	/** The text to type for `name` in a frame at `url`; refuses anywhere else. */
	valueFor(name: string, url: string): string {
		const named = this.entries.filter((entry) => entry.name === name);
		if (!named.length) throw new Error(`There is no secret named ${name}.`);
		const here = named.filter((entry) => entry.pattern.matches(url));
		if (!here.length) {
			throw new Error(
				`Secret ${name} is for ${named.map((e) => e.pattern.source).join(", ")}, and this field's frame is at ${url}.`,
			);
		}
		const values = new Set(here.map((entry) => JSON.stringify(entry.value)));
		if (values.size > 1) {
			throw new Error(
				`Secret ${name} has different values for patterns that all match ${url}: ${here.map((e) => e.pattern.source).join(", ")}.`,
			);
		}
		const { value } = here[0];
		return typeof value === "string" ? value : totp(value.totp);
	}

	/** Whether `text` holds any secret value, in any case. */
	contains(text: string): boolean {
		const lower = text.toLowerCase();
		return this.literals.some(([value]) => lower.includes(value.toLowerCase()));
	}

	/** `text` with every secret value, in every form, as `<secret:name>`. */
	redact(text: string): string {
		return this.literals.reduce(
			(redacted, [value, name]) =>
				redactValue(redacted, value, `<secret:${name}>`),
			text,
		);
	}
}

/**
 * `text` with `value`, and the escaped and encoded forms it takes in markup,
 * JSON, URLs and headers, in any case, replaced by `replacement`.
 */
export function redactValue(
	text: string,
	value: string,
	replacement: string,
): string {
	const forms = new Set([
		value,
		JSON.stringify(value).slice(1, -1),
		encodeURIComponent(value),
		value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;"),
		Buffer.from(value).toString("base64"),
		Buffer.from(value).toString("base64url"),
		Buffer.from(value).toString("hex"),
	]);
	let redacted = text;
	for (const form of forms) {
		const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		redacted = redacted.replace(new RegExp(escaped, "gi"), replacement);
	}
	return redacted;
}
