/**
 * Test suite for the editor's modal-mode → extension mapping.
 */

import { describe, it, expect } from "vitest";
import {
    DEFAULT_MODAL_MODE,
    modalExtensionForMode,
} from "../views/editor/TextEditor/modalMode";

describe("modalExtensionForMode", () => {
    it("defaults to no modal mode", () => {
        expect(DEFAULT_MODAL_MODE).toBe("none");
    });

    it("provides nothing when off", () => {
        expect(modalExtensionForMode("none")).toEqual([]);
    });

    it("provides an extension for vim and helix", () => {
        const vimExt = modalExtensionForMode("vim");
        const helixExt = modalExtensionForMode("helix");

        expect(vimExt).not.toEqual([]);
        expect(helixExt).not.toEqual([]);
        // Distinct modal systems produce distinct configurations.
        expect(helixExt).not.toEqual(vimExt);
    });
});
