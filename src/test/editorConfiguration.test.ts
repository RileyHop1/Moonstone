/**
 * Tests for the editor's settings-to-extensions mapping.
 *
 * The behaviour that matters here is not "which extension is built" —
 * that belongs to each feature's own suite — but that a configuration
 * change reaches the editor *at all*, and costs one dispatch rather
 * than six. Before this module existed, the project page ran seven
 * separate effects to do the same job, and a second editor would have
 * needed all seven fanned out over it.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { language } from "@codemirror/language";
import {
    editorExtensions,
    reconfigurationEffects,
} from "../views/editor/TextEditor/editorConfiguration";
import type { EditorConfiguration } from "../views/editor/TextEditor/editorConfiguration";
import {
    DEFAULT_EDITOR_PROFILE,
    editorProfileForExtension,
} from "../views/editor/TextEditor/editorProfile";
import type { Reference } from "../shared/types";

/** One bibliography entry, for the references field. */
const KNUTH: Reference = {
    key: "knuth84",
    entryType: "book",
    title: "The TeXbook",
    authors: ["Donald E. Knuth"],
    year: "1984",
    sourcePath: "/project/refs.bib",
    sourceName: "refs.bib",
};

/** A configuration with every setting at a known, non-default value. */
const BASE: EditorConfiguration = {
    viewMode: "live",
    modalMode: "none",
    spellCheckEnabled: true,
    theme: "dark",
    lineNumberMode: "absolute",
    showDiagnostics: false,
    references: [],
    profile: DEFAULT_EDITOR_PROFILE,
};

/**
 * A different value for each field, used to prove every field is wired.
 *
 * Kept as a `Record` over the configuration's own keys so adding a
 * setting to {@link EditorConfiguration} without adding a case here is
 * a type error, not a silently untested field.
 */
const CHANGES: Record<keyof EditorConfiguration, Partial<EditorConfiguration>> = {
    viewMode: { viewMode: "source" },
    modalMode: { modalMode: "vim" },
    spellCheckEnabled: { spellCheckEnabled: false },
    theme: { theme: "light" },
    lineNumberMode: { lineNumberMode: "relative" },
    showDiagnostics: { showDiagnostics: true },
    references: { references: [KNUTH] },
    resolveImageSource: { resolveImageSource: () => "moonstone://image" },
    openLink: { openLink: () => undefined },
    profile: { profile: editorProfileForExtension("csv") },
};

describe("reconfigurationEffects", () => {
    it("dispatches nothing when the configuration has not changed", () => {
        expect(reconfigurationEffects(BASE, BASE)).toEqual([]);
    });

    it("dispatches nothing for an equal but distinct configuration object", () => {
        // A parent that rebuilds the object each render must not cost a
        // reconfigure per render.
        expect(reconfigurationEffects(BASE, { ...BASE })).toEqual([]);
    });

    it.each(Object.keys(CHANGES) as (keyof EditorConfiguration)[])(
        "reacts to a change of %s",
        (field) => {
            const next = { ...BASE, ...CHANGES[field] };

            expect(reconfigurationEffects(BASE, next).length).toBeGreaterThan(0);
        },
    );

    it("reconfigures only what changed", () => {
        // A theme switch touches one compartment. If this ever grows,
        // something has started over-reporting changes and every editor
        // is rebuilding extensions it did not need to.
        const next = { ...BASE, theme: "light" } as const;

        expect(reconfigurationEffects(BASE, next)).toHaveLength(1);
    });

    it("carries line numbering along with a modal-mode change", () => {
        // "mixed" numbering is defined in terms of the modal editor's
        // insert state, so the two compartments move together.
        const next = { ...BASE, modalMode: "vim" } as const;

        expect(reconfigurationEffects(BASE, next)).toHaveLength(2);
    });

    it("treats the image resolver as part of the preview configuration", () => {
        const next = { ...BASE, resolveImageSource: () => "moonstone://image" };

        expect(reconfigurationEffects(BASE, next)).toHaveLength(1);
    });

    it("reports several changes at once so they apply in one dispatch", () => {
        const next: EditorConfiguration = {
            ...BASE,
            theme: "light",
            spellCheckEnabled: false,
            showDiagnostics: true,
        };

        expect(reconfigurationEffects(BASE, next)).toHaveLength(3);
    });
});

describe("editorExtensions", () => {
    /** Stands in for `basicSetup`, so its position can be pointed at. */
    const BASE_SETUP: Extension = [];

    it("builds one extension per synced compartment, around the base setup", () => {
        expect(editorExtensions(BASE, BASE_SETUP)).toHaveLength(8);
    });

    it("puts the modal keymap before the base setup and the language after", () => {
        // Precedence, not cosmetics. Vim and Helix must see keys before
        // the default bindings; the language's `autoCloseTags` handler
        // must see input *after* basicSetup's `closeBrackets`, which is
        // where it sat before it moved into a compartment.
        const built = editorExtensions(BASE, BASE_SETUP);
        const baseIndex = built.indexOf(BASE_SETUP);

        expect(baseIndex).toBeGreaterThan(0);
        expect(baseIndex).toBe(built.length - 2);
    });

    it("omits the language entirely for a file that is not LaTeX", () => {
        // A `.csv` must not be parsed, highlighted or linted as LaTeX.
        const plain = { ...BASE, profile: editorProfileForExtension("csv") };
        const state = EditorState.create({
            doc: "a,b\n1,2\n",
            extensions: editorExtensions(plain, BASE_SETUP),
        });

        expect(state.facet(language)).toBeNull();
    });

    it("installs the LaTeX language for a .tex file", () => {
        const state = EditorState.create({
            doc: "\\textbf{hi}",
            extensions: editorExtensions(BASE, BASE_SETUP),
        });

        expect(state.facet(language)).not.toBeNull();
    });

    it("produces a state the effects can then reconfigure", () => {
        // The real contract: what mount builds and what reconfigure
        // targets are the same compartments, so a setting changed after
        // mount actually lands.
        const view = new EditorView({
            state: EditorState.create({
                doc: "Hello",
                extensions: editorExtensions(BASE, BASE_SETUP),
            }),
        });

        try {
            const effects = reconfigurationEffects(BASE, { ...BASE, theme: "light" });
            expect(() => {
                view.dispatch({ effects });
            }).not.toThrow();
            expect(view.state.doc.toString()).toBe("Hello");
        } finally {
            view.destroy();
        }
    });
});
