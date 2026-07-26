/**
 * Test suite for line numbering: the formatting rules, and what the
 * gutter actually renders for each mode.
 */

import { describe, it, expect } from "vitest";
import { EditorView, basicSetup } from "codemirror";
import {
    formatLineNumber,
    lineNumbersExtensionForMode,
    usesRelativeNumbers,
} from "../views/editor/TextEditor/LineNumbers";
import type { LineNumberMode, ModalMode } from "../shared/types";

describe("usesRelativeNumbers", () => {
    it("never counts from the cursor in absolute mode", () => {
        expect(usesRelativeNumbers("absolute", true)).toBe(false);
        expect(usesRelativeNumbers("absolute", false)).toBe(false);
    });

    it("always counts from the cursor in relative mode", () => {
        expect(usesRelativeNumbers("relative", true)).toBe(true);
        expect(usesRelativeNumbers("relative", false)).toBe(true);
    });

    it("follows insert mode in mixed mode", () => {
        // Absolute while typing, relative while navigating.
        expect(usesRelativeNumbers("mixed", true)).toBe(false);
        expect(usesRelativeNumbers("mixed", false)).toBe(true);
    });
});

describe("formatLineNumber", () => {
    it("shows the line's own number in absolute mode", () => {
        expect(formatLineNumber(7, 3, "absolute", false)).toBe("7");
    });

    it("counts distance from the cursor in relative mode", () => {
        expect(formatLineNumber(1, 4, "relative", false)).toBe("3");
        expect(formatLineNumber(7, 4, "relative", false)).toBe("3");
    });

    it("keeps the cursor's own line absolute", () => {
        // A zero there says nothing; the real number is what you need
        // when jumping to or citing the line.
        expect(formatLineNumber(4, 4, "relative", false)).toBe("4");
    });

    it("goes absolute in mixed mode while inserting", () => {
        expect(formatLineNumber(7, 4, "mixed", true)).toBe("7");
        expect(formatLineNumber(7, 4, "mixed", false)).toBe("3");
    });
});

describe("the gutter", () => {
    /**
     * Renders a document and reads the numbers out of the gutter.
     *
     * @param mode - The numbering mode to apply.
     * @param cursorLine - Line to put the cursor on, 1-based.
     * @returns The gutter's text, line by line.
     */
    function renderGutter(
        mode: LineNumberMode,
        cursorLine: number,
        modalMode: ModalMode = "vim",
    ): string[] {
        const doc = "one\ntwo\nthree\nfour\nfive";
        const parent = document.createElement("div");
        document.body.appendChild(parent);

        const view = new EditorView({
            doc,
            parent,
            extensions: [basicSetup, lineNumbersExtensionForMode(mode, modalMode)],
        });

        try {
            view.dispatch({ selection: { anchor: view.state.doc.line(cursorLine).from } });

            return [...view.dom.querySelectorAll(".cm-lineNumbers .cm-gutterElement")]
                .map((element) => element.textContent ?? "")
                // The gutter carries a hidden spacer element sized to the
                // widest number, which is not one of the rendered lines.
                .filter((text) => text.length > 0)
                .slice(1);
        } finally {
            view.destroy();
            parent.remove();
        }
    }

    it("numbers lines absolutely by default", () => {
        expect(renderGutter("absolute", 3)).toEqual(["1", "2", "3", "4", "5"]);
    });

    it("numbers lines relative to the cursor", () => {
        expect(renderGutter("relative", 3)).toEqual(["2", "1", "3", "1", "2"]);
    });

    it("renumbers as the cursor moves", () => {
        // The gutter must re-render on selection change, not only on
        // the first paint — the whole point of driving it from a facet.
        expect(renderGutter("relative", 1)).toEqual(["1", "1", "2", "3", "4"]);
        expect(renderGutter("relative", 5)).toEqual(["4", "3", "2", "1", "5"]);
    });

    it("ignores the setting entirely without modal editing", () => {
        // Counting from the cursor is for modal motions, so the whole
        // feature is gated on Vim or Helix being on. The preference is
        // ignored rather than cleared, so it returns when they do.
        expect(renderGutter("relative", 3, "none")).toEqual(["1", "2", "3", "4", "5"]);
        expect(renderGutter("mixed", 3, "none")).toEqual(["1", "2", "3", "4", "5"]);
    });

    it("applies under helix as well as vim", () => {
        expect(renderGutter("relative", 3, "helix")).toEqual(["2", "1", "3", "1", "2"]);
    });
});
