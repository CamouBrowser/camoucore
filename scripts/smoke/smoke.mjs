// The npm twin of smoke.py: launch an INSTALLED npm driver the way a user's
// code does, and check the launch. A bare import resolves from this file's
// directory, so copy it (and page.html) into the project the tarballs were
// installed in:
//
//   node <npm-dir>/smoke.mjs <launcher>
//
// The npm package is camoucore-<launcher>; its entry point is named after the
// launcher (Camoufox, Camouwolf).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const launcher = process.argv[2];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(HERE, "page.html"));
const TYPED = "smoketest";
const api = await import(`camoucore-${launcher}`);
const open = api[launcher[0].toUpperCase() + launcher.slice(1)];

const seen = {};
const server = http.createServer((request, response) => {
	seen.ua = request.headers["user-agent"] ?? "";
	response.setHeader("Content-Type", "text/html");
	response.end(PAGE);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let result;
const browser = await open({ headless: true });
try {
	const page = await browser.newPage();
	await page.goto(`http://127.0.0.1:${server.address().port}/`);
	const ua = await page.evaluate("navigator.userAgent");
	await page.locator("#button").click();
	await page.locator("#input").pressSequentially(TYPED);
	const events = (await page.locator("#events").textContent())
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const value = await page.locator("#input").inputValue();
	result = { navigator_ua: ua, wire_ua: seen.ua, events, value };
} finally {
	await browser.close();
	server.close();
}
console.log(JSON.stringify({ ...result, events: result.events.length }));
const problems = [];
if (result.navigator_ua !== result.wire_ua)
	problems.push("the navigator and the request disagree on the User-Agent");
if (result.navigator_ua.toLowerCase().includes(launcher))
	problems.push(`the User-Agent names ${launcher}`);
if (result.value !== TYPED)
	problems.push(`the input holds ${JSON.stringify(result.value)}, not ${TYPED}`);
if (
	result.events.length !== 1 + TYPED.length ||
	!result.events.every((event) => event.trusted)
)
	problems.push(
		`expected 1 trusted click and ${TYPED.length} trusted keydowns, saw ${JSON.stringify(result.events)}`,
	);
for (const problem of problems)
	console.error(`::error::${launcher} (npm): ${problem}`);
process.exit(problems.length ? 1 : 0);
