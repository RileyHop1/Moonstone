/**
 * Identifies the regions of a LaTeX document whose contents must never
 * be rendered by the preview: comments and verbatim-style literals.
 *
 * Rather than teaching every scanner to skip these regions — which
 * would duplicate overlap logic and still not work for the stateful
 * scanners, where a `$` inside a comment mispairs with a real one
 * further down — the text is **masked** before scanning. Inert
 * characters become spaces, preserving total length and every newline
 * position, so offsets found in masked text are valid document
 * positions. The scanners are unchanged and unaware.
 *
 * The work is split so that cost scales with what is being rendered:
 *
 * - {@link findInertRegions} locates the regions. This must see the
 *   whole document — a `\begin{verbatim}` far above the viewport
 *   decides whether the visible lines are literal, and nothing in the
 *   visible text itself reveals that. It is a linear scan returning a
 *   handful of intervals, with no large allocation.
 * - {@link maskChunk} applies them to one span of text. Callers mask
 *   only what they are about to scan, so the inline layer's cost is
 *   proportional to the viewport rather than the document.
 */

/** A half-open interval of the document. */
export interface Interval {
    readonly from: number;
    readonly to: number;
}

/** The regions of a document whose contents must not be rendered. */
export interface InertRegions {
    /** Comment bodies, `%` through end of line. */
    readonly comments: readonly Interval[];
    /** Verbatim environment bodies and `\verb` arguments. */
    readonly literals: readonly Interval[];
}

/** No inert regions at all, for empty or plain documents. */
const NO_REGIONS: InertRegions = { comments: [], literals: [] };

/**
 * Environments whose bodies are literal text. Their contents must
 * survive verbatim, so nothing inside may be rendered — the
 * surrounding box still applies, since only the body is masked.
 */
const VERBATIM_ENVIRONMENTS: ReadonlySet<string> = new Set([
    "verbatim",
    "verbatim*",
    "Verbatim",
    "Verbatim*",
    "lstlisting",
    "minted",
    "alltt",
]);

/**
 * Locates every region whose contents must not be rendered.
 *
 * Comments are resolved first and excluded from the literal scan, so a
 * commented-out `\begin{verbatim}` cannot open a literal region.
 *
 * @param docText - The full document text.
 * @returns The comment and literal intervals, each in ascending order.
 */
export function findInertRegions(docText: string): InertRegions {
    const comments = findCommentRanges(docText);
    const literals = findLiteralRanges(docText, comments);

    if (comments.length === 0 && literals.length === 0) return NO_REGIONS;

    return { comments, literals };
}

/**
 * Blanks the inert parts of one span of text.
 *
 * Only regions overlapping the span are applied, and the result is
 * exactly as long as the input, so offsets computed against it remain
 * document positions.
 *
 * @param chunk - The text to mask.
 * @param chunkFrom - Document position of `chunk[0]`.
 * @param regions - Inert regions for the whole document.
 * @returns The masked chunk, identical in length to the input.
 */
export function maskChunk(
    chunk: string,
    chunkFrom: number,
    regions: InertRegions,
): string {
    const overlapping = collectOverlapping(chunk.length, chunkFrom, regions);
    if (overlapping.length === 0) return chunk;

    // Rebuilt segment-wise rather than character-wise: the untouched
    // spans between inert regions are passed through as slices, so a
    // document with a dozen comments allocates a couple of dozen
    // segments instead of one array per character.
    const segments: string[] = [];
    let cursor = 0;

    for (const range of overlapping) {
        // Ranges may overlap (a `\verb` inside a verbatim body); anything
        // already blanked is skipped rather than blanked twice.
        if (range.to <= cursor) continue;

        const from = Math.max(range.from, cursor);
        if (from > cursor) segments.push(chunk.slice(cursor, from));
        segments.push(blankText(chunk.slice(from, range.to)));
        cursor = range.to;
    }

    if (cursor < chunk.length) segments.push(chunk.slice(cursor));

    return segments.join("");
}

/**
 * Masks a whole document in one call.
 *
 * A convenience for callers that scan everything (the block layer) and
 * for tests; equivalent to locating the regions and masking the full
 * span.
 *
 * @param docText - The full document text.
 * @returns The masked text, identical in length to the input.
 */
export function maskInertRegions(docText: string): string {
    return maskChunk(docText, 0, findInertRegions(docText));
}

/**
 * Selects the regions overlapping a span, clamped and rebased to it.
 *
 * @param chunkLength - Length of the span.
 * @param chunkFrom - Document position of the span's first character.
 * @param regions - Inert regions for the whole document.
 * @returns Chunk-relative intervals, in ascending order.
 */
function collectOverlapping(
    chunkLength: number,
    chunkFrom: number,
    regions: InertRegions,
): readonly Interval[] {
    const chunkTo = chunkFrom + chunkLength;
    const clamped: Interval[] = [];

    for (const source of [regions.comments, regions.literals]) {
        for (const range of source) {
            if (range.from >= chunkTo || range.to <= chunkFrom) continue;

            clamped.push({
                from: Math.max(range.from, chunkFrom) - chunkFrom,
                to: Math.min(range.to, chunkTo) - chunkFrom,
            });
        }
    }

    return clamped.sort((left, right) => left.from - right.from);
}

