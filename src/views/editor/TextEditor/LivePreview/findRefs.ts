/**
 * Pure scanner for reference-like commands (`\ref{...}`, `\eqref{...}`,
 * `\cite{...}`, `\label{...}`), rendered as small chips.
 */

/** The kind of reference command found. */
export type RefKind = "ref" | "eqref" | "cite" | "label" | "url" | "href" | "footnote";

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
    /**
     * The optional argument's contents (`\cite[p.3]{k}`), or null. Not
     * a key — a page locator, or `\href`'s link text.
     */
    readonly note: string | null;
    /** For `url`/`href`, the target address; null otherwise. */
    readonly target: string | null;
}

/** A half-open interval used for exclusion. */
interface Interval {
    readonly from: number;
    readonly to: number;
}

/**
 * Matches a whole reference command, with an optional `[...]` argument
 * and, for `\href`, a second brace group. Arguments never contain
 * braces, so no brace matching is needed.
 */
const REF_PATTERN =
    /\\(ref|eqref|citep|citet|cite|label|url|href|footnote)(?:\[([^\]\n]*)\])?\{([^{}\n]*)\}(?:\{([^{}\n]*)\})?/g;

/** Command name → reference kind (narrows the regex capture's type). */
const REF_KINDS: Record<string, RefKind> = {
    ref: "ref",
    eqref: "eqref",
    cite: "cite",
    citep: "cite",
    citet: "cite",
    label: "label",
    url: "url",
    href: "href",
    footnote: "footnote",
};

/** Kinds whose argument is a single opaque string, not a key list. */
const SINGLE_ARGUMENT_KINDS: ReadonlySet<RefKind> = new Set([
    "url",
    "href",
    "footnote",
]);

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
        const firstArgument = match[3];
        const matchStart = match.index;
        if (kind === undefined || firstArgument === undefined || matchStart === undefined) {
            continue;
        }

        // `\\ref` is a line break followed by the word "ref".
        if (matchStart > 0 && text[matchStart - 1] === "\\") continue;

        const from = offset + matchStart;
        if (exclude.some((interval) => interval.from <= from && interval.to > from)) continue;

        const keys = splitKeys(kind, firstArgument);
        if (keys.length === 0) continue;

        // `\href{url}{text}` puts its link text in the second group;
        // everything else uses `[...]` for a locator.
        const secondArgument = match[4];
        const note = kind === "href" ? (secondArgument ?? null) : (match[2] ?? null);

        ranges.push({
            kind,
            from,
            to: from + match[0].length,
            keys,
            note: note === "" ? null : note,
            target: kind === "url" || kind === "href" ? firstArgument.trim() : null,
        });
    }

    return ranges;
}

/**
 * Splits a command's first argument into displayable keys.
 *
 * Citation keys are comma-separated; a URL or footnote body is one
 * opaque string that must not be split on its commas.
 *
 * @param kind - The command kind.
 * @param argument - The raw first argument.
 * @returns The keys, empty when the argument is blank.
 */
function splitKeys(kind: RefKind, argument: string): readonly string[] {
    if (SINGLE_ARGUMENT_KINDS.has(kind)) {
        const trimmed = argument.trim();
        return trimmed.length > 0 ? [trimmed] : [];
    }

    return argument
        .split(",")
        .map((key) => key.trim())
        .filter((key) => key.length > 0);
}
