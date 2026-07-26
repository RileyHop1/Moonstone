/**
 * Spell checking for prose, surfaced through CodeMirror's lint
 * machinery so misspellings get the usual underline, hover panel and
 * quick fixes without inventing a parallel UI.
 *
 * Two things keep it from being noise in a LaTeX document:
 *
 * - `findProseWords` skips commands, their identifier arguments and
 *   math, so `\includegraphics` and `\alpha` are never flagged.
 * - The document's inert regions (comments, verbatim bodies) are
 *   excluded, reusing the same scan the preview already performs.
 *
 * Like the view and modal modes, it lives in a compartment so it can
 * be switched at runtime without rebuilding the editor.
 */

import { Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { linter } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { findInertRegions, maskChunk } from "../LivePreview";
import { loadDictionary } from "./dictionary";
import { findProseWords } from "./findProseWords";
import "./spellCheck.css";

/** Compartment holding the checker, or nothing when it is off. */
export const spellCheckCompartment = new Compartment();

/** Spell checking is on by default, as in any writing tool. */
export const DEFAULT_SPELL_CHECK_ENABLED = true;

/** How long the editor must be idle before a check runs. */
const CHECK_DELAY_MS = 400;

/**
 * Finds misspellings in the visible text.
 *
 * Only the viewport is checked: a spelling error the author cannot
 * see is not worth the work, and this keeps the cost independent of
 * document length.
 *
 * @param view - The editor to check.
 * @returns Diagnostics for each misspelled word.
 */
async function findMisspellings(view: EditorView): Promise<Diagnostic[]> {
    const dictionary = await loadDictionary();
    if (!dictionary) return [];

    const { state } = view;
    const diagnostics: Diagnostic[] = [];

    for (const range of view.visibleRanges) {
        const from = state.doc.lineAt(range.from).from;
        const to = state.doc.lineAt(range.to).to;

        const chunk = state.doc.sliceString(from, to);
        // Comments and verbatim bodies are blanked, so their contents
        // are never checked — same rule the preview follows.
        const masked = maskChunk(chunk, 0, findInertRegions(chunk));

        for (const word of findProseWords(masked, from, [])) {
            if (dictionary.isCorrect(word.text)) continue;

            diagnostics.push(buildDiagnostic(dictionary, word.from, word.to, word.text));
        }
    }

    return diagnostics;
}

/**
 * Builds the diagnostic for one misspelling, with its corrections
 * offered as quick fixes.
 *
 * @param dictionary - The loaded dictionary.
 * @param from - Start of the word.
 * @param to - End of the word.
 * @param word - The misspelled word.
 * @returns The diagnostic.
 */
function buildDiagnostic(
    dictionary: { readonly suggest: (word: string) => readonly string[] },
    from: number,
    to: number,
    word: string,
): Diagnostic {
    const suggestions = dictionary.suggest(word);

    return {
        from,
        to,
        severity: "warning",
        source: "spelling",
        message: suggestions.length
            ? `"${word}" — did you mean ${suggestions.join(", ")}?`
            : `"${word}" is not in the dictionary`,
        actions: suggestions.map((suggestion) => ({
            name: suggestion,
            apply: (target, start, end) => {
                target.dispatch({ changes: { from: start, to: end, insert: suggestion } });
            },
        })),
    };
}

/**
 * Maps the enabled flag to the extension the compartment should hold.
 *
 * @param enabled - Whether spell checking is on.
 * @returns The linter extension, or nothing.
 */
export function spellCheckExtensionForEnabled(enabled: boolean): Extension {
    if (!enabled) return [];

    return linter(findMisspellings, { delay: CHECK_DELAY_MS });
}
