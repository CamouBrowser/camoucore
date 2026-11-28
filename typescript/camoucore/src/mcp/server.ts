/**
 * A launcher's browser as MCP tools: open a session, read the page as an
 * accessibility tree with refs, act on those refs, type secrets the agent
 * never sees, and hand the window to a person for the rest.
 *
 * One session is one launch, so one identity. Nothing is pooled behind a
 * session id: two tasks sharing a browser would share its fingerprint and its
 * cookies. Input goes through the launcher's `humanize` engines, which plan the
 * pointer paths, key timing and scrolling in this process.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	Browser,
	BrowserContext,
	BrowserType,
	Page,
} from "playwright-core";
import { z } from "zod";

import { redactValue, Secrets, UrlPattern } from "./secrets.js";
import { findInTree } from "./tree.js";

// dist/mcp/ in the package, src/mcp/ in the repo: the package root either way.
const VERSION: string = createRequire(import.meta.url)(
	"../../package.json",
).version;

/** What a launcher package exports for this server to drive it. */
export interface Launcher {
	PRODUCT: {
		readonly name: string;
		readonly title: string;
		readonly engine: { readonly name: "firefox" | "chromium" };
	};
	/**
	 * True when NewBrowser takes `passthrough`. A launcher without it would
	 * ignore the option and launch with an injected fingerprint, so the server
	 * asks rather than finding out from the page.
	 */
	PASSTHROUGH?: boolean;
	/** A Browser, or with `persistent_context` the profile's BrowserContext. */
	NewBrowser(
		browserType: BrowserType,
		options: Record<string, unknown>,
	): Promise<Browser | BrowserContext>;
}

/**
 * Imports a launcher by package name or path, and the Playwright browser type
 * it launches, from the Playwright the launcher itself resolves.
 */
export async function loadLauncher(
	specifier: string,
): Promise<{ launcher: Launcher; browserType: BrowserType }> {
	const module = await import(specifier);
	if (!module.PRODUCT?.engine || typeof module.NewBrowser !== "function") {
		throw new Error(
			`${specifier} does not export PRODUCT and NewBrowser, so it is not a launcher this server can drive.`,
		);
	}
	const launcher = module as Launcher;
	const playwright = createRequire(import.meta.resolve(specifier))(
		"playwright-core",
	);
	return { launcher, browserType: playwright[launcher.PRODUCT.engine.name] };
}

/**
 * A file at the top of each engine's profile directory, so a Chromium profile
 * given to a Firefox launcher (or no profile at all) is refused before launch.
 */
const PROFILE_MARKER: Record<Launcher["PRODUCT"]["engine"]["name"], string> = {
	firefox: "prefs.js",
	chromium: "Local State",
};

/**
 * What a running browser leaves in its profile to keep a second one out, and
 * caches the copy does not need. Skipping the locks is what lets a session
 * open a profile the person's own browser has open.
 */
const PROFILE_SKIP = new Set([
	"lock",
	".parentlock",
	"parent.lock",
	"SingletonLock",
	"SingletonSocket",
	"SingletonCookie",
	"cache2",
	"startupCache",
	"Cache",
	"Code Cache",
	"GPUCache",
]);

/**
 * A private copy of the person's profile for one session. The browser writes
 * to its profile (Playwright adds its own prefs), so the original is never
 * launched; what the session changes is thrown away with the copy.
 */
function copyProfile(
	source: string,
	engine: Launcher["PRODUCT"]["engine"]["name"],
): string {
	const marker = PROFILE_MARKER[engine];
	if (!fs.existsSync(path.join(source, marker))) {
		throw new Error(
			`${source} has no ${marker}, so it is not a ${engine} profile directory.`,
		);
	}
	// mkdtemp makes the directory 0700: the copy holds the person's cookies.
	const copy = fs.mkdtempSync(path.join(os.tmpdir(), "camoucore-mcp-profile-"));
	fs.cpSync(source, copy, {
		recursive: true,
		filter: (from) => !PROFILE_SKIP.has(path.basename(from)),
	});
	return copy;
}

