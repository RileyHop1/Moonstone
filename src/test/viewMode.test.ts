/**
 * Test suite for the editor's view-mode → extension mapping.
 */

import { describe, it, expect } from "vitest";
import {
    DEFAULT_VIEW_MODE,
    previewExtensionForMode,
} from "../views/editor/TextEditor/viewMode";

describe("previewExtensionForMode", () => {
    it("defaults to live mode", () => {
        expect(DEFAULT_VIEW_MODE).toBe("live");
    });

    it("renders nothing in source mode", () => {
        expect(previewExtensionForMode("source")).toEqual([]);
    });

    it("provides preview extensions in live and read-only modes", () => {
        const live = previewExtensionForMode("live") as readonly unknown[];
        const readOnly = previewExtensionForMode("readonly") as readonly unknown[];

        expect(live.length).toBeGreaterThan(0);
        expect(readOnly.length).toBeGreaterThan(0);
        // Read-only wraps live preview plus read-only/non-editable
        // extensions, so its shape differs from live.
        expect(readOnly).not.toEqual(live);
    });
});