/**
 * Replaces every character except newlines with a space.
 *
 * Newlines survive so each line keeps its offset and the scanners'
 * line-boundary rules behave identically.
 *
 * @param text - The text to blank.
 * @returns Text of the same length containing only spaces and newlines.
 */
function blankText(text: string): string {
    return text.replace(/[^\n]/g, " ");
}

/**
 * Finds every comment: an unescaped `%` through the end of its line.
 *
 * The newline itself is left intact so line boundaries are unchanged.
 *
 * @param text - The text to scan.
 * @returns The comment intervals, in ascending order.
 */
export function findCommentRanges(text: string): readonly Interval[] {
    const ranges: Interval[] = [];
    let index = 0;

    while (index < text.length) {
        const char = text[index];

        // Skip the escaped character: `\%` prints a percent sign, while
        // `\\%` is a line break followed by a real comment.
        if (char === "\\") {
            index += 2;
            continue;
        }

        if (char !== "%") {
            index += 1;
            continue;
        }

        const lineEnd = text.indexOf("\n", index);
        const to = lineEnd === -1 ? text.length : lineEnd;
        ranges.push({ from: index, to });
        index = to;
    }

    return ranges;
}

/** Matches the opening tag of any environment. */
const ENV_BEGIN_PATTERN = /\\begin\{([a-zA-Z*]+)\}/g;

/** Matches `\verb` (or `\verb*`) plus its delimiter character. */
const VERB_PATTERN = /\\verb\*?([^a-zA-Z\s])/g;

/**
 * Finds the interiors of literal regions: verbatim-style environment
 * bodies and `\verb` arguments.
 *
 * Only interiors are returned — the `\begin`/`\end` tags stay visible
 * so the environment still renders its box.
 *
 * @param text - The text to scan.
 * @param comments - Comment intervals, whose contents are ignored so a
 *   commented-out tag cannot open a literal region.
 * @returns The literal intervals, in ascending order.
 */
export function findLiteralRanges(
    text: string,
    comments: readonly Interval[],
): readonly Interval[] {
    const ranges: Interval[] = [
        ...findVerbatimEnvironmentRanges(text, comments),
        ...findVerbRanges(text, comments),
    ];

    return ranges.sort((left, right) => left.from - right.from);
}

/**
 * Finds the bodies of verbatim-style environments.
 *
 * Nesting is not supported (LaTeX does not nest verbatim either): each
 * opening tag pairs with the next matching `\end` outside a comment.
 *
 * @param text - The text to scan.
 * @param comments - Comment intervals to ignore.
 * @returns The environment body intervals.
 */
function findVerbatimEnvironmentRanges(
    text: string,
    comments: readonly Interval[],
): readonly Interval[] {
    const ranges: Interval[] = [];

    for (const match of text.matchAll(ENV_BEGIN_PATTERN)) {
        const name = match[1];
        const matchStart = match.index;
        if (name === undefined || matchStart === undefined) continue;
        if (!VERBATIM_ENVIRONMENTS.has(name)) continue;
        if (containsPosition(comments, matchStart)) continue;

        const bodyFrom = matchStart + match[0].length;
        const endIndex = findClosingTag(text, `\\end{${name}}`, bodyFrom, comments);

        // An unclosed literal environment stays raw rather than
        // swallowing the rest of the document.
        if (endIndex === -1) continue;

        ranges.push({ from: bodyFrom, to: endIndex });
    }

    return ranges;
}

/**
 * Finds the arguments of `\verb` commands.
 *
 * @param text - The text to scan.
 * @param comments - Comment intervals to ignore.
 * @returns The argument intervals.
 */
function findVerbRanges(
    text: string,
    comments: readonly Interval[],
): readonly Interval[] {
    const ranges: Interval[] = [];

    for (const match of text.matchAll(VERB_PATTERN)) {
        const delimiter = match[1];
        const matchStart = match.index;
        if (delimiter === undefined || matchStart === undefined) continue;
        if (containsPosition(comments, matchStart)) continue;

        const contentFrom = matchStart + match[0].length;
        const closeIndex = text.indexOf(delimiter, contentFrom);
        if (closeIndex === -1) continue;

        // `\verb` arguments cannot span lines; an unclosed one stays raw.
        const lineEnd = text.indexOf("\n", contentFrom);
        if (lineEnd !== -1 && closeIndex > lineEnd) continue;

        ranges.push({ from: contentFrom, to: closeIndex });
    }

    return ranges;
}

/**
 * Finds the next occurrence of a closing tag that is not commented out.
 *
 * @param text - The text to search.
 * @param tag - The literal closing tag, e.g. `\end{verbatim}`.
 * @param searchFrom - Index to start searching at.
 * @param comments - Comment intervals to skip over.
 * @returns The tag's index, or -1 when there is none.
 */
function findClosingTag(
    text: string,
    tag: string,
    searchFrom: number,
    comments: readonly Interval[],
): number {
    let index = text.indexOf(tag, searchFrom);

    while (index !== -1 && containsPosition(comments, index)) {
        index = text.indexOf(tag, index + tag.length);
    }

    return index;
}

/**
 * Reports whether a position falls inside any interval.
 *
 * @param ranges - Intervals in ascending order.
 * @param position - The position to test.
 * @returns True when the position is inside one of the intervals.
 */
function containsPosition(ranges: readonly Interval[], position: number): boolean {
    return ranges.some((range) => range.from <= position && position < range.to);
}
