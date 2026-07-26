/**
 * Test suite for the live preview's list-item scanner.
 */

import { describe, it, expect } from "vitest";
import {
    enumerateLabel,
    findListItems,
} from "../views/editor/TextEditor/LivePreview/findListItems";

/** Wraps lines in a `\begin{name}...\end{name}` environment. */
function env(name: string, body: string): string {
    return `\\begin{${name}}\n${body}\n\\end{${name}}`;
}

describe("findListItems", () => {
    it("renders itemize items as bullets", () => {
        const doc = env("itemize", "\\item one\n\\item two");

        expect(findListItems(doc).map((item) => item.marker)).toEqual(["•", "•"]);
    });

    it("cycles bullet shapes by nesting depth", () => {
        const inner = env("itemize", "\\item deep");
        const doc = env("itemize", `\\item outer\n${inner}`);

        expect(findListItems(doc).map((item) => item.marker)).toEqual(["•", "◦"]);
    });

    it("numbers enumerate items", () => {
        const doc = env("enumerate", "\\item one\n\\item two\n\\item three");

        expect(findListItems(doc).map((item) => item.marker)).toEqual(["1.", "2.", "3."]);
    });

    it("restarts nested enumerate numbering and resumes the outer counter", () => {
        const inner = env("enumerate", "\\item a\n\\item b");
        const doc = env("enumerate", `\\item first\n${inner}\n\\item second`);

        expect(findListItems(doc).map((item) => item.marker)).toEqual([
            "1.",
            "(a)",
            "(b)",
            "2.",
        ]);
    });

    it("uses enumerate depth for labels, ignoring itemize levels", () => {
        const inner = env("enumerate", "\\item numbered");
        const doc = env("itemize", `\\item bullet\n${inner}`);

        // The enumerate is list-depth 2 but enumerate-depth 1: `1.`.
        expect(findListItems(doc).map((item) => item.marker)).toEqual(["•", "1."]);
    });

    it("reports token offsets and list depth", () => {
        const doc = "\\begin{itemize}\n\\item x\n\\end{itemize}";

        expect(findListItems(doc)).toEqual([{ from: 16, to: 21, marker: "•", depth: 1 }]);
    });

    it("renders a custom label in place of the marker", () => {
        const doc = env("itemize", "\\item[custom] one\n\\item two");

        const items = findListItems(doc);

        expect(items).toHaveLength(2);
        expect(items[0]?.marker).toBe("custom");
        expect(items[1]?.marker).toBe("•");
    });

    it("covers the whole custom label so no bracket is left behind", () => {
        const doc = env("itemize", "\\item[custom] one");
        const item = findListItems(doc)[0];

        expect(doc.slice(item?.from, item?.to)).toBe("\\item[custom]");
    });

    it("keeps the default marker for an empty custom label", () => {
        const doc = env("itemize", "\\item[] one");

        expect(findListItems(doc)[0]?.marker).toBe("•");
    });

    it("ignores a bracket on the next line", () => {
        // The label must follow `\item` directly; a bracket further
        // down belongs to the item's text.
        const doc = env("itemize", "\\item\n[not a label] one");

        expect(findListItems(doc)[0]?.marker).toBe("•");
    });

    it("skips items outside any list environment", () => {
        expect(findListItems("\\item stray")).toEqual([]);
        expect(findListItems(env("center", "\\item stray"))).toEqual([]);
    });

    it("does not match longer commands starting with item", () => {
        const doc = env("itemize", "\\itemsep\n\\item one");

        expect(findListItems(doc)).toHaveLength(1);
    });

    it("skips escaped tokens", () => {
        const doc = env("itemize", "\\\\item not-an-item");

        expect(findListItems(doc)).toEqual([]);
    });
});

describe("enumerateLabel", () => {
    it("formats each depth style", () => {
        expect(enumerateLabel(1, 2)).toBe("2.");
        expect(enumerateLabel(2, 1)).toBe("(a)");
        expect(enumerateLabel(2, 26)).toBe("(z)");
        expect(enumerateLabel(3, 4)).toBe("iv.");
        expect(enumerateLabel(4, 2)).toBe("B.");
    });

    it("formats roman numerals", () => {
        expect(enumerateLabel(3, 1)).toBe("i.");
        expect(enumerateLabel(3, 9)).toBe("ix.");
        expect(enumerateLabel(3, 14)).toBe("xiv.");
    });
});
