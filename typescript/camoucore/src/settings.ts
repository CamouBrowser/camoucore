/**
 * A launcher's defaults file: the values every launch starts from.
 *
 * TypeScript twin of python/camoucore/src/camoucore/settings.py. The packaged
 * `<name>.defaults.json` documents each option as
 * `{"default": ..., "about": "...", "examples": [...]}`; a user's file of the
 * same shape, or the short form `{"telemetry": false}`, overrides it. A value
 * a caller passes to the launch wins over both.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { userConfigDir } from "./host.js";
import type { Product } from "./product.js";

/** Where a user's own defaults live: `<NAME>_DEFAULTS`, or the user config directory. */
export function userDefaultsPath(product: Product): string {
	const override = product.getenv("DEFAULTS");
	if (override) return override.replace(/^~(?=$|[\\/])/, os.homedir());
	return path.join(userConfigDir(product.name), "defaults.json");
}

function read(file: string): Record<string, unknown> {
	let data: unknown;
	try {
		data = JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch (e) {
		if (e instanceof SyntaxError)
			throw new Error(`${file} is not valid JSON: ${e.message}`);
		throw e;
	}
	if (!data || typeof data !== "object" || Array.isArray(data))
		throw new Error(`${file} must hold a JSON object of option names`);
	return data as Record<string, unknown>;
}

const skipped = (name: string) => name.startsWith("$") || name.startsWith("_");

const typeName = (v: unknown) =>
	Array.isArray(v) ? "array" : v === null ? "null" : typeof v;

function documentedDefaults(file: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [name, entry] of Object.entries(read(file))) {
		if (skipped(name)) continue;
		const e = entry as Record<string, unknown> | null;
		if (!e || typeof e !== "object" || !("default" in e) || !e.about)
			throw new Error(`${file}: "${name}" needs a "default" and an "about"`);
		out[name] = e.default;
	}
	return out;
}

function userValues(
	file: string,
	known: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [name, entry] of Object.entries(read(file))) {
		if (skipped(name)) continue;
		if (!(name in known))
			throw new Error(
				`${file}: "${name}" is not an option of the defaults file (${Object.keys(known).join(", ")})`,
			);
		const value =
			entry && typeof entry === "object" && "default" in entry
				? (entry as { default: unknown }).default
				: entry;
		const expected = known[name];
		if (
			expected !== null &&
			value !== null &&
			typeName(value) !== typeName(expected)
		)
			throw new Error(
				`${file}: "${name}" is ${typeName(value)}, but its default is ${typeName(expected)}`,
			);
		out[name] = value;
	}
	return out;
}

/**
 * The launch defaults: the packaged file's, overlaid with the user's own file
 * when it exists. An unknown option or a wrong type in the user's file throws.
 */
export function loadDefaults(
	product: Product,
	packaged: string,
	userFile?: string,
): Record<string, unknown> {
	const defaults = documentedDefaults(packaged);
	const file = userFile ?? userDefaultsPath(product);
	if (fs.existsSync(file) && fs.statSync(file).isFile())
		Object.assign(defaults, userValues(file, defaults));
	return defaults;
}

/** `options` with each one the caller left unset (null or undefined) taken from `defaults`. */
export function applyDefaults<T extends Record<string, unknown>>(
	defaults: Record<string, unknown>,
	options: T,
): T {
	const out: Record<string, unknown> = { ...options };
	for (const [name, value] of Object.entries(defaults))
		if (out[name] === undefined || out[name] === null) out[name] = value;
	return out as T;
}

/** Copy the packaged defaults file to the user's path unless one is there; return that path. */
export function writeUserDefaults(product: Product, packaged: string): string {
	const file = userDefaultsPath(product);
	if (!fs.existsSync(file)) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.copyFileSync(packaged, file);
	}
	return file;
}
