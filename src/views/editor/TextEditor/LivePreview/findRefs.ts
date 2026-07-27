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
 * Matches any command with a braced argument; {@link REF_KINDS} then
 * decides whether it is one we render. Up to two optional `[...]`
 * arguments are allowed — biblatex takes a prenote and a postnote, as
 * in `\citep[see][p.~3]{key}` — plus, for `\href`, a second brace
 * group. Arguments never contain braces, so no brace matching is
 * needed.
 */
const REF_PATTERN =
    /\\([a-zA-Z]+)(?:\[([^\]\n]*)\])?(?:\[([^\]\n]*)\])?\{([^{}\n]*)\}(?:\{([^{}\n]*)\})?/g;

/** Command name → reference kind (narrows the regex capture's type). */
const REF_KINDS: Record<string, RefKind> = {
    ref: "ref",
    eqref: "eqref",
    label: "label",
    url: "url",
    href: "href",
    footnote: "footnote",

    // The cite family. LaTeX and biblatex between them offer a long
    // list of spellings for "cite this"; they differ in how the
    // bibliography renders them, not in what the argument means, so
    // the preview treats them alike.
    cite: "cite",
    Cite: "cite",
    citep: "cite",
    citet: "cite",
    citealt: "cite",
    citealp: "cite",
    citeauthor: "cite",
    citeyear: "cite",
    citeyearpar: "cite",
    nocite: "cite",
    parencite: "cite",
    Parencite: "cite",
    textcite: "cite",
    Textcite: "cite",
    autocite: "cite",
    Autocite: "cite",
    footcite: "cite",
    smartcite: "cite",
    supercite: "cite",
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
        const firstArgument = match[4];
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

        // `\href{url}{text}` puts its link text in the second brace
        // group; everything else uses `[...]` for a locator. With two
        // optional arguments the second is the postnote — the page
        // reference a reader actually wants to see.
        const secondBraceGroup = match[5];
        const locator = match[3] ?? match[2] ?? null;
        const note = kind === "href" ? (secondBraceGroup ?? null) : locator;

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
