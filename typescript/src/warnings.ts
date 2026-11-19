/**
 * The warning channel every launcher on camoucore reports through, and the
 * core's own messages (warnings.yml).
 *
 * TypeScript twin of python/src/camoucore/_warnings.py. Python routes these
 * through the `warnings` module; the Node equivalent is `process.emitWarning`,
 * which prints `(node:<pid>) <Category>: <message>` to stderr and fires
 * `process.on("warning")`. Python's `warnings.catch_warnings(record=True)` is
 * `recordWarnings()` here. A launcher emits through this module's `warn`, so
 * one recorder sees the core's warnings and the launcher's.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { loadDataFile } from "./data.js";

let warningsData: Record<string, string> | undefined;

/** camoucore's warnings.yml, loaded once. */
export function loadWarnings(): Record<string, string> {
	warningsData ??= loadDataFile<Record<string, string>>("warnings.yml");
	return warningsData;
}

export interface RecordedWarning {
	category: string;
	message: string;
}

const recorder = new AsyncLocalStorage<RecordedWarning[]>();

/**
 * Emit a warning. While a `recordWarnings()` block is active the warning is
 * captured instead of printed, as Python's catch_warnings(record=True) does.
 */
export function warn(message: string, category = "RuntimeWarning"): void {
	const captured = recorder.getStore();
	if (captured) {
		captured.push({ category, message });
		return;
	}
	process.emitWarning(message, { type: category });
}

/**
 * Run `fn`, capturing every warning it emits (sync or async) instead of
 * printing it. Scoped by AsyncLocalStorage, so concurrent work outside the
 * block is not captured; nested blocks capture into the innermost one.
 */
export async function recordWarnings<T>(
	fn: () => T | Promise<T>,
): Promise<{ result?: T; error?: unknown; warnings: RecordedWarning[] }> {
	const captured: RecordedWarning[] = [];
	try {
		return { result: await recorder.run(captured, fn), warnings: captured };
	} catch (error) {
		return { error, warnings: captured };
	}
}

/**
 * Emitted when a caller has a setting enabled that can cause detection.
 */
export class LeakWarning extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LeakWarning";
	}

	/**
	 * Warns the caller if a passed parameter can cause leaks. `warning` is the
	 * message itself: each launcher words its own.
	 */
	static warn(warning: string, iKnowWhatImDoing?: boolean): void {
		if (iKnowWhatImDoing) {
			return;
		}
		if (iKnowWhatImDoing !== undefined) {
			warning += "\nIf this is intentional, pass `i_know_what_im_doing=True`.";
		}
		warn(warning, "LeakWarning");
	}
}
