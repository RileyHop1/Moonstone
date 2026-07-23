/**
 * LaTeX snippets the toolbar and hotbar can insert at the cursor.
 */

import type { EditorView } from "@codemirror/view";
import type { SnippetName } from "../../../shared/appActions";

/** A piece of LaTeX to insert and where the cursor lands inside it. */
export interface Snippet {
    /** The text inserted at the cursor. */
    readonly text: string;
    /** Cursor position relative to the start of the inserted text. */
    readonly cursorOffset: number;
}

/** Every insertable snippet, keyed by its {@link SnippetName}. */
export const SNIPPETS: Record<SnippetName, Snippet> = {
    inlineMath: { text: "$$", cursorOffset: 1 },
    blockMath: { text: "$$\n\n$$", cursorOffset: 3 },
    table: {
        text: "\\begin{tabular}{|c|c|}\n\\hline\n & \\\\\n\\hline\n\\end{tabular}\n",
        cursorOffset: 30,
    },
    template: {
        text: "\\documentclass{article}\n\\title{}\n\\author{}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\end{document}\n",
        cursorOffset: 31,
    },
    alpha: { text: "\\alpha", cursorOffset: 6 },
    beta: { text: "\\beta", cursorOffset: 5 },
    sum: { text: "\\sum_{}^{}", cursorOffset: 6 },
    integral: { text: "\\int_{}^{}", cursorOffset: 6 },
    fraction: { text: "\\frac{}{}", cursorOffset: 6 },
    squareRoot: { text: "\\sqrt{}", cursorOffset: 6 },
};

/**
 * Inserts a snippet at the primary cursor and moves the cursor to the
 * snippet's editing position.
 *
 * @param view - The editor view to dispatch into.
 * @param snippet - The snippet to insert.
 */
export function insertSnippetIntoView(view: EditorView, snippet: Snippet): void {
    const { head } = view.state.selection.main;

    view.dispatch({
        changes: { from: head, insert: snippet.text },
        selection: { anchor: head + snippet.cursorOffset },
    });

    view.focus();
}
