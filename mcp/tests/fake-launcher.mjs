/**
 * A launcher with no browser behind it, for driving the server over the
 * protocol. Everything the page is asked goes to `calls` and, when
 * FAKE_LAUNCHER_LOG is set, to that file, since a spawned server's calls are
 * in another process.
 */
import fs from "node:fs";

export const calls = [];

/**
 * What the fake page shows: its accessibility tree, and whether an element a
 * file is uploaded to is the file input itself rather than a picker button.
 */
export const page = {
	tree: '- button "Go" [ref=e2]',
	fileInput: true,
	/**
	 * A URL the main frame commits to while the next snapshot is read, which
	 * then fails as Playwright's does when a frame detaches under it.
	 */
	navigatesDuringSnapshot: undefined,
};

function note(entry) {
	calls.push(entry);
	if (process.env.FAKE_LAUNCHER_LOG)
		fs.appendFileSync(
			process.env.FAKE_LAUNCHER_LOG,
			`${JSON.stringify(entry)}\n`,
		);
}

// Real launchers print on import and on launch; the server must keep it off
// the protocol.
console.log("launcher chatter on import");

export const PRODUCT = {
	name: "camoutest",
	title: "Camoutest",
	engine: { name: "firefox" },
};

function fakePage() {
	let url = "about:blank";
	const listeners = {};
	const mainFrame = { url: () => url };
	const locator = (selector) => {
		const act = (action) => async (argument) => {
			if (selector === "aria-ref=gone")
				throw new Error("Element is not attached: stale ref");
			note({ action, selector, argument });
		};
		return {
			click: act("click"),
			hover: act("hover"),
			pressSequentially: act("pressSequentially"),
			press: act("press"),
			scrollIntoViewIfNeeded: act("scrollIntoViewIfNeeded"),
			ariaSnapshot: async (options) => {
				note({ action: "ariaSnapshot", selector, options });
				return page.tree;
			},
			evaluate: async () => page.fileInput,
			setInputFiles: act("setInputFiles"),
			selectOption: async (values) => {
				note({ action: "selectOption", selector, argument: values });
				return values;
			},
		};
	};
	return {
		goto: async (target) => {
			note({ action: "goto", url: target });
			url = target;
			return { status: () => 200 };
		},
		url: () => url,
		title: async () => "A page",
		ariaSnapshot: async (options) => {
			note({ action: "ariaSnapshot", options });
			const target = page.navigatesDuringSnapshot;
			if (target) {
				page.navigatesDuringSnapshot = undefined;
				url = target;
				for (const listener of listeners.framenavigated ?? [])
					listener(mainFrame);
				throw new Error("locator.all: Frame was detached");
			}
			return page.tree;
		},
		waitForEvent: async (event) => ({
			setFiles: async (files) =>
				note({ action: "chooserSetFiles", event, files }),
		}),
		locator,
		bringToFront: async () => note({ action: "bringToFront" }),
		screenshot: async () => Buffer.from("not really a png"),
		mouse: { wheel: async (x, y) => note({ action: "wheel", x, y }) },
		keyboard: { press: async (key) => note({ action: "key", key }) },
		goBack: async () => note({ action: "goBack" }),
		on: (event, listener) => {
			(listeners[event] ??= []).push(listener);
		},
		mainFrame: () => mainFrame,
		context: () => ({ on: () => {} }),
		frames: () => [],
	};
}

export async function NewBrowser(browserType, options) {
	note({ action: "launch", engine: browserType.name?.(), options });
	process.stdout.write("launcher chatter on launch\n");
	const listeners = [];
	const end = () => {
		for (const listener of listeners) listener();
	};
	const close = async () => {
		note({ action: "close" });
		end();
	};
	// As Playwright does: a persistent launch is the profile's context, open
	// with one tab, and it ends with "close" rather than "disconnected".
	if (options.persistent_context) {
		const page = fakePage();
		return {
			pages: () => [page],
			newPage: async () => fakePage(),
			on: (event, listener) => {
				if (event === "close") listeners.push(listener);
			},
			close: async () => {
				note({ action: "close" });
				// Playwright says "close" before the browser has let go of its
				// profile; a removal then would race the browser's last writes.
				end();
				fs.writeFileSync(`${options.user_data_dir}/sessionstore.jsonlz4`, "");
			},
			crash: end,
		};
	}
	return {
		newPage: async () => fakePage(),
		on: (event, listener) => {
			if (event === "disconnected") listeners.push(listener);
		},
		close,
		/** Ends the browser the way a crash does, without close(). */
		crash: end,
	};
}
