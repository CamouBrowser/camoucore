/**
 * Mirrors python/tests/test_cpu_affinity.py: pinning a browser to as many
 * cores as its identity reports.
 */
import { expect, it } from "vitest";
import * as cpuAffinity from "../src/cpu_affinity.js";

it("picks adjacent cores from a random start", () => {
	const cores = Array.from({ length: 16 }, (_, i) => i);
	const picks = new Set<string>();
	for (let n = 0; n < 200; n++) {
		const picked = cpuAffinity.pick(cores, 4);
		expect(picked).toHaveLength(4);
		expect(picked.every((c) => cores.includes(c))).toBe(true);
		expect(
			picked.some((s) =>
				[0, 1, 2, 3].every((i) => picked.includes((s + i) % 16)),
			),
		).toBe(true);
		picks.add(picked.join(","));
	}
	expect(picks.size).toBeGreaterThan(4);
});

it("parses a Linux cpu list", () => {
	expect(cpuAffinity.parseCpuList("0-3,8,10-11\n")).toEqual([
		0, 1, 2, 3, 8, 10, 11,
	]);
});

it("round-trips a Windows affinity mask", () => {
	expect(
		cpuAffinity.maskToCores(cpuAffinity.coresToMask([0, 2, 5, 63])),
	).toEqual([0, 2, 5, 63]);
});

it("does not pin to a count the host cannot narrow to", () => {
	expect(cpuAffinity.pin(process.pid, 0)).toBeNull();
	const host = cpuAffinity.hostCores() ?? [];
	expect(cpuAffinity.pin(process.pid, host.length + 1)).toBeNull();
});

const cores = cpuAffinity.hostCores() ?? [];

it.runIf(process.platform === "linux" && cores.length >= 2)(
	"pins and restores this process on Linux",
	() => {
		const previous = cpuAffinity.pin(process.pid, 1);
		try {
			expect(previous).toEqual(cores);
			expect(cpuAffinity.hostCores()).toHaveLength(1);
		} finally {
			cpuAffinity.restore(process.pid, previous);
		}
		expect(cpuAffinity.hostCores()).toEqual(cores);
	},
);
