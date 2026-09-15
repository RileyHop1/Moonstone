/**
 * Shared brace-matching helper for the live-preview scanners.
 *
 * Several LaTeX constructs (`\section{...}`, `\textbf{...}`,
 * `\multicolumn{...}{...}{...}`) need to find the `}` that closes a
 * given `{` while respecting nesting and escapes; keeping the logic
 * here avoids three subtly different copies.
 */

/**
 * Finds the index of the `}` closing the `{` at `openIndex`.
 *
 * Backslash-escaped braces (`\{`, `\}`) are treated as ordinary
 * characters and do not affect nesting depth.
 *
 * @param text - The text to scan.
 * @param openIndex - Index of the opening `{` in `text`.
 * @returns The index of the matching `}`, or -1 when the group never
 *   closes (or `text[openIndex]` is not a `{`).
 */
export function findGroupEnd(text: string, openIndex: number): number {
    if (text[openIndex] !== "{") return -1;

    let depth = 0;

    for (let index = openIndex; index < text.length; index++) {
        const char = text[index];

        // Escaped characters never open or close a group.
        if (char === "\\") {
            index++;
            continue;
        }

        if (char === "{") depth++;

        if (char === "}") {
            depth--;
            if (depth === 0) return index;
        }
    }

    return -1;
}
