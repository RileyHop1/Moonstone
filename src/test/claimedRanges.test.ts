/**
 * Test suite for the claimed-range bookkeeping the block layer uses to
 * keep replacing decorations from overlapping.
 *
 * The structure merges on insert so its intervals stay disjoint, which
 * is what lets the overlap query be a single binary search. A bug here
 * is quiet — decorations would simply go missing — so the merge cases
 * are pinned directly.
 */

import { describe, it, expect } from "vitest";
import { ClaimedRanges } from "../views/editor/TextEditor/LivePreview";

describe("ClaimedRanges", () => {
    it("reports nothing claimed when empty", () => {
        const claimed = new ClaimedRanges();

        expect(claimed.overlaps(0, 100)).toBe(false);
    });

    it("detects a region overlapping a claim", () => {
        const claimed = new ClaimedRanges();
        claimed.add(10, 20);

        expect(claimed.overlaps(15, 25)).toBe(true);
        expect(claimed.overlaps(5, 15)).toBe(true);
        expect(claimed.overlaps(12, 18)).toBe(true);
        expect(claimed.overlaps(0, 100)).toBe(true);
    });

    it("ignores regions that miss every claim", () => {
        const claimed = new ClaimedRanges();
        claimed.add(10, 20);

        expect(claimed.overlaps(0, 9)).toBe(false);
        expect(claimed.overlaps(21, 30)).toBe(false);
    });

    it("treats touching endpoints as overlapping", () => {
        // Decoration ranges are half-open but CodeMirror rejects
        // replaces that share an endpoint, so touching counts.
        const claimed = new ClaimedRanges();
        claimed.add(10, 20);

        expect(claimed.overlaps(20, 30)).toBe(true);
        expect(claimed.overlaps(0, 10)).toBe(true);
    });

    it("finds claims added out of order", () => {
        const claimed = new ClaimedRanges();
        claimed.add(100, 110);
        claimed.add(10, 20);
        claimed.add(50, 60);

        expect(claimed.overlaps(11, 12)).toBe(true);
        expect(claimed.overlaps(55, 56)).toBe(true);
        expect(claimed.overlaps(105, 106)).toBe(true);
        expect(claimed.overlaps(30, 40)).toBe(false);
        expect(claimed.overlaps(70, 90)).toBe(false);
    });

    it("merges overlapping claims", () => {
        const claimed = new ClaimedRanges();
        claimed.add(10, 20);
        claimed.add(15, 30);

        expect(claimed.overlaps(25, 26)).toBe(true);
        expect(claimed.overlaps(31, 40)).toBe(false);
    });

    it("merges a claim spanning several existing ones", () => {
        const claimed = new ClaimedRanges();
        claimed.add(10, 20);
        claimed.add(40, 50);
        claimed.add(70, 80);

        // Swallows the first two but not the third.
        claimed.add(5, 55);

        expect(claimed.overlaps(0, 4)).toBe(false);
        expect(claimed.overlaps(30, 31)).toBe(true);
        expect(claimed.overlaps(56, 69)).toBe(false);
        expect(claimed.overlaps(75, 76)).toBe(true);
    });

    it("absorbs a claim nested inside an existing one", () => {
        const claimed = new ClaimedRanges();
        claimed.add(10, 50);
        claimed.add(20, 30);

        // The wider claim must survive intact.
        expect(claimed.overlaps(45, 46)).toBe(true);
        expect(claimed.overlaps(51, 60)).toBe(false);
    });

    it("keeps adjacent claims queryable after merging", () => {
        const claimed = new ClaimedRanges();
        claimed.add(10, 20);
        claimed.add(20, 30);

        expect(claimed.overlaps(10, 10)).toBe(true);
        expect(claimed.overlaps(25, 25)).toBe(true);
        expect(claimed.overlaps(31, 35)).toBe(false);
    });

    it("handles zero-length claims", () => {
        const claimed = new ClaimedRanges();
        claimed.add(10, 10);

        expect(claimed.overlaps(10, 10)).toBe(true);
        expect(claimed.overlaps(11, 12)).toBe(false);
    });

    it("stays correct across many interleaved claims", () => {
        const claimed = new ClaimedRanges();

        // Disjoint claims every 10 units, added back to front.
        for (let start = 990; start >= 0; start -= 10) claimed.add(start, start + 4);

        expect(claimed.overlaps(2, 3)).toBe(true);
        expect(claimed.overlaps(505, 508)).toBe(false);
        expect(claimed.overlaps(500, 502)).toBe(true);
        expect(claimed.overlaps(996, 999)).toBe(false);
    });
});