/**
 * The file `name` names inside `dir`, refused if it is anything else: a path
 * out of it, a link out of it, or not a file. A path out of it is refused
 * before it is looked at, so the refusal never says what exists elsewhere.
 */
function uploadable(dir: string, name: string): string {
	const root = fs.realpathSync(dir);
	const outside = (file: string) => {
		const inside = path.relative(root, file);
		return (
			!inside ||
			inside === ".." ||
			inside.startsWith(`..${path.sep}`) ||
			path.isAbsolute(inside)
		);
	};
	const refuseOutside = () =>
		new Error(`${name} is outside the uploads directory.`);
	const named = path.resolve(root, name);
	if (outside(named)) throw refuseOutside();
	let file: string;
	try {
		file = fs.realpathSync(named);
	} catch {
		throw new Error(`There is no ${name} in the uploads directory.`);
	}
	if (outside(file)) throw refuseOutside();
	if (!fs.statSync(file).isFile()) throw new Error(`${name} is not a file.`);
	return file;
}

interface Session {
	id: string;
	/** Closes the browser, and removes a profile copy. */
	close(): Promise<void>;
	/** Every open tab, oldest first; `page` is the one the tools act on. */
	pages: Page[];
	page: Page;
	visible: boolean;
	/** A main-frame URL outside the allowed domains, not yet reported. */
	blocked?: string;
}

/**
 * The page's accessibility tree, with what any password field holds hidden: a
 * field's value is in the tree, masked or not, and one the person typed during
 * a hand_off, or the browser filled in, is no configured secret to redact.
 */
async function treeOf(
	page: Page,
	secrets: Secrets,
	{ ref, depth }: { ref?: string | undefined; depth?: number | undefined } = {},
): Promise<string> {
	const root = ref ? page.locator(`aria-ref=${ref}`) : page;
	let tree = await root.ariaSnapshot({
		mode: "ai",
		...(depth === undefined ? {} : { depth }),
	});
	for (const frame of page.frames()) {
		for (const field of await frame.locator("input[type=password]").all()) {
			const value = await field.inputValue().catch(() => "");
			// A configured secret keeps its name, from the redaction of every result.
			if (value && !secrets.contains(value)) {
				tree = redactValue(tree, value, "<hidden password>");
			}
		}
	}
	return tree;
}

export interface ServerOptions {
	/**
	 * The person's own browser profile, which a session opened with
	 * `profile: true` runs on a copy of; without one, that is refused.
	 */
	profile?: string;
	secrets?: Secrets;
	/** URL patterns, as for secrets, that pages may load; empty allows any. */
	allowedDomains?: string[];
	/**
	 * The one directory upload_file may attach files from; without one there
	 * is no upload_file, since a page could otherwise be sent any file here.
	 */
	uploads?: string;
}

type Content =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };
type ToolResult = { content: Content[]; isError?: boolean };

