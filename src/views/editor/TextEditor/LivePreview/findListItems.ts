/**
 * Pure scanner for `\item` markers inside `itemize`/`enumerate`
 * environments, resolving each item's rendered marker (`•`, `1.`,
 * `(a)`, …) from its nesting context.
 */

import { findEnvironments } from "./findEnvironments";
import type { EnvRange } from "./findEnvironments";

/** One renderable `\item` token found in the document. */
export interface ListItem {
    /** Start offset of the `\item` token. */
    readonly from: number;
    /** End offset of the `\item` token. */
    readonly to: number;
    /** The rendered marker, e.g. `•` or `(a)`. */
    readonly marker: string;
    /** 1-based list nesting depth (innermost list environments). */
    readonly depth: number;
}

/** Matches an `\item` token (but not `\itemsep`, `\itemize`, …). */
const ITEM_PATTERN = /\\item(?![a-zA-Z])/g;

/** Bullet glyphs by list depth, cycling for deeper nesting. */
const BULLETS = ["•", "◦", "▪"];

/**
 * Finds every renderable `\item` in the document with its marker.
 *
 * Skipped (the source stays raw): items outside any `itemize`/
 * `enumerate` environment, items with a custom label (`\item[...]`),
 * and escaped tokens.
 *
 * @param docText - The full document text.
 * @returns The items found, in order of appearance.
 */
export function findListItems(docText: string): readonly ListItem[] {
    const listEnvs = findEnvironments(docText).filter(
        (env) => env.name === "itemize" || env.name === "enumerate",
    );
    if (listEnvs.length === 0) return [];

    const items: ListItem[] = [];
    const countersByEnv = new Map<EnvRange, number>();

    for (const match of docText.matchAll(ITEM_PATTERN)) {
        const matchStart = match.index;
        if (matchStart === undefined) continue;

        // `\\item` is a line break followed by the word "item".
        if (matchStart > 0 && docText[matchStart - 1] === "\\") continue;

        const innermost = findInnermostList(listEnvs, matchStart);
        if (!innermost) continue;

        const tokenEnd = matchStart + match[0].length;
        const custom = matchCustomLabel(docText, tokenEnd);

        const index = (countersByEnv.get(innermost) ?? 0) + 1;
        countersByEnv.set(innermost, index);

        const depth = countContaining(listEnvs, matchStart);

        // A custom label replaces the marker outright and does not
        // consume a counter position in LaTeX either — but the counter
        // is already advanced above, matching how LaTeX still counts
        // the item for `\ref` purposes.
        const marker =
            custom?.label ??
            (innermost.name === "itemize"
                ? bulletForDepth(depth)
                : enumerateLabel(countEnumerateDepth(listEnvs, matchStart), index));

        items.push({
            from: matchStart,
            to: custom?.to ?? tokenEnd,
            marker,
            depth,
        });
    }

    return items;
}

/** An `\item[...]` custom label and where it ends. */
interface CustomLabel {
    /** The label text to render in place of the marker. */
    readonly label: string;
    /** Offset just past the closing `]`. */
    readonly to: number;
}

/**
 * Matches an `\item`'s optional label.
 *
 * Leading whitespace is spaces and tabs only — `\s` would match a
 * newline, and a bracket on the following line belongs to the item's
 * text, not to `\item`.
 */
const CUSTOM_LABEL_PATTERN = /^[ \t]*\[([^\]\n]*)\]/;

/**
 * Reads the optional label following an `\item` token.
 *
 * @param docText - The full document text.
 * @param tokenEnd - Offset just past `\item`.
 * @returns The label, or null when there is none or it is empty.
 */
function matchCustomLabel(docText: string, tokenEnd: number): CustomLabel | null {
    const match = CUSTOM_LABEL_PATTERN.exec(docText.slice(tokenEnd));
    if (!match) return null;

    const label = match[1]?.trim();
    if (!label) return null;

    return { label, to: tokenEnd + match[0].length };
}

/**
 * Builds the label for an enumerate item, following LaTeX's counter
 * styles (`enumi` … `enumiv`).
 *
 * @param enumDepth - 1-based nesting depth counting enumerate
 *   environments only.
 * @param index - The item's 1-based position within its environment.
 * @returns The rendered label, e.g. `1.`, `(a)`, `iii.`.
 */
export function enumerateLabel(enumDepth: number, index: number): string {
    if (enumDepth === 1) return `${index}.`;

    if (enumDepth === 2) return `(${alphabetic(index)})`;

    if (enumDepth === 3) return `${toRoman(index)}.`;

    return `${alphabetic(index).toUpperCase()}.`;
}

/**
 * Finds the innermost list environment whose body contains `position`.
 *
 * @param listEnvs - The list environments to search.
 * @param position - A document offset.
 * @returns The smallest containing environment, or null.
 */
function findInnermostList(listEnvs: readonly EnvRange[], position: number): EnvRange | null {
    let innermost: EnvRange | null = null;

    for (const env of listEnvs) {
        if (position < env.beginTo || position >= env.endFrom) continue;

        if (!innermost || env.endFrom - env.beginTo < innermost.endFrom - innermost.beginTo) {
            innermost = env;
        }
    }

    return innermost;
}

/**
 * Counts the list environments containing `position`.
 *
 * @param listEnvs - The list environments to search.
 * @param position - A document offset.
 * @returns The 1-based nesting depth at that offset.
 */
function countContaining(listEnvs: readonly EnvRange[], position: number): number {
    return listEnvs.filter((env) => position >= env.beginTo && position < env.endFrom).length;
}

/**
 * Counts enumerate nesting for label style, mirroring LaTeX's
 * `enumi`…`enumiv` counters (itemize levels do not advance them).
 * Only called for items whose innermost env is enumerate, so the
 * result is always >= 1.
 *
 * @param listEnvs - The list environments to search.
 * @param position - The item's document offset.
 * @returns 1-based enumerate depth.
 */
function countEnumerateDepth(listEnvs: readonly EnvRange[], position: number): number {
    return listEnvs.filter(
        (env) =>
            env.name === "enumerate" && position >= env.beginTo && position < env.endFrom,
    ).length;
}

/**
 * Picks the bullet glyph for an itemize depth, cycling past the end.
 *
 * @param depth - 1-based list nesting depth.
 * @returns The bullet glyph.
 */
function bulletForDepth(depth: number): string {
    return BULLETS[(depth - 1) % BULLETS.length] ?? "•";
}

/**
 * Converts a 1-based index to an alphabetic label (1 → a, 27 → aa).
 *
 * @param index - The 1-based index.
 * @returns The lowercase alphabetic label.
 */
function alphabetic(index: number): string {
    const letter = String.fromCharCode(97 + ((index - 1) % 26));
    return letter.repeat(Math.floor((index - 1) / 26) + 1);
}

/** Roman numeral building blocks, largest first. */
const ROMAN_NUMERALS: readonly (readonly [number, string])[] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
];

/**
 * Converts a positive integer to lowercase roman numerals.
 *
 * @param value - The value to convert (>= 1).
 * @returns The roman-numeral string.
 */
function toRoman(value: number): string {
    let remaining = value;
    let result = "";

    for (const [amount, numeral] of ROMAN_NUMERALS) {
        while (remaining >= amount) {
            result += numeral;
            remaining -= amount;
        }
    }

    return result;
}

