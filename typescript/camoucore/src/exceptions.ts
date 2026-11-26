/**
 * TypeScript twin of python/camoucore/src/camoucore/exceptions.py.
 */

export class CorruptedDownload extends Error {
	constructor(message?: string) {
		super(
			message ??
				"A downloaded asset does not match its expected sha256 digest.",
		);
		this.name = "CorruptedDownload";
	}
}

export class UnsupportedOS extends Error {
	constructor(message?: string) {
		super(message ?? "The OS is not supported.");
		this.name = "UnsupportedOS";
	}
}

export class LocaleError extends Error {
	constructor(message?: string) {
		super(message ?? "The locale is invalid.");
		this.name = "LocaleError";
	}
}

export class InvalidIP extends Error {
	constructor(message?: string, options?: ErrorOptions) {
		super(message ?? "An IP address is invalid.", options);
		this.name = "InvalidIP";
	}
}

export class InvalidProxy extends Error {
	constructor(message?: string, options?: ErrorOptions) {
		super(message ?? "A proxy is invalid.", options);
		this.name = "InvalidProxy";
	}
}

export class UnknownIPLocation extends LocaleError {
	constructor(message?: string) {
		super(message ?? "The location of an IP is unknown.");
		this.name = "UnknownIPLocation";
	}
}

export class InvalidLocale extends LocaleError {
	constructor(message?: string) {
		super(message ?? "The locale input is invalid.");
		this.name = "InvalidLocale";
	}

	static invalidInput(locale: string): InvalidLocale {
		return new InvalidLocale(
			`Invalid locale: '${locale}'. Must be either a region, language, language-region, or language-script-region.`,
		);
	}
}

export class UnknownTerritory extends InvalidLocale {
	constructor(message?: string) {
		super(message ?? "The territory is unknown.");
		this.name = "UnknownTerritory";
	}
}

export class UnknownLanguage extends InvalidLocale {
	constructor(message?: string) {
		super(message ?? "The language is unknown.");
		this.name = "UnknownLanguage";
	}
}

export class NotInstalledGeoIPExtra extends Error {
	constructor(message?: string) {
		super(message ?? "The GeoIP database reader is not available.");
		this.name = "NotInstalledGeoIPExtra";
	}
}

export class VirtualDisplayError extends Error {
	constructor(message?: string) {
		super(message ?? "There is an error with the virtual display.");
		this.name = "VirtualDisplayError";
	}
}

export class CannotFindXvfb extends VirtualDisplayError {
	constructor(message?: string) {
		super(message ?? "Xvfb cannot be found.");
		this.name = "CannotFindXvfb";
	}
}

export class CannotExecuteXvfb extends VirtualDisplayError {
	constructor(message?: string) {
		super(message ?? "Xvfb cannot be executed.");
		this.name = "CannotExecuteXvfb";
	}
}

export class VirtualDisplayNotSupported extends VirtualDisplayError {
	constructor(message?: string) {
		super(
			message ?? "The user tried to use a virtual display on a non-Linux OS.",
		);
		this.name = "VirtualDisplayNotSupported";
	}
}

/**
 * A Pro launch option, before Pro opens. The message names the page where an
 * account is made and the waitlist joined.
 */
export class ProNotLaunched extends Error {
	constructor(
		readonly option: string,
		title: string,
		readonly url: string,
	) {
		super(
			`${option} is a ${title} Pro option, and ${title} Pro has not launched yet. ` +
				`Make your account at ${url} to join the waitlist and be told the day ` +
				`it opens; ${title} itself stays free.`,
		);
		this.name = "ProNotLaunched";
	}
}

/**
 * Captcha solving was asked for and no key or server was given. The message
 * lists the ways to get one, a free account first.
 */
export class CaptchaKeyMissing extends Error {
	constructor(
		message: string,
		readonly url: string,
	) {
		super(message);
		this.name = "CaptchaKeyMissing";
	}
}

/** Captcha solving was asked for and the captchakraken client is not installed. */
export class CaptchaKrakenMissing extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "CaptchaKrakenMissing";
	}
}
