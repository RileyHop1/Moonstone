/**
 * How a line's number is displayed, given the numbering mode and where
 * the cursor is.
 *
 * Pure so the numbering rules can be tested without an editor.
 */

import type { LineNumberMode } from "../../../../shared/types";

/**
 * Reports whether a mode shows distances from the cursor.
 *
 * `mixed` follows the modal editor: absolute while inserting text,
 * where line numbers are used for reading, and relative otherwise,
 * where they are used for jumping.
 *
 * @param mode - The configured numbering mode.
 * @param isInsertMode - Whether the editor is in insert mode.
 * @returns True when numbers should be relative to the cursor.
 */
export function usesRelativeNumbers(mode: LineNumberMode, isInsertMode: boolean): boolean {
    switch (mode) {
        case "absolute":
            return false;

        case "relative":
            return true;

        case "mixed":
            return !isInsertMode;
    }
}

/**
 * Formats one line's number.
 *
 * The cursor's own line keeps its absolute number even when numbering
 * is relative — a zero there says nothing, whereas the real number is
 * what you need when jumping to or citing a line.
 *
 * @param lineNumber - The line's absolute number, 1-based.
 * @param cursorLine - The line the cursor is on, 1-based.
 * @param mode - The configured numbering mode.
 * @param isInsertMode - Whether the editor is in insert mode.
 * @returns The text to show in the gutter.
 */
export function formatLineNumber(
    lineNumber: number,
    cursorLine: number,
    mode: LineNumberMode,
    isInsertMode: boolean,
): string {
    if (!usesRelativeNumbers(mode, isInsertMode)) return String(lineNumber);

    if (lineNumber === cursorLine) return String(lineNumber);

    return String(Math.abs(lineNumber - cursorLine));
}
