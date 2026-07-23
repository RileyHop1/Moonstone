/**
 * Test suite for the live preview's special-character scanner.
 */

import { describe, it, expect } from "vitest";
import { findSymbolRanges, SYMBOLS } from "../views/editor/TextEditor/LivePreview/symbols";

describe("findSymbolRanges", () => {
    it("finds a known command", () => {
        const ranges = findSymbolRanges("x \\alpha y", 0, []);

        expect(ranges).toEqual([{ from: 2, to: 8, symbol: "α" }]);
    });

    it("offsets positions into document space", () => {
        const ranges = findSymbolRanges("\\pi", 50, []);

        expect(ranges).toEqual([{ from: 50, to: 53, symbol: "π" }]);
    });

    it("ignores unknown commands and longer words", () => {
        expect(findSymbolRanges("\\alphabet \\unknown", 0, [])).toEqual([]);
    });

    it("ignores commands preceded by a backslash (line breaks)", () => {
        expect(findSymbolRanges("a \\\\alpha", 0, [])).toEqual([]);
    });

    it("skips commands inside excluded (math) ranges", () => {
        const text = "$\\alpha$ \\beta";
        const exclude = [{ from: 0, to: 8 }];

        const ranges = findSymbolRanges(text, 0, exclude);

        expect(ranges).toEqual([{ from: 9, to: 14, symbol: "β" }]);
    });

    it("maps a representative sample of symbols", () => {
        expect(SYMBOLS["leq"]).toBe("≤");
        expect(SYMBOLS["infty"]).toBe("∞");
        expect(SYMBOLS["Rightarrow"]).toBe("⇒");
        expect(SYMBOLS["Omega"]).toBe("Ω");
    });
});
