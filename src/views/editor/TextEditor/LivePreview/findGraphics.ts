/**
 * Pure scanner for `\includegraphics` commands, rendered as inline
 * images (or a placeholder when the file cannot be resolved).
 */

/** One `\includegraphics` command found in the scanned text. */
export interface GraphicsRange {
    /** Start offset of the command, including the backslash. */
    readonly from: number;
    /** End offset, just past the closing `}`. */
    readonly to: number;
    /** The image path exactly as written in the source. */
    readonly path: string;
    /** The optional argument's contents (`width=5cm`), or null. */
    readonly options: string | null;
}

/** A half-open interval used for exclusion. */
interface Interval {
    readonly from: number;
    readonly to: number;
}

/**
 * Matches `\includegraphics` with an optional argument and a
 * brace-delimited path. Paths never contain braces or newlines, so no
 * brace matching is needed.
 */
const GRAPHICS_PATTERN = /\\includegraphics(?:\[([^\]\n]*)\])?\{([^{}\n]+)\}/g;

/**
 * Scans text for `\includegraphics` commands.
 *
 * Skipped (the source stays raw): escaped commands, commands starting
 * inside `exclude` intervals, and empty or whitespace-only paths.
 *
 * @param text - The text to scan.
 * @param offset - Document position of `text[0]`.
 * @param exclude - Document-position intervals to skip (math ranges).
 * @returns The commands found, in order of appearance.
 */
export function findGraphicsRanges(
    text: string,
    offset: number,
    exclude: readonly Interval[],
): readonly GraphicsRange[] {
    const ranges: GraphicsRange[] = [];

    for (const match of text.matchAll(GRAPHICS_PATTERN)) {
        const rawPath = match[2];
        const matchStart = match.index;
        if (rawPath === undefined || matchStart === undefined) continue;

        // `\\includegraphics` is a line break followed by a word.
        if (matchStart > 0 && text[matchStart - 1] === "\\") continue;

        const path = rawPath.trim();
        if (path.length === 0) continue;

        const from = offset + matchStart;
        if (exclude.some((interval) => interval.from <= from && interval.to > from)) continue;

        const options = match[1] ?? null;

        ranges.push({ from, to: from + match[0].length, path, options });
    }

    return ranges;
}
