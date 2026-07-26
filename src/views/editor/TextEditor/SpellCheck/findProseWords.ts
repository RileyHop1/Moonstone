/**
 * Pure scanner extracting the words a spell checker should actually
 * look at.
 *
 * A LaTeX document is mostly not prose. Checking it naively flags
 * every command, every citation key and every symbol in a formula,
 * which is worse than no spell checker at all — a wall of false
 * positives trains the author to ignore it.
 *
 * So this skips commands and their non-prose arguments, math, and
 * anything the caller marks inert (comments, verbatim bodies), and
 * returns only the words a human wrote to be read.
 */

/** One checkable word and where it sits in the document. */
export interface ProseWord {
    /** Start offset of the word. */
    readonly from: number;
    /** End offset of the word. */
    readonly to: number;
    /** The word itself. */
    readonly text: string;
}

/** A half-open interval used for exclusion. */
interface Interval {
    readonly from: number;
    readonly to: number;
}

/**
 * Commands whose brace argument is an identifier, a path or a URL —
 * never prose. The argument is skipped along with the command.
 */
const OPAQUE_ARGUMENT_COMMANDS: ReadonlySet<string> = new Set([
    "begin",
    "end",
    "label",
    "ref",
    "eqref",
    "pageref",
    "cite",
    "citep",
    "citet",
    "bibliography",
    "bibliographystyle",
    "includegraphics",
    "include",
    "input",
    "usepackage",
    "documentclass",
    "url",
    "href",
    "verb",
    "texttt",
    "cref",
    "autoref",
]);

/**
 * Extracts the checkable words from a span of text.
 *
 * @param text - The text to scan.
 * @param offset - Document position of `text[0]`.
 * @param exclude - Document-position intervals to skip entirely.
 * @returns The words found, in order of appearance.
 */
export function findProseWords(
    text: string,
    offset: number,
    exclude: readonly Interval[],
): readonly ProseWord[] {
    const words: ProseWord[] = [];
    let index = 0;

    while (index < text.length) {
        const char = text[index];

        if (char === "\\") {
            index = skipCommand(text, index);
            continue;
        }

        if (char === "$") {
            index = skipMath(text, index);
            continue;
        }

        if (char !== undefined && isWordCharacter(char)) {
            const end = readWord(text, index);
            const word = text.slice(index, end);

            if (isCheckable(word) && !overlapsExcluded(exclude, offset + index, offset + end)) {
                words.push({ from: offset + index, to: offset + end, text: word });
            }

            index = end;
            continue;
        }

        index += 1;
    }

    return words;
}

/**
 * Skips a backslash command, and its argument when that argument is
 * not prose.
 *
 * @param text - The text being scanned.
 * @param index - Position of the backslash.
 * @returns The index to resume scanning at.
 */
function skipCommand(text: string, index: number): number {
    let cursor = index + 1;

    while (cursor < text.length) {
        const char = text[cursor];
        if (char === undefined || !/[a-zA-Z]/.test(char)) break;
        cursor += 1;
    }

    // A non-letter command like `\\` or `\%` is two characters.
    if (cursor === index + 1) return index + 2;

    const name = text.slice(index + 1, cursor);
    if (!OPAQUE_ARGUMENT_COMMANDS.has(name)) return cursor;

    // Skip a following `[...]` then `{...}`, which hold identifiers.
    cursor = skipBracketed(text, cursor, "[", "]");
    cursor = skipBracketed(text, cursor, "{", "}");

    return cursor;
}

/**
 * Skips a bracketed group if one starts at `index`.
 *
 * @param text - The text being scanned.
 * @param index - Where the group might start.
 * @param open - Opening delimiter.
 * @param close - Closing delimiter.
 * @returns The index just past the group, or `index` if none.
 */
function skipBracketed(text: string, index: number, open: string, close: string): number {
    if (text[index] !== open) return index;

    const end = text.indexOf(close, index + 1);
    // An unclosed group would swallow the rest of the text; leaving it
    // to be scanned as prose is the safer failure.
    if (end === -1) return index + 1;

    return end + 1;
}

/**
 * Skips a `$...$` or `$$...$$` math segment.
 *
 * @param text - The text being scanned.
 * @param index - Position of the opening delimiter.
 * @returns The index to resume scanning at.
 */
function skipMath(text: string, index: number): number {
    const isDisplay = text[index + 1] === "$";
    const delimiter = isDisplay ? "$$" : "$";
    const end = text.indexOf(delimiter, index + delimiter.length);

    if (end === -1) return index + delimiter.length;

    return end + delimiter.length;
}

/**
 * Reads to the end of the word starting at `index`.
 *
 * Internal apostrophes are part of the word so "don't" is checked as
 * one word rather than "don" plus "t".
 *
 * @param text - The text being scanned.
 * @param index - The word's first character.
 * @returns The index just past the word.
 */
function readWord(text: string, index: number): number {
    let cursor = index;

    while (cursor < text.length) {
        const char = text[cursor];
        if (char === undefined) break;

        if (isWordCharacter(char)) {
            cursor += 1;
            continue;
        }

        // An apostrophe continues the word only if a letter follows.
        const next = text[cursor + 1];
        if ((char === "'" || char === "’") && next !== undefined && isWordCharacter(next)) {
            cursor += 2;
            continue;
        }

        break;
    }

    return cursor;
}

/**
 * Reports whether a character can appear inside a word.
 *
 * @param char - The character to test.
 * @returns True for letters, including accented ones.
 */
function isWordCharacter(char: string): boolean {
    return /\p{L}/u.test(char);
}

/**
 * Reports whether a word is worth checking.
 *
 * Single letters, words containing digits, and all-caps words
 * (acronyms) are skipped — all three are overwhelmingly false
 * positives in a technical document.
 *
 * @param word - The candidate word.
 * @returns True when it should be checked.
 */
function isCheckable(word: string): boolean {
    if (word.length < 3) return false;
    if (/\d/.test(word)) return false;
    if (word === word.toUpperCase()) return false;

    return true;
}

/**
 * Reports whether a span intersects any excluded interval.
 *
 * @param exclude - The intervals to test against.
 * @param from - Span start.
 * @param to - Span end.
 * @returns True on any intersection.
 */
function overlapsExcluded(
    exclude: readonly Interval[],
    from: number,
    to: number,
): boolean {
    return exclude.some((interval) => interval.from < to && interval.to > from);
}
