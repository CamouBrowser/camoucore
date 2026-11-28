/**
 * The launcher writes only config keys a released browser reads. Twin of
 * test_no_launch_writes_a_key_the_release_lacks in
 * python/camoucore/tests/camoufox/test_removed_config_keys.py.
 *
 * Real draws on every host, validated strictly (CAMOUFOX_STRICT_CONFIG)
 * against the newest release's properties.json, the snapshot the Python suite
 * keeps in python/camoucore/tests/camoufox/data: a writer for any other key
 * throws UnknownProperty.
 */
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	BUNDLE,
	quietly,
	restoreDeps,
	stubHost,
	utils,
} from "./launch-host.js";

const { MODEL } = await import("./fpgen-setup.js");

const SNAPSHOT = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"python",
	"camoucore",
	"tests",
	"camoufox",
	"data",
	"properties.json",
);

// The keys 0.6.0 wrote that v159.0-beta.43, the newest release, does not read.
const UNRELEASED_KEYS = [
	"AudioContext:outputLatencyDelayMs",
	"fonts:metrics",
	"fonts:windowsAliasLoadMs",
	"fonts:windowsCmapLoadMs",
	"geolocation:systemPermission",
	"media:hwCodecs",
	"mediaDevices:microphoneChannels",
	"mediaDevices:webcamMaxFrameRates",
	"mediaDevices:webcamMaxHeights",
	"mediaDevices:webcamMaxWidths",
	"webrtc:hostipv6",
];

const deps = utils.utilsDeps;
let strictBefore: string | undefined;
beforeAll(() => {
	strictBefore = process.env.CAMOUFOX_STRICT_CONFIG;
	process.env.CAMOUFOX_STRICT_CONFIG = "1";
});
afterAll(() => {
	if (strictBefore === undefined) delete process.env.CAMOUFOX_STRICT_CONFIG;
	else process.env.CAMOUFOX_STRICT_CONFIG = strictBefore;
});
afterEach(() => restoreDeps());

describe.skipIf(!MODEL.ok)("no launch writes a key the release lacks", () => {
	for (const host of ["lin", "win", "mac"] as const) {
		for (const os of ["windows", "macos", "linux"]) {
			it(`a ${os} identity on a ${host} host`, async () => {
				stubHost();
				deps.hostOsKey = () => host;
				deps.addDefaultAddons = async () => undefined;
				deps.installedVerStr = () => "159.0-beta.43";
				deps.getPath = ((file: string) =>
					file === "properties.json"
						? SNAPSHOT
						: path.join(BUNDLE, file)) as any;
				let sent: Record<string, any> = {};
				deps.getEnvVars = ((config: Record<string, any>) => {
					sent = { ...config };
					return {};
				}) as any;
				for (let i = 0; i < 5; i++) {
					sent = {};
					await quietly(() =>
						utils.launchOptions({
							os,
							headless: true,
							i_know_what_im_doing: true,
						}),
					);
					expect(Object.keys(sent).length).toBeGreaterThan(0);
					expect(UNRELEASED_KEYS.filter((k) => k in sent)).toEqual([]);
				}
			});
		}
	}
});
