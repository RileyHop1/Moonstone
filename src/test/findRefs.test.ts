/**
 * Test suite for the live preview's reference-command scanner.
 */

import { describe, it, expect } from "vitest";
import { findRefRanges } from "../views/editor/TextEditor/LivePreview/findRefs";

describe("findRefRanges", () => {
    it("finds each command kind", () => {
        expect(findRefRanges("\\ref{a}", 0, [])[0]?.kind).toBe("ref");
        expect(findRefRanges("\\eqref{a}", 0, [])[0]?.kind).toBe("eqref");
        expect(findRefRanges("\\cite{a}", 0, [])[0]?.kind).toBe("cite");
        expect(findRefRanges("\\label{a}", 0, [])[0]?.kind).toBe("label");
    });

    it("reports exact offsets", () => {
        //           0123456789
        const text = "see \\ref{fig:one}!";

        expect(findRefRanges(text, 0, [])).toEqual([
            { kind: "ref", from: 4, to: 17, keys: ["fig:one"] },
        ]);
    });

    it("applies the document offset", () => {
        expect(findRefRanges("\\ref{a}", 50, [])).toEqual([
            { kind: "ref", from: 50, to: 57, keys: ["a"] },
        ]);
    });

    it("splits and trims multi-key citations", () => {
        expect(findRefRanges("\\cite{knuth84, lamport94 }", 0, [])[0]?.keys).toEqual([
            "knuth84",
            "lamport94",
        ]);
    });

    it("leaves optional-argument citations raw", () => {
        expect(findRefRanges("\\cite[p.~3]{knuth84}", 0, [])).toEqual([]);
    });

    it("skips empty and whitespace-only key lists", () => {
        expect(findRefRanges("\\ref{}", 0, [])).toEqual([]);
        expect(findRefRanges("\\cite{ , }", 0, [])).toEqual([]);
    });

    it("skips commands starting inside an excluded interval", () => {
        const text = "$\\eqref{eq:one}$";

        expect(findRefRanges(text, 0, [{ from: 0, to: 16 }])).toEqual([]);
    });

    it("skips escaped commands", () => {
        expect(findRefRanges("\\\\ref{a}", 0, [])).toEqual([]);
    });
});
