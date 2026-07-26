/**
 * Pure scanner for inline text-formatting commands (`\textbf{...}`,
 * `\textit{...}`, `\emph{...}`, `\underline{...}`).
 *
 * Nesting needs no special handling: `\textbf{\emph{x}}` yields two
 * independent ranges, and the resulting content marks nest naturally
 * while the hidden command tokens never overlap each other.
 */

import { findGroupEnd } from "./braces";

/** The visual style a formatting command applies. */
export type FormatStyle =
    | "bold"
    | "italic"
    | "underline"
    | "mono"
    | "smallcaps"
    | "sans"
    | "strike"
    | "superscript"
    | "subscript";

/** One formatting command found in the scanned text. */
export interface FormatRange {
    /** The style to apply to the content. */
    readonly style: FormatStyle;
    /** Start offset of the command, including the backslash. */
    readonly from: number;
    /** End offset, just past the closing `}`. */
    readonly to: number;
    /** Start offset of the content, just past the opening `{`. */
    readonly contentFrom: number;
    /** End offset of the content, at the closing `}`. */
    readonly contentTo: number;
}

/** A half-open interval used for exclusion. */
interface Interval {
    readonly from: number;
    readonly to: number;
}

/**
 * Command name → applied style.
 *
 * `\textsuperscript` precedes `\textsc` in the pattern below purely
 * because the regex alternation is first-match; the map itself has no
 * ordering significance.
 */
const FORMAT_STYLES: Record<string, FormatStyle> = {
    textbf: "bold",
    textit: "italic",
    emph: "italic",
    underline: "underline",
    texttt: "mono",
    textsc: "smallcaps",
    textsf: "sans",
    textrm: "sans",
    sout: "strike",
    textsuperscript: "superscript",
    textsubscript: "subscript",
};

/**
 * Matches the head of a formatting command up to its opening brace.
 *
 * Alternatives are ordered longest-first so `\textsuperscript` is not
 * matched as `\textsc` followed by stray text.
 */
const FORMAT_PATTERN = new RegExp(
    `\\\\(${Object.keys(FORMAT_STYLES)
        .sort((left, right) => right.length - left.length)
        .join("|")})\\{`,
    "g",
);

/**
 * Scans text for renderable formatting commands.
 *
 * Skipped (the source stays raw): escaped commands, commands starting
 * inside `exclude` intervals (math — KaTeX renders those itself),
 * unclosed braces, content spanning a line break (visible-range
 * chunks are line-bounded, so multi-line content could be cut at a
 * chunk edge), and empty content.
 *
 * @param text - The text to scan.
 * @param offset - Document position of `text[0]`.
 * @param exclude - Document-position intervals to skip (math ranges).
 * @returns The formatting commands found, in order of appearance.
 */
export function findFormatRanges(
    text: string,
    offset: number,
    exclude: readonly Interval[],
): readonly FormatRange[] {
    const ranges: FormatRange[] = [];

    for (const match of text.matchAll(FORMAT_PATTERN)) {
        const commandName = match[1];
        const matchStart = match.index;
        if (commandName === undefined || matchStart === undefined) continue;

        const style = FORMAT_STYLES[commandName];
        if (style === undefined) continue;

        // `\\textbf` is a line break followed by the word "textbf".
        if (matchStart > 0 && text[matchStart - 1] === "\\") continue;

        const from = offset + matchStart;
        if (exclude.some((interval) => interval.from <= from && interval.to > from)) continue;

        const openBrace = matchStart + match[0].length - 1;
        const closeBrace = findGroupEnd(text, openBrace);
        if (closeBrace === -1) continue;

        const content = text.slice(openBrace + 1, closeBrace);
        if (content.includes("\n")) continue;
        if (content.trim() === "") continue;

        ranges.push({
            style,
            from,
            to: offset + closeBrace + 1,
            contentFrom: offset + openBrace + 1,
            contentTo: offset + closeBrace,
        });
    }

    return ranges;
}
