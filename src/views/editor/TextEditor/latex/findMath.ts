/**
 * Pure scanner for TeX math delimiters (`$...$` and `$$...$$`).
 *
 * Grammar-independent by design: the live preview must keep working
 * even if the LaTeX language extension changes, and a pure function
 * over strings is trivially unit-testable.
 */

/** One math segment found in the scanned text. */
export interface MathRange {
    /** Start of the segment, including the opening delimiter. */
    readonly from: number;
    /** End of the segment, including the closing delimiter. */
    readonly to: number;
    /** Start of the LaTeX source between the delimiters. */
    readonly innerFrom: number;
    /** End of the LaTeX source between the delimiters. */
    readonly innerTo: number;
    /** True for display math (`$$...$$`), false for inline (`$...$`). */
    readonly display: boolean;
}

/**
 * Scans text for math segments.
 *
 * Rules: `\$` never delimits; `$$` always opens display math; inline
 * math may not span lines; unclosed delimiters yield nothing, so
 * half-typed math stays visible as source.
 *
 * @param text - The text to scan.
 * @param offset - Document position of `text[0]`; all returned
 *   positions are offset by this so they are document positions.
 * @returns The math segments found, in order of appearance.
 */
export function findMathRanges(text: string, offset: number): readonly MathRange[] {
    const ranges: MathRange[] = [];
    let index = 0;

    while (index < text.length) {
        const char = text[index];

        // Skip escaped characters so \$ never starts math.
        if (char === "\\") {
            index += 2;
            continue;
        }

        if (char !== "$") {
            index += 1;
            continue;
        }

        const display = text[index + 1] === "$";
        const delimiterLength = display ? 2 : 1;
        const closeIndex = findClosingDelimiter(text, index + delimiterLength, display);

        if (closeIndex === -1) {
            index += delimiterLength;
            continue;
        }

        ranges.push({
            from: offset + index,
            to: offset + closeIndex + delimiterLength,
            innerFrom: offset + index + delimiterLength,
            innerTo: offset + closeIndex,
            display,
        });

        index = closeIndex + delimiterLength;
    }

    return ranges;
}

/**
 * Finds the closing delimiter for a math segment.
 *
 * @param text - The text being scanned.
 * @param start - Index just after the opening delimiter.
 * @param display - Whether a `$$` closer is required.
 * @returns Index of the closing delimiter, or -1 if there is none
 *   (inline math also fails on the first line break).
 */
function findClosingDelimiter(text: string, start: number, display: boolean): number {
    let index = start;

    while (index < text.length) {
        const char = text[index];

        if (char === "\\") {
            index += 2;
            continue;
        }

        // Inline math must close on the same line.
        if (char === "\n" && !display) return -1;

        if (char === "$") {
            if (!display) return index;

            if (text[index + 1] === "$") return index;
        }

        index += 1;
    }

    return -1;
}
