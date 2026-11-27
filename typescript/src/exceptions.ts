/**
 * TypeScript twin of python/src/camoucore/exceptions.py.
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

export class CannotFindVfb extends VirtualDisplayError {
	constructor(message?: string) {
		super(message ?? "vfb cannot be found.");
		this.name = "CannotFindVfb";
	}
}

export class CannotExecuteVfb extends VirtualDisplayError {
	constructor(message?: string) {
		super(message ?? "vfb cannot be executed.");
		this.name = "CannotExecuteVfb";
	}
}

export class VirtualDisplayNotSupported extends VirtualDisplayError {
	constructor(message?: string) {
		super(
			message ??
				"A virtual display was asked for in a form this system can't give.",
		);
		this.name = "VirtualDisplayNotSupported";
	}
}
