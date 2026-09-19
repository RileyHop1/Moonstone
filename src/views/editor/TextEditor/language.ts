/**
 * The LaTeX language support, behind a compartment so it can be turned
 * off for files that are not LaTeX.
 *
 * It used to be applied unconditionally in `TextEditor.tsx`, outside any
 * compartment, which meant every editable file was parsed, highlighted
 * and linted as LaTeX — including `.bib`, `.csv` and `.txt`. A
 * compartment is the only way to change it without rebuilding the view,
 * and rebuilding the view would cost the undo history.
 *
 * Like every other compartment here, this is a module singleton and that
 * is safe with any number of editors on screen: a `Compartment` is an
 * identity key whose contents live in each editor's own state.
 */

import { Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { linter } from "@codemirror/lint";
import { latex } from "codemirror-lang-latex";
import type { EditorProfile } from "./editorProfile";
import { findTextModeMath } from "./latex";

/**
 * Flags math-only commands in running text, which the preview would
 * otherwise draw as if nothing were wrong.
 */
const textModeMathLinter = linter((view) =>
    findTextModeMath(view.state.doc.toString()).map(({ from, to, name }) => ({
        from,
        to,
        severity: "error",
        message: `\\${name} only works in math mode. Wrap it in $…$, or LaTeX stops with "Missing $ inserted".`,
    })),
);

/** Compartment holding the language support, if any. */
export const languageCompartment = new Compartment();

/**
 * The language extension a profile calls for.
 *
 * @param profile - What the editor should do with this file.
 * @returns The LaTeX language support, or nothing at all for a file
 *   that is not LaTeX.
 */
export function languageExtensionForProfile(profile: EditorProfile): Extension {
    if (!profile.usesLatexLanguage) return [];

    const language = latex({
        autoCloseTags: true,
        enableLinting: profile.usesLinting,
        enableTooltips: true,
        // The package would otherwise install its own
        // `autocompletion({override: […]})`, and `override` replaces
        // every other completion source — which silently kills
        // reference search. Its LaTeX completions are registered
        // through language data regardless, so basicSetup's
        // autocompletion still offers them alongside ours.
        enableAutocomplete: false,
    });

    // Only whole documents: a package file's macros are full of maths.
    return profile.id === "latex" ? [language, textModeMathLinter] : language;
}
