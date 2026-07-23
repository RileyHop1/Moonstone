/**
 * Test suite for the shared brace-matching helper.
 */

import { describe, it, expect } from "vitest";
import { findGroupEnd } from "../views/editor/TextEditor/LivePreview/braces";

describe("findGroupEnd", () => {
    it("matches a flat group", () => {
        expect(findGroupEnd("{abc}", 0)).toBe(4);
    });

    it("matches a group at a non-zero index", () => {
        expect(findGroupEnd("xx{a}", 2)).toBe(4);
    });

    it("skips nested groups", () => {
        //                    0123456
        expect(findGroupEnd("{a{b}c}", 0)).toBe(6);
    });

    it("ignores escaped braces", () => {
        //                    0 12345 678
        expect(findGroupEnd("{\\{ab\\}c}", 0)).toBe(8);
    });

    it("returns -1 for an unbalanced group", () => {
        expect(findGroupEnd("{a{b}", 0)).toBe(-1);
    });

    it("returns -1 when openIndex is not an opening brace", () => {
        expect(findGroupEnd("abc", 0)).toBe(-1);
    });
});
