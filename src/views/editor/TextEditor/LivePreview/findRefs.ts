/**
 * Pure scanner for reference-like commands (`\ref{...}`, `\eqref{...}`,
 * `\cite{...}`, `\label{...}`), rendered as small chips.
 */

/** The kind of reference command found. */
export type RefKind = "ref" | "eqref" | "cite" | "label";

/** One reference command found in the scanned text. */
export interface RefRange {
    /** Which command was matched. */
    readonly kind: RefKind;
    /** Start offset of the command, including the backslash. */
    readonly from: number;
    /** End offset, just past the closing `}`. */
    readonly to: number;
    /** The referenced keys (`\cite{a,b}` yields two). */
    readonly keys: readonly string[];
}

/** A half-open interval used for exclusion. */
interface Interval {
    readonly from: number;
    readonly to: number;
}

/**
 * Matches a whole reference command. Keys never contain braces, so no
 * brace matching is needed; optional arguments (`\cite[p.3]{k}`)
 * intentionally fail to match and stay raw.
 */
const REF_PATTERN = /\\(ref|eqref|cite|label)\{([^{}\n]*)\}/g;

/** Command name → reference kind (narrows the regex capture's type). */
const REF_KINDS: Record<string, RefKind> = {
    ref: "ref",
    eqref: "eqref",
    cite: "cite",
    label: "label",
};

/**
 * Scans text for renderable reference commands.
 *
 * Skipped (the source stays raw): escaped commands, commands starting
 * inside `exclude` intervals (math — `\eqref` there is KaTeX's job),
 * and empty or whitespace-only key lists.
 *
 * @param text - The text to scan.
 * @param offset - Document position of `text[0]`.
 * @param exclude - Document-position intervals to skip (math ranges).
 * @returns The reference commands found, in order of appearance.
 */
export function findRefRanges(
    text: string,
    offset: number,
    exclude: readonly Interval[],
): readonly RefRange[] {
    const ranges: RefRange[] = [];

    for (const match of text.matchAll(REF_PATTERN)) {
        const kind = REF_KINDS[match[1] ?? ""];
        const keyList = match[2];
        const matchStart = match.index;
        if (kind === undefined || keyList === undefined || matchStart === undefined) continue;

        // `\\ref` is a line break followed by the word "ref".
        if (matchStart > 0 && text[matchStart - 1] === "\\") continue;

        const from = offset + matchStart;
        if (exclude.some((interval) => interval.from <= from && interval.to > from)) continue;

        const keys = keyList
            .split(",")
            .map((key) => key.trim())
            .filter((key) => key.length > 0);
        if (keys.length === 0) continue;

        ranges.push({ kind, from, to: from + match[0].length, keys });
    }

    return ranges;
}
