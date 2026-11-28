/** Twin of python/camoucore/tests/test_settings.py. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FIREFOX, Product } from "../src/product.js";
import {
	applyDefaults,
	loadDefaults,
	userDefaultsPath,
	writeUserDefaults,
} from "../src/settings.js";

const FOX = new Product(
	"camoufox",
	"Camoufox",
	FIREFOX,
	"https://accounts.example",
);
const PACKAGED = {
	$schema: "ignored",
	_readme: "ignored",
	telemetry: {
		default: true,
		about: "Anti-bot outcome counts.",
		examples: [false],
	},
	humanize: { default: false, about: "Human-like input." },
	locale: { default: null, about: "Locale." },
};

let dir: string;
let packaged: string;
let user: string;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "camoucore-settings-"));
	packaged = path.join(dir, "camoufox.defaults.json");
	fs.writeFileSync(packaged, JSON.stringify(PACKAGED));
	user = path.join(dir, "user", "defaults.json");
	process.env.CAMOUFOX_DEFAULTS = user;
});
afterEach(() => {
	delete process.env.CAMOUFOX_DEFAULTS;
	fs.rmSync(dir, { recursive: true, force: true });
});

const writeUser = (data: unknown) => {
	fs.mkdirSync(path.dirname(user), { recursive: true });
	fs.writeFileSync(user, JSON.stringify(data));
};

it("reads the packaged defaults alone", () => {
	expect(loadDefaults(FOX, packaged)).toEqual({
		telemetry: true,
		humanize: false,
		locale: null,
	});
});

it.each([
	false,
	{ default: false, about: "x" },
])("overrides from the user's file (%j)", (entry) => {
	writeUser({ telemetry: entry, locale: "de-DE" });
	expect(loadDefaults(FOX, packaged)).toEqual({
		telemetry: false,
		humanize: false,
		locale: "de-DE",
	});
});

it("refuses a typo and a wrong type in the user's file", () => {
	writeUser({ telemetri: false });
	expect(() => loadDefaults(FOX, packaged)).toThrow("telemetri");
	writeUser({ telemetry: "no" });
	expect(() => loadDefaults(FOX, packaged)).toThrow("telemetry");
});

it("refuses an undocumented packaged option", () => {
	fs.writeFileSync(packaged, JSON.stringify({ telemetry: { default: true } }));
	expect(() => loadDefaults(FOX, packaged)).toThrow("about");
});

it("lets the caller's options win", () => {
	expect(
		applyDefaults(
			{ telemetry: true, humanize: false },
			{ telemetry: false, humanize: undefined },
		),
	).toEqual({ telemetry: false, humanize: false });
});

it("copies the packaged file to the user's path once", () => {
	expect(userDefaultsPath(FOX)).toBe(user);
	expect(writeUserDefaults(FOX, packaged)).toBe(user);
	fs.writeFileSync(user, '{"telemetry": false}');
	writeUserDefaults(FOX, packaged);
	expect(fs.readFileSync(user, "utf-8")).toBe('{"telemetry": false}');
});
