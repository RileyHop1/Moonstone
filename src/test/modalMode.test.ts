/**
 * Test suite for the editor's modal-mode → extension mapping.
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import type { ModalMode } from "../shared/types";
import {
    DEFAULT_MODAL_MODE,
    modalExtensionForMode,
    modalModeFacet,
} from "../views/editor/TextEditor/modalMode";

/**
 * Builds a state configured for one modal mode.
 *
 * @param mode - The mode under test.
 * @returns The configured editor state.
 */
function stateForMode(mode: ModalMode): EditorState {
    return EditorState.create({ extensions: modalExtensionForMode(mode) });
}

describe("modalExtensionForMode", () => {
    it("defaults to no modal mode", () => {
        expect(DEFAULT_MODAL_MODE).toBe("none");
    });

    it("publishes the active mode into editor state", () => {
        expect(stateForMode("none").facet(modalModeFacet)).toBe("none");
        expect(stateForMode("vim").facet(modalModeFacet)).toBe("vim");
        expect(stateForMode("helix").facet(modalModeFacet)).toBe("helix");
    });

    it("falls back to the default mode when nothing is configured", () => {
        expect(EditorState.create({}).facet(modalModeFacet)).toBe(DEFAULT_MODAL_MODE);
    });

    it("adds no keymap when off", () => {
        // Only the mode facet — no modal keymap to intercept keys.
        expect(modalExtensionForMode("none") as readonly unknown[]).toHaveLength(1);
    });

    it("provides an extension for vim and helix", () => {
        const vimExt = modalExtensionForMode("vim") as readonly unknown[];
        const helixExt = modalExtensionForMode("helix") as readonly unknown[];

        expect(vimExt.length).toBeGreaterThan(1);
        expect(helixExt.length).toBeGreaterThan(1);
        // Distinct modal systems produce distinct configurations.
        expect(helixExt).not.toEqual(vimExt);
    });
});
