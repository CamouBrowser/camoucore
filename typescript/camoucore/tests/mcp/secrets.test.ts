/** Secrets: where each may be typed, the codes it types, and its redaction. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Secrets, totp, UrlPattern } from "../../src/mcp/secrets.js";

describe("UrlPattern", () => {
	const matches = (pattern: string, url: string) =>
		new UrlPattern(pattern).matches(url);

	it("is https on the exact host unless it says otherwise", () => {
		expect(matches("example.com", "https://example.com/login")).toBe(true);
		expect(matches("EXAMPLE.com", "https://example.COM/")).toBe(true);
		expect(matches("example.com", "http://example.com/")).toBe(false);
		expect(matches("example.com", "https://www.example.com/")).toBe(false);
		expect(matches("http*://example.com", "http://example.com/")).toBe(true);
		expect(matches("http*://example.com", "https://example.com/")).toBe(true);
	});

	it("takes subdomains only with *.", () => {
		expect(matches("*.example.com", "https://example.com/")).toBe(true);
		expect(matches("*.example.com", "https://a.b.example.com/")).toBe(true);
		expect(matches("*.example.com", "https://notexample.com/")).toBe(false);
	});

	it("matches the parsed host, not text in the URL", () => {
		for (const url of [
			"https://example.com.evil.com/",
			"https://example.com@evil.com/",
			"https://evil.com/?next=https://example.com/",
			"about:blank",
			"not a url",
		]) {
			expect(matches("example.com", url), url).toBe(false);
		}
	});

	it("checks a port and a path when given", () => {
		expect(matches("http://127.0.0.1:8080", "http://127.0.0.1:8080/")).toBe(
			true,
		);
		expect(matches("http://127.0.0.1:8080", "http://127.0.0.1:9090/")).toBe(
			false,
		);
		expect(matches("example.com:443", "https://example.com/")).toBe(true);
		expect(matches("example.com/login*", "https://example.com/login/2")).toBe(
			true,
		);
		expect(matches("example.com/login*", "https://example.com/account")).toBe(
			false,
		);
	});

	it("refuses what is not a pattern", () => {
		for (const pattern of ["ftp://example.com", "*", "exa*mple.com", ""]) {
			expect(() => new UrlPattern(pattern), pattern).toThrow(
				"is not a URL pattern",
			);
		}
	});
});

describe("totp", () => {
	// RFC 6238 appendix B, SHA-1, cut to the 6 digits authenticator apps use.
	const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
	it.each([
		[59, "287082"],
		[1111111109, "081804"],
		[1234567890, "005924"],
		[2000000000, "279037"],
	])("at %i s is %s", (seconds, code) => {
		expect(totp(seed, seconds * 1000)).toBe(code);
	});

	it("reads a seed as authenticator apps show it", () => {
		expect(totp("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", 59_000)).toBe(
			"287082",
		);
	});
});

describe("Secrets", () => {
	const secrets = new Secrets({
		"example.com": {
			password: "hunter22&x",
			otp: { totp: "GEZDGNBVGY3TQOJQ" },
		},
		"http*://*.example.org": { password: "other-pass" },
	});

	it("gives a value only on its domain", () => {
		expect(secrets.valueFor("password", "https://example.com/login")).toBe(
			"hunter22&x",
		);
		expect(secrets.valueFor("password", "http://a.example.org/")).toBe(
			"other-pass",
		);
		expect(() => secrets.valueFor("password", "https://evil.com/")).toThrow(
			"Secret password is for example.com, http*://*.example.org, and this field's frame is at https://evil.com/.",
		);
		expect(() => secrets.valueFor("pin", "https://example.com/")).toThrow(
			"There is no secret named pin.",
		);
		expect(secrets.valueFor("otp", "https://example.com/")).toMatch(/^\d{6}$/);
		expect(secrets.namesFor("https://example.com/")).toEqual([
			"password",
			"otp",
		]);
		expect(secrets.names()).toEqual({
			"example.com": ["password", "otp"],
			"http*://*.example.org": ["password"],
		});
	});

	it("redacts a value in every form it takes in text", () => {
		const value = "hunter22&x";
		for (const form of [
			value,
			value.toUpperCase(),
			"hunter22&amp;x",
			"hunter22%26x",
			Buffer.from(value).toString("base64"),
			Buffer.from(value).toString("hex"),
		]) {
			expect(secrets.redact(`a ${form} b`), form).toBe("a <secret:password> b");
		}
		expect(secrets.redact('{"v":"other-pass"}')).toBe(
			'{"v":"<secret:password>"}',
		);
		expect(secrets.redact("GEZDGNBVGY3TQOJQ")).toBe("<secret:otp>");
		expect(secrets.contains("x HUNTER22&X")).toBe(true);
		expect(secrets.contains("nothing here")).toBe(false);
	});

	it("refuses a secret without a domain, too short, or with a bad seed", () => {
		expect(
			() => new Secrets({ password: "hunter22" } as unknown as never),
		).toThrow("Secrets are scoped to a URL pattern");
		expect(() => new Secrets({ "example.com": { pin: "123" } })).toThrow(
			"shorter than 4 characters",
		);
		expect(
			() => new Secrets({ "example.com": { otp: { totp: "not base32!" } } }),
		).toThrow("a TOTP seed is base32");
	});

	it.runIf(process.platform !== "win32")(
		"loads only a file its owner alone can read",
		() => {
			const file = path.join(
				fs.mkdtempSync(path.join(os.tmpdir(), "camoucore-mcp-")),
				"secrets.json",
			);
			fs.writeFileSync(file, JSON.stringify({ "example.com": { a: "abcd" } }));
			fs.chmodSync(file, 0o644);
			expect(() => Secrets.load(file)).toThrow("can be read by other users");
			fs.chmodSync(file, 0o600);
			expect(Secrets.load(file).names()).toEqual({ "example.com": ["a"] });
		},
	);
});
