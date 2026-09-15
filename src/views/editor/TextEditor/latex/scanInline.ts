/**
 * The order the inline scanners run in, and what each one is allowed to
 * look at.
 *
 * This matters more than it looks. The scanners overlap: `\alpha` is a
 * symbol, but inside `$…$` it belongs to KaTeX; `\textbf` is formatting,
 * but inside `\includegraphics{...}` it is a filename. What any given
 * construct renders as therefore depends entirely on which scanner got
 * to claim it first — so the *sequence* is a behavioural contract, not
 * an implementation detail.
 *
 * It had been written twice, and the two copies disagreed. The preview
 * excluded only math from formatting and refs; the table-cell renderer
 * excluded math *and* refs from formatting, then excluded formatting
 * from symbols too — so a `\alpha` inside `\textbf{...}` rendered as a
 * glyph in the document and stayed raw in a table. Same document, two
 * answers, depending on where the text sat.
 *
 * One sequence, here, so a cell shows what its content means everywhere
 * else.
 */

import { findFormatRanges } from "./findFormatting";
import type { FormatRange } from "./findFormatting";
import { findGraphicsRanges } from "./findGraphics";
import type { GraphicsRange } from "./findGraphics";
import { findMathRanges } from "./findMath";
import type { MathRange } from "./findMath";
import { findRefRanges } from "./findRefs";
import type { RefRange } from "./findRefs";
import { findSymbolRanges } from "./symbols";
import type { SymbolRange } from "./symbols";
import { findTextReplacements } from "./findTextReplacements";
import type { TextReplacement } from "./findTextReplacements";

/** Everything the inline scanners found in one piece of text. */
export interface InlineScan {
    /** `$…$` and `\(…\)` spans. */
    readonly math: readonly MathRange[];
    /** Formatting commands, whose *content* stays live text. */
    readonly formats: readonly FormatRange[];
    /** `\ref`, `\cite`, `\url` and friends. */
    readonly refs: readonly RefRange[];
    /** `\includegraphics` commands. */
    readonly graphics: readonly GraphicsRange[];
    /** Single-glyph commands such as `\alpha`. */
    readonly symbols: readonly SymbolRange[];
    /** Text-mode spellings: escapes, dashes, quotes, accents. */
    readonly replacements: readonly TextReplacement[];
}

/** How a caller wants the text scanned. */
export interface ScanInlineOptions {
    /**
     * Math spans already known for this text.
     *
     * The preview keeps a cached whole-document scan and passes the
     * relevant slice of it rather than scanning again — which also lets
     * a `$…$` starting above the viewport be found at all.
     */
    readonly math?: readonly MathRange[] | undefined;
    /**
     * Whether to look for `\includegraphics` (default true).
     *
     * A table cell says false: an image inside a cell is not something
     * the table renderer lays out, and finding one would only claim the
     * range and leave it blank.
     */
    readonly includeGraphics?: boolean | undefined;
}

/**
 * Runs every inline scanner over one piece of text, in order.
 *
 * @param text - The text to scan, already masked for inert regions.
 * @param offset - Document position `text` starts at, so the ranges
 *   returned are absolute.
 * @param options - Pre-computed math, and whether to scan for graphics.
 * @returns What each scanner found.
 */
export function scanInline(
    text: string,
    offset: number,
    options: ScanInlineOptions = {},
): InlineScan {
    // Math first, and excluded from everything after it: KaTeX owns its
    // own source, and a `\alpha` inside `$…$` is KaTeX's to render.
    const math = options.math ?? findMathRanges(text, offset);

    // Formatting content stays live, editable text — only the command
    // tokens are hidden — so formatting deliberately does *not* exclude
    // what comes after it. A symbol inside `\textbf{…}` still renders.
    const formats = findFormatRanges(text, offset, math);

    const refs = findRefRanges(text, offset, math);
    const graphics =
        options.includeGraphics === false ? [] : findGraphicsRanges(text, offset, math);

    // Commands replaced wholesale by a widget: their interiors are not
    // scanned again, or a `\cite{alpha}` would sprout a Greek letter.
    const claimed = [...math, ...refs, ...graphics];

    return {
        math,
        formats,
        refs,
        graphics,
        symbols: findSymbolRanges(text, offset, claimed),
        replacements: findTextReplacements(text, offset, claimed),
    };
}
