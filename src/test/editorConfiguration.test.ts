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
import { EditorView } from "@codemirror/view";
import {
    editorExtensions,
    reconfigurationEffects,
} from "../views/editor/TextEditor/editorConfiguration";
import type { EditorConfiguration } from "../views/editor/TextEditor/editorConfiguration";
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
    it("builds one extension per synced compartment", () => {
        expect(editorExtensions(BASE)).toHaveLength(6);
    });

    it("produces a state the effects can then reconfigure", () => {
        // The real contract: what mount builds and what reconfigure
        // targets are the same compartments, so a setting changed after
        // mount actually lands.
        const view = new EditorView({
            state: EditorState.create({
                doc: "Hello",
                extensions: editorExtensions(BASE),
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
