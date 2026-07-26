/**
 * Inline reference search: completion for `\cite{…}` drawn from the
 * project's bibliography.
 *
 * Like the view, modal and spell-check features, the reference list
 * lives in a compartment so the editor can be handed a new one — after
 * a `.bib` file is saved, say — without being rebuilt.
 */

import { Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { Reference } from "../../../../shared/types";
import { findCitationContext } from "./findCitationContext";
import { describeReference, matchReferences } from "./matchReferences";
import "./references.css";

/** Compartment holding the completion source for the current project. */
export const referencesCompartment = new Compartment();

/**
 * How far back from the cursor the citation scan looks. A citation
 * argument is short; this bounds the work per keystroke so it does not
 * grow with the document.
 */
const LOOKBEHIND = 1000;

/** Most completions offered at once, to keep the popup usable. */
const MAX_RESULTS = 50;

/**
 * Builds one completion entry for a reference.
 *
 * @param reference - The reference to offer.
 * @returns The completion, labelled with the citation key.
 */
function toCompletion(reference: Reference): Completion {
    return {
        label: reference.key,
        type: "reference",
        detail: describeReference(reference),
        // The title is the long form, shown in the side panel where
        // there is room for it.
        info: reference.title || undefined,
    };
}

/**
 * Creates the completion source for a set of references.
 *
 * @param references - Every reference in the project.
 * @returns A CodeMirror completion source.
 */
function createSource(
    references: readonly Reference[],
): (context: CompletionContext) => CompletionResult | null {
    return (context) => {
        if (references.length === 0) return null;

        const windowStart = Math.max(0, context.pos - LOOKBEHIND);
        const text = context.state.doc.sliceString(windowStart, context.pos);

        const citation = findCitationContext(text, text.length);
        if (!citation) return null;

        // With nothing typed the popup is only wanted on request, so an
        // explicit Ctrl-Space still shows the whole bibliography.
        if (citation.query.length === 0 && !context.explicit) return null;

        const matches = matchReferences(references, citation.query, MAX_RESULTS);
        if (matches.length === 0) return null;

        return {
            from: windowStart + citation.from,
            options: matches.map(toCompletion),
            // Matching already ran across key, title, author and year;
            // CodeMirror's own filter only sees labels and would drop
            // everything matched by title or author.
            filter: false,
        };
    };
}

/**
 * Builds the reference-completion extension for a project.
 *
 * Registered through `languageData` rather than `autocompletion`'s
 * `override`, so it adds to the editor's existing sources instead of
 * replacing them.
 *
 * @param references - Every reference in the project; an empty list
 *   simply offers nothing.
 * @returns The extension to place in {@link referencesCompartment}.
 */
export function referencesExtension(references: readonly Reference[]): Extension {
    // Built once, not per query: CodeMirror tracks a running completion
    // by the identity of the source that started it, so handing back a
    // fresh function each time leaves every query pending forever — the
    // popup never opens even though the source returns results.
    const languageData = [{ autocomplete: createSource(references) }];

    return EditorState.languageData.of(() => languageData);
}
