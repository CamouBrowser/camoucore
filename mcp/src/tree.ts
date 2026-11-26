/**
 * Narrowing an accessibility tree to what the agent asked for, so a large page
 * is not read whole for every question about it.
 */

/** Containers that only nest other elements: no name, no value, no text. */
const BARE =
	/^- (generic|group|none|presentation|list|listitem|rowgroup)( \[ref=\w+\])?:?$/;

const indentOf = (line: string) => line.length - line.trimStart().length;

/**
 * The lines of `tree` that contain `needle`, ignoring case, each under its
 * ancestors so it is clear where it sits. Ancestors that are only containers
 * are left out, since they say nothing and a deep page has many of them.
 */
export function findInTree(tree: string, needle: string): string {
	const lines = tree.split("\n");
	const wanted = needle.toLowerCase();
	const keep = new Set<number>();
	lines.forEach((line, index) => {
		if (!line.toLowerCase().includes(wanted)) return;
		keep.add(index);
		let level = indentOf(line);
		for (let above = index - 1; above >= 0 && level > 0; above--) {
			const candidate = lines[above];
			const depth = indentOf(candidate);
			if (depth >= level || !candidate.trim()) continue;
			level = depth;
			if (!BARE.test(candidate.trim())) keep.add(above);
		}
	});
	return [...keep]
		.sort((a, b) => a - b)
		.map((index) => lines[index])
		.join("\n");
}
