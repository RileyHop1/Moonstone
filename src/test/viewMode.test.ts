/**
 * Test suite for the editor's view-mode → extension mapping.
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import type { ViewMode } from "../shared/types";
import {
    DEFAULT_VIEW_MODE,
    previewExtensionForMode,
    viewModeFacet,
} from "../views/editor/TextEditor/viewMode";

/**
 * Builds a state configured for one view mode.
 *
 * @param mode - The mode under test.
 * @returns The configured editor state.
 */
function stateForMode(mode: ViewMode): EditorState {
    return EditorState.create({ extensions: previewExtensionForMode(mode) });
}

describe("previewExtensionForMode", () => {
    it("defaults to live mode", () => {
        expect(DEFAULT_VIEW_MODE).toBe("live");
    });

    it("publishes the active mode into editor state", () => {
        expect(stateForMode("source").facet(viewModeFacet)).toBe("source");
        expect(stateForMode("live").facet(viewModeFacet)).toBe("live");
        expect(stateForMode("readonly").facet(viewModeFacet)).toBe("readonly");
    });

    it("falls back to the default mode when no preview is configured", () => {
        expect(EditorState.create({}).facet(viewModeFacet)).toBe(DEFAULT_VIEW_MODE);
    });

    it("leaves the document editable in source and live modes", () => {
        expect(stateForMode("source").readOnly).toBe(false);
        expect(stateForMode("live").readOnly).toBe(false);
    });

    it("makes the document read-only in read-only mode", () => {
        expect(stateForMode("readonly").readOnly).toBe(true);
    });

    it("adds no preview machinery in source mode", () => {
        const source = previewExtensionForMode("source") as readonly unknown[];
        const live = previewExtensionForMode("live") as readonly unknown[];

        // Source carries the mode facet alone; live adds the preview.
        expect(source).toHaveLength(1);
        expect(live.length).toBeGreaterThan(source.length);
    });
});
