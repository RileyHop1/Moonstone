/**
 * Detects when the cursor sits inside a citation's argument, so
 * reference completion offers itself there and nowhere else.
 */

/** Where completion should apply, and what has been typed so far. */
export interface CitationContext {
    /**
     * Document offset the partial key starts at; a completion replaces
     * from here to the cursor.
     */
    readonly from: number;
    /** The partial key typed so far, which may be empty. */
    readonly query: string;
}

/**
 * Matches the command and any optional arguments immediately before an
 * opening brace, e.g. `\citep[see][p.\,3]` in `\citep[see][p.\,3]{`.
 */
const CITATION_COMMAND = /\\([a-zA-Z]+)\s*(?:\[[^\]]*\]\s*)*$/;

/**
 * Reports whether a command name is a citation command.
 *
 * Every citation command in LaTeX and biblatex contains "cite" —
 * `\cite`, `\citep`, `\textcite`, `\nocite`, `\autocite` — so matching
 * on that covers the whole family, including packages we have never
 * heard of, without maintaining a list.
 *
 * @param commandName - Command name without the backslash.
 * @returns True when the command takes citation keys.
 */
function isCitationCommand(commandName: string): boolean {
    return commandName.toLowerCase().includes("cite");
}

/**
 * Reports whether an offset falls inside a comment on its line.
 *
 * @param text - The text being scanned.
 * @param offset - Offset to test.
 * @returns True when an unescaped `%` precedes the offset on its line.
 */
function isInComment(text: string, offset: number): boolean {
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;

    for (let index = lineStart; index < offset; index++) {
        if (text[index] !== "%") continue;
        // A `\%` is a literal percent sign, not a comment.
        if (index > 0 && text[index - 1] === "\\") continue;

        return true;
    }

    return false;
}

/**
 * Finds the citation argument the cursor is inside, if any.
 *
 * @param text - Document text up to and including the cursor position.
 * @param position - Cursor offset within `text`.
 * @returns The context to complete in, or null when the cursor is not
 *   inside a citation argument.
 */
export function findCitationContext(text: string, position: number): CitationContext | null {
    const before = text.slice(0, position);

    const openIndex = before.lastIndexOf("{");
    if (openIndex === -1) return null;

    // The nearest brace is the innermost one still open; a closing
    // brace after it means the group has already ended.
    if (before.indexOf("}", openIndex) !== -1) return null;

    const command = CITATION_COMMAND.exec(before.slice(0, openIndex));
    if (!command?.[1] || !isCitationCommand(command[1])) return null;

    if (isInComment(before, openIndex)) return null;

    // Several keys can share one argument: only the one being typed,
    // after the last comma, is completed.
    const argument = before.slice(openIndex + 1);
    const lastComma = argument.lastIndexOf(",");
    const rawKey = argument.slice(lastComma + 1);
    const leadingSpace = rawKey.length - rawKey.trimStart().length;

    // A key cannot contain whitespace, so anything after a space is no
    // longer the key being typed.
    const query = rawKey.trimStart();
    if (/\s/.test(query)) return null;

    return {
        from: openIndex + 1 + lastComma + 1 + leadingSpace,
        query,
    };
}