export function createServer(
	launcher: Launcher,
	browserType: BrowserType,
	{
		secrets = new Secrets({}),
		allowedDomains = [],
		profile,
		uploads,
	}: ServerOptions = {},
): { server: McpServer; closeAll(): Promise<void> } {
	const { PRODUCT } = launcher;
	const sessions = new Map<string, Session>();
	const allowed = allowedDomains.map((pattern) => new UrlPattern(pattern));
	const isAllowed = (url: string) =>
		!allowed.length ||
		url === "about:blank" ||
		allowed.some((pattern) => pattern.matches(url));

	// Every result passes through redaction, so a secret the page shows back
	// (a field's value in the snapshot, an echo in an error) reaches the model
	// as <secret:name>.
	const answer = (value: object, extra: Content[] = []): ToolResult => ({
		content: [
			{ type: "text", text: secrets.redact(JSON.stringify(value, null, 2)) },
			...extra,
		],
	});
	const refuse = (error: unknown): ToolResult => {
		const failure = error as Error;
		const text = JSON.stringify(
			{ error: failure.name, message: failure.message },
			null,
			2,
		);
		return {
			content: [{ type: "text", text: secrets.redact(text) }],
			isError: true,
		};
	};

	/** Tracks a tab and keeps its main frame inside the allowed domains. */
	function watch(session: Session, page: Page): void {
		session.pages.push(page);
		page.on("close", () => {
			session.pages = session.pages.filter((open) => open !== page);
			if (session.page === page && session.pages.length) {
				session.page = session.pages[session.pages.length - 1];
			}
		});
		page.on("framenavigated", (frame) => {
			if (frame !== page.mainFrame() || isAllowed(frame.url())) return;
			session.blocked = frame.url();
			page.goto("about:blank").catch(() => {});
		});
	}

	/** A tool on an open session: an unknown id and any failure are refusals. */
	function onSession<A extends { session_id: string }>(
		work: (session: Session, args: A) => Promise<ToolResult>,
	): (args: A) => Promise<ToolResult> {
		return async (args) => {
			const session = sessions.get(args.session_id);
			if (!session) {
				return refuse(
					new Error(
						`No open session ${args.session_id}. session_open starts one.`,
					),
				);
			}
			try {
				// Before and after, since a click's navigation can commit after the
				// click returns: no tool reads or acts on a page outside the domains.
				await keepInside(session);
				const result = await work(session, args);
				await keepInside(session);
				return result;
			} catch (error) {
				// A navigation off the domains that commits during the work detaches
				// the frames it was reading; that, not the detach, is what failed.
				try {
					await keepInside(session);
				} catch (outside) {
					return refuse(outside);
				}
				return refuse(error);
			}
		};
	}

	async function keepInside(session: Session): Promise<void> {
		const url = session.page.url();
		const blocked = session.blocked ?? (isAllowed(url) ? undefined : url);
		if (!blocked) return;
		session.blocked = undefined;
		if (!isAllowed(url)) await session.page.goto("about:blank");
		throw new Error(
			`The page went to ${blocked}, outside the allowed domains, and was sent back to about:blank.`,
		);
	}

	const locate = (session: Session, ref: string) =>
		session.page.locator(`aria-ref=${ref}`);
	const sessionId = z.string().describe("From session_open.");
	const ref = z
		.string()
		.describe("An element ref, like e12, from the latest snapshot.");

	const server = new McpServer(
		{ name: `${PRODUCT.name}-mcp`, version: VERSION },
		{
			instructions:
				`A ${PRODUCT.title} browser. session_open, then navigate, snapshot to read the page and ` +
				"get refs, and click, type, select, scroll and hover by ref. On a large page, snapshot " +
				"with `find` or `ref` to read only the part you need. Type a password or " +
				"one-time code only with type_secret, by name: you never see the values, and the " +
				"person must never be asked to paste one into the chat. For a secret that is not " +
				"configured, payment details, or anything you should not do yourself, hand_off the " +
				"window to the person. Always session_close when done." +
				(secrets.empty
					? " No secrets are configured."
					: ` Secrets, by the URLs they may be typed on: ${JSON.stringify(secrets.names())}.`) +
				(allowed.length
					? ` Pages may load only: ${allowedDomains.join(", ")}.`
					: "") +
				(uploads
					? ` upload_file attaches files from ${uploads}, by name.`
					: ""),
		},
	);

	server.registerTool(
		"session_open",
		{
			title: "Open a browser session",
			description:
				"Launch one browser with a fresh identity. `os` is the identity's OS; left out, the " +
				"launcher draws one. `visible` opens a window a person can see and take over with " +
				"hand_off. `humanize` (default true) moves, types and scrolls like a person; false " +
				"sends each action as Playwright does, which is faster and easier to detect. " +
				"`passthrough` launches with this machine's own fingerprint instead of a drawn one." +
				(profile
					? " `profile` runs on a copy of the person's own browser profile, signed in where " +
						"they are; nothing the session changes is saved back. Use passthrough with it, " +
						"since the sites know that profile with this machine's fingerprint."
					: ""),
			inputSchema: {
				os: z.enum(["windows", "macos", "linux"]).optional(),
				visible: z.boolean().optional(),
				humanize: z.boolean().optional(),
				passthrough: z.boolean().optional(),
				...(profile ? { profile: z.boolean().optional() } : {}),
			},
			annotations: { title: "Open a browser session", openWorldHint: true },
		},
		async (args: {
			os?: "windows" | "macos" | "linux" | undefined;
			visible?: boolean | undefined;
			humanize?: boolean | undefined;
			passthrough?: boolean | undefined;
			profile?: boolean | undefined;
		}) => {
			const {
				os: identityOs,
				visible = false,
				humanize = true,
				passthrough = false,
			} = args;
			let copy: string | undefined;
			let closing = false;
			/**
			 * Never throws: it runs from the browser's own events, where a throw
			 * would take the server down. A copy left behind holds the person's
			 * cookies, so it is named.
			 */
			const removeCopy = async () => {
				const dir = copy;
				if (!dir) return;
				copy = undefined;
				await fs.promises
					.rm(dir, {
						recursive: true,
						force: true,
						maxRetries: 5,
						retryDelay: 200,
					})
					.catch((error: Error) =>
						console.error(
							`camoucore-mcp: could not remove the profile copy ${dir}: ${error.message}`,
						),
					);
			};
			try {
				if (passthrough && !launcher.PASSTHROUGH) {
					throw new Error(
						`This ${PRODUCT.title} launcher does not take passthrough, so it would launch ` +
							"with an injected fingerprint. A release that exports PASSTHROUGH does.",
					);
				}
				if (passthrough && identityOs !== undefined) {
					throw new Error(
						"passthrough launches with this machine's own OS, so it takes no `os`.",
					);
				}
				if (args.profile) {
					if (!profile) throw new Error("No profile is configured.");
					copy = copyProfile(profile, PRODUCT.engine.name);
				}
				const launched = await launcher.NewBrowser(browserType, {
					headless: !visible,
					humanize,
					...(identityOs === undefined ? {} : { os: identityOs }),
					...(passthrough ? { passthrough: true } : {}),
					...(copy ? { persistent_context: true, user_data_dir: copy } : {}),
				});
				// A persistent launch is its profile's context, and opens with a tab.
				const context: BrowserContext | undefined = copy
					? (launched as BrowserContext)
					: undefined;
				const browser = context ? undefined : (launched as Browser);
				const page = context
					? (context.pages()[0] ?? (await context.newPage()))
					: await (browser as Browser).newPage();
				const session: Session = {
					id: randomUUID(),
					// The copy goes once close() returns, when the browser has
					// stopped writing to it.
					close: async () => {
						closing = true;
						try {
							await (context ?? (browser as Browser)).close();
						} finally {
							await removeCopy();
						}
					},
					pages: [],
					page,
					visible,
				};
				watch(session, page);
				// A link or script that opens a tab adds it; switch_tab moves to it.
				page.context().on("page", (opened) => watch(session, opened));
				sessions.set(session.id, session);
				const ended = () => {
					sessions.delete(session.id);
					if (!closing) void removeCopy();
				};
				if (context) context.on("close", ended);
				else (browser as Browser).on("disconnected", ended);
				return answer({ session_id: session.id });
			} catch (error) {
				await removeCopy();
				return refuse(error);
			}
		},
	);

	// A web page only: file:, about:, data: and javascript: URLs would hand the
	// agent the machine's files and the browser's own internals.
	const webUrl = z
		.string()
		.url()
		.refine((url) => ["http:", "https:"].includes(new URL(url).protocol), {
			message: "navigate takes an http or https URL",
		});

	server.registerTool(
		"navigate",
		{
			title: "Navigate",
			description: "Go to an http or https URL and wait for it to load.",
			inputSchema: { session_id: sessionId, url: webUrl },
			annotations: { title: "Navigate", openWorldHint: true },
		},
		onSession(async (session, { url }: { session_id: string; url: string }) => {
			if (!isAllowed(url)) {
				throw new Error(
					`${url} is outside the allowed domains: ${allowedDomains.join(", ")}.`,
				);
			}
			const response = await session.page.goto(url);
			return answer({
				url: session.page.url(),
				title: await session.page.title(),
				status: response?.status() ?? null,
			});
		}),
	);

	server.registerTool(
		"snapshot",
		{
			title: "Snapshot",
			description:
				"The page as an accessibility tree, with a ref on every element: read this rather " +
				"than a screenshot. Refs last until the next snapshot or navigation. Read only what " +
				"you need: `ref` gives one element's subtree, `depth` stops that many levels down, " +
				"and `find` keeps only the lines containing its text (ignoring case), under their " +
				"named ancestors.",
			inputSchema: {
				session_id: sessionId,
				ref: z
					.string()
					.optional()
					.describe("Only this element and what is inside it."),
				depth: z.number().int().min(1).optional(),
				find: z.string().min(1).optional(),
			},
			annotations: {
				title: "Snapshot",
				readOnlyHint: true,
				openWorldHint: true,
			},
		},
		onSession(
			async (
				session,
				args: {
					session_id: string;
					ref?: string | undefined;
					depth?: number | undefined;
					find?: string | undefined;
				},
			) => {
				const url = session.page.url();
				// Searched once redacted, so `find` cannot test for a secret's value.
				let snapshot = secrets.redact(
					await treeOf(session.page, secrets, args),
				);
				if (args.find !== undefined) {
					snapshot =
						findInTree(snapshot, args.find) ||
						`Nothing here contains ${JSON.stringify(args.find)}.`;
				}
				return answer({
					url,
					title: await session.page.title(),
					...(session.pages.length > 1 ? { tabs: session.pages.length } : {}),
					...(secrets.empty ? {} : { secrets_here: secrets.namesFor(url) }),
					snapshot,
				});
			},
		),
	);

	server.registerTool(
		"click",
		{
			title: "Click",
			description: "Click an element by ref.",
			inputSchema: { session_id: sessionId, ref },
			annotations: { title: "Click", openWorldHint: true },
		},
		onSession(async (session, args: { session_id: string; ref: string }) => {
			await locate(session, args.ref).click();
			return answer({ clicked: args.ref, url: session.page.url() });
		}),
	);

	server.registerTool(
		"type",
		{
			title: "Type",
			description:
				"Type into an element by ref, key by key. `submit` presses Enter afterwards.",
			inputSchema: {
				session_id: sessionId,
				ref,
				text: z.string(),
				submit: z.boolean().optional(),
			},
			annotations: { title: "Type", openWorldHint: true },
		},
		onSession(
			async (
				session,
				args: {
					session_id: string;
					ref: string;
					text: string;
					submit?: boolean | undefined;
				},
			) => {
				if (/<secret[:>]/.test(args.text)) {
					throw new Error(
						"type sends its text as written. type_secret types a secret by name.",
					);
				}
				const target = locate(session, args.ref);
				await target.click();
				await target.pressSequentially(args.text);
				if (args.submit) await target.press("Enter");
				return answer({ typed: args.ref, url: session.page.url() });
			},
		),
	);

	if (!secrets.empty) {
		server.registerTool(
			"type_secret",
			{
				title: "Type a secret",
				description:
					"Type a configured secret into an element by ref, key by key, without seeing it. " +
					"Only on a field whose frame is at a URL the secret is configured for; a one-time " +
					"code secret types the current code. `submit` presses Enter afterwards.",
				inputSchema: {
					session_id: sessionId,
					ref,
					name: z.string().describe("The secret's name, as configured."),
					submit: z.boolean().optional(),
				},
				annotations: { title: "Type a secret", openWorldHint: true },
			},
			onSession(
				async (
					session,
					args: {
						session_id: string;
						ref: string;
						name: string;
						submit?: boolean | undefined;
					},
				) => {
					const target = locate(session, args.ref);
					// The frame the keys go to, which for a field in an iframe is
					// not the page's URL.
					const handle = await target.elementHandle();
					const frame = await handle.ownerFrame();
					await handle.dispose();
					if (!frame) throw new Error(`${args.ref} is no longer in the page.`);
					const value = secrets.valueFor(args.name, frame.url());
					await target.click();
					await target.pressSequentially(value);
					if (args.submit) await target.press("Enter");
					return answer({ typed_secret: args.name, ref: args.ref });
				},
			),
		);
	}

	server.registerTool(
		"select_option",
		{
			title: "Select an option",
			description:
				"Choose options in a <select> by ref, by their label or value. Several for a multiple select.",
			inputSchema: {
				session_id: sessionId,
				ref,
				options: z.array(z.string()).min(1),
			},
			annotations: { title: "Select an option", openWorldHint: true },
		},
		onSession(
			async (
				session,
				args: { session_id: string; ref: string; options: string[] },
			) => {
				const selected = await locate(session, args.ref).selectOption(
					args.options,
				);
				return answer({ selected });
			},
		),
	);

	server.registerTool(
		"press_key",
		{
			title: "Press a key",
			description:
				"Press a key or chord on the focused element, such as Enter, Escape, ArrowDown, Tab or Control+a.",
			inputSchema: { session_id: sessionId, key: z.string() },
			annotations: { title: "Press a key", openWorldHint: true },
		},
		onSession(async (session, args: { session_id: string; key: string }) => {
			await session.page.keyboard.press(args.key);
			return answer({ pressed: args.key, url: session.page.url() });
		}),
	);

	server.registerTool(
		"go_back",
		{
			title: "Go back",
			description: "Go back one page in the tab's history.",
			inputSchema: { session_id: sessionId },
			annotations: { title: "Go back", openWorldHint: true },
		},
		onSession(async (session) => {
			await session.page.goBack();
			return answer({
				url: session.page.url(),
				title: await session.page.title(),
			});
		}),
	);

	server.registerTool(
		"tabs",
		{
			title: "List tabs",
			description:
				"The session's open tabs, by index, and which one the tools act on.",
			inputSchema: { session_id: sessionId },
			annotations: { title: "List tabs", readOnlyHint: true },
		},
		onSession(async (session) =>
			answer({
				tabs: await Promise.all(
					session.pages.map(async (page, index) => ({
						index,
						url: page.url(),
						title: await page.title(),
						current: page === session.page,
					})),
				),
			}),
		),
	);

	server.registerTool(
		"switch_tab",
		{
			title: "Switch tab",
			description:
				"Act on another tab, by its index from tabs; `close` closes the current one first.",
			inputSchema: {
				session_id: sessionId,
				index: z.number().int().min(0),
				close: z.boolean().optional(),
			},
			annotations: { title: "Switch tab" },
		},
		onSession(
			async (
				session,
				args: {
					session_id: string;
					index: number;
					close?: boolean | undefined;
				},
			) => {
				const target = session.pages[args.index];
				if (!target) {
					throw new Error(
						`There is no tab ${args.index}; the session has ${session.pages.length}.`,
					);
				}
				if (args.close && target !== session.page) await session.page.close();
				session.page = target;
				if (session.visible) await target.bringToFront();
				return answer({ url: target.url(), title: await target.title() });
			},
		),
	);

	server.registerTool(
		"scroll",
		{
			title: "Scroll",
			description:
				"Scroll an element into view by ref; with `delta_y`, then wheel that many pixels " +
				"from it (positive is down).",
			inputSchema: {
				session_id: sessionId,
				ref,
				delta_y: z.number().optional(),
			},
			annotations: { title: "Scroll", openWorldHint: true },
		},
		onSession(
			async (
				session,
				args: { session_id: string; ref: string; delta_y?: number | undefined },
			) => {
				const target = locate(session, args.ref);
				await target.scrollIntoViewIfNeeded();
				if (args.delta_y !== undefined) {
					await target.hover();
					await session.page.mouse.wheel(0, args.delta_y);
				}
				return answer({ scrolled: args.ref });
			},
		),
	);

	server.registerTool(
		"hover",
		{
			title: "Hover",
			description: "Move the pointer over an element by ref.",
			inputSchema: { session_id: sessionId, ref },
			annotations: { title: "Hover", openWorldHint: true },
		},
		onSession(async (session, args: { session_id: string; ref: string }) => {
			await locate(session, args.ref).hover();
			return answer({ hovered: args.ref });
		}),
	);

	server.registerTool(
		"screenshot",
		{
			title: "Screenshot",
			description:
				"A PNG of the viewport. Use snapshot unless the pixels themselves matter.",
			inputSchema: { session_id: sessionId },
			annotations: {
				title: "Screenshot",
				readOnlyHint: true,
				openWorldHint: true,
			},
		},
		onSession(async (session) => {
			// Pixels cannot be redacted, so no screenshot while the page holds a
			// secret: the tree has every field's value, masked ones included.
			if (
				!secrets.empty &&
				secrets.contains(await session.page.ariaSnapshot({ mode: "ai" }))
			) {
				throw new Error(
					"The page holds a secret, so it cannot be shown as pixels. snapshot shows it redacted.",
				);
			}
			const image = await session.page.screenshot({ type: "png" });
			return answer({ url: session.page.url() }, [
				{
					type: "image",
					data: image.toString("base64"),
					mimeType: "image/png",
				},
			]);
		}),
	);

	if (uploads) {
		server.registerTool(
			"upload_file",
			{
				title: "Upload files",
				description:
					"Attach files from the uploads directory, by name, to a file input by ref, or to " +
					"the button or field that opens the page's file picker. Several for a multiple input.",
				inputSchema: {
					session_id: sessionId,
					ref,
					files: z
						.array(z.string())
						.min(1)
						.describe("Names inside the uploads directory."),
				},
				annotations: { title: "Upload files", openWorldHint: true },
			},
			onSession(
				async (
					session,
					args: { session_id: string; ref: string; files: string[] },
				) => {
					const paths = args.files.map((name) => uploadable(uploads, name));
					const target = locate(session, args.ref);
					const isInput = await target.evaluate(
						(element) =>
							element instanceof HTMLInputElement && element.type === "file",
					);
					if (isInput) {
						await target.setInputFiles(paths);
					} else {
						// Listening takes the picker over, so no dialog opens.
						const [chooser] = await Promise.all([
							session.page.waitForEvent("filechooser", { timeout: 10_000 }),
							target.click(),
						]);
						await chooser.setFiles(paths);
					}
					return answer({ uploaded: args.files, ref: args.ref });
				},
			),
		);
	}

	server.registerTool(
		"hand_off",
		{
			title: "Hand the window to the person",
			description:
				"Bring a visible session's window to the front for the person to act in: a secret " +
				"that is not configured, a payment, a captcha. Then stop, tell them `reason`, and wait until " +
				"they say they are done; snapshot again before acting, since the page has changed.",
			inputSchema: {
				session_id: sessionId,
				reason: z.string().describe("What the person needs to do."),
			},
			annotations: { title: "Hand the window to the person" },
		},
		onSession(async (session, args: { session_id: string; reason: string }) => {
			if (!session.visible) {
				throw new Error(
					"This session has no window. session_open with visible: true opens one a person can use.",
				);
			}
			await session.page.bringToFront();
			return answer({ handed_off: true, reason: args.reason });
		}),
	);

	server.registerTool(
		"session_close",
		{
			title: "Close a browser session",
			description: "Close the browser.",
			inputSchema: { session_id: sessionId },
			annotations: {
				title: "Close a browser session",
				destructiveHint: true,
				openWorldHint: true,
			},
		},
		onSession(async (session) => {
			sessions.delete(session.id);
			await session.close();
			return answer({ closed: true });
		}),
	);

	return {
		server,
		closeAll: async () => {
			await Promise.allSettled(
				[...sessions.values()].map((session) => session.close()),
			);
		},
	};
}
