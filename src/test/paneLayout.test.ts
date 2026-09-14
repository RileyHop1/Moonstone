/**
 * Tests for the editor area's split layout.
 *
 * The tree is the whole model for what the user sees, so it is worth
 * pinning down precisely: splitting, collapsing, and the rule that
 * keeps repeated splits in one direction flat rather than nested.
 */

import { describe, expect, it } from "vitest";
import {
    closePane,
    createLayout,
    findPane,
    focusAfterClose,
    listPanes,
    nextPaneId,
    setPaneFile,
    splitPane,
} from "../views/ProjectPage/paneLayout";
import type { PaneNode } from "../views/ProjectPage/paneLayout";

/** The paths shown, in reading order. */
function paths(node: PaneNode): readonly (string | null)[] {
    return listPanes(node).map((pane) => pane.path);
}

describe("paneLayout", () => {
    it("starts as a single pane", () => {
        const layout = createLayout("main.tex");

        expect(layout.kind).toBe("leaf");
        expect(paths(layout)).toEqual(["main.tex"]);
    });

    it("mints a distinct id per pane", () => {
        expect(nextPaneId()).not.toBe(nextPaneId());
    });

    describe("splitting", () => {
        it("puts a pane to the right", () => {
            const layout = createLayout("main.tex");
            const target = listPanes(layout)[0]?.id ?? "";

            const split = splitPane(layout, target, "right", "notes.tex", nextPaneId());

            expect(split.kind).toBe("split");
            expect(paths(split)).toEqual(["main.tex", "notes.tex"]);
        });

        it("puts a pane to the left, before the original", () => {
            const layout = createLayout("main.tex");
            const target = listPanes(layout)[0]?.id ?? "";

            const split = splitPane(layout, target, "left", "notes.tex", nextPaneId());

            expect(paths(split)).toEqual(["notes.tex", "main.tex"]);
        });

        it("splits vertically for a drop on the bottom", () => {
            const layout = createLayout("main.tex");
            const target = listPanes(layout)[0]?.id ?? "";

            const split = splitPane(layout, target, "bottom", "notes.tex", nextPaneId());

            expect(split.kind === "split" && split.direction).toBe("column");
        });

        it("keeps repeated splits in one direction flat", () => {
            // Three splits to the right should give three columns, not
            // three levels of nesting.
            let layout: PaneNode = createLayout("one.tex");
            for (const path of ["two.tex", "three.tex"]) {
                const panes = listPanes(layout);
                const last = panes[panes.length - 1]?.id ?? "";
                layout = splitPane(layout, last, "right", path, nextPaneId());
            }

            expect(paths(layout)).toEqual(["one.tex", "two.tex", "three.tex"]);
            expect(layout.kind === "split" && layout.children.length).toBe(3);
            expect(
                layout.kind === "split" && layout.children.every((c) => c.kind === "leaf"),
            ).toBe(true);
        });

        it("nests when the new split runs the other way", () => {
            let layout: PaneNode = createLayout("one.tex");
            const first = listPanes(layout)[0]?.id ?? "";
            layout = splitPane(layout, first, "right", "two.tex", nextPaneId());

            // Splitting the second column downwards has to nest: a row
            // cannot hold a stacked pair as a sibling.
            const second = listPanes(layout)[1]?.id ?? "";
            layout = splitPane(layout, second, "bottom", "three.tex", nextPaneId());

            expect(paths(layout)).toEqual(["one.tex", "two.tex", "three.tex"]);
            expect(layout.kind === "split" && layout.direction).toBe("row");
            expect(layout.kind === "split" && layout.children[1]?.kind).toBe("split");
        });

        it("leaves the layout alone for an unknown pane", () => {
            const layout = createLayout("main.tex");

            expect(splitPane(layout, "nope", "right", "x.tex", nextPaneId())).toEqual(layout);
        });
    });

    describe("closing", () => {
        it("collapses a split back to its remaining pane", () => {
            const layout = createLayout("main.tex");
            const first = listPanes(layout)[0]?.id ?? "";
            const split = splitPane(layout, first, "right", "notes.tex", nextPaneId());

            const closed = closePane(split, listPanes(split)[1]?.id ?? "");

            expect(closed.kind).toBe("leaf");
            expect(paths(closed)).toEqual(["main.tex"]);
        });

        it("keeps the other siblings when one of three closes", () => {
            let layout: PaneNode = createLayout("one.tex");
            for (const path of ["two.tex", "three.tex"]) {
                const panes = listPanes(layout);
                const last = panes[panes.length - 1]?.id ?? "";
                layout = splitPane(layout, last, "right", path, nextPaneId());
            }

            const closed = closePane(layout, listPanes(layout)[1]?.id ?? "");

            expect(paths(closed)).toEqual(["one.tex", "three.tex"]);
        });

        it("refuses to remove the last pane", () => {
            // An editor area with no panes has nowhere to open the next
            // file, so the final close is a no-op.
            const layout = createLayout("main.tex");

            expect(closePane(layout, listPanes(layout)[0]?.id ?? "")).toEqual(layout);
        });

        it("collapses nested splits left holding one child", () => {
            let layout: PaneNode = createLayout("one.tex");
            const first = listPanes(layout)[0]?.id ?? "";
            layout = splitPane(layout, first, "right", "two.tex", nextPaneId());
            const second = listPanes(layout)[1]?.id ?? "";
            layout = splitPane(layout, second, "bottom", "three.tex", nextPaneId());

            // Removing one of the stacked pair should leave a plain row
            // of two, not a row containing a one-child column.
            const closed = closePane(layout, listPanes(layout)[2]?.id ?? "");

            expect(paths(closed)).toEqual(["one.tex", "two.tex"]);
            expect(
                closed.kind === "split" && closed.children.every((c) => c.kind === "leaf"),
            ).toBe(true);
        });
    });

    describe("focus after closing", () => {
        it("keeps the preferred pane when it survives", () => {
            const layout = createLayout("main.tex");
            const only = listPanes(layout)[0]?.id ?? "";

            expect(focusAfterClose(layout, only)).toBe(only);
        });

        it("falls back to the first pane when the preferred one is gone", () => {
            const layout = createLayout("main.tex");

            expect(focusAfterClose(layout, "closed-pane")).toBe(listPanes(layout)[0]?.id ?? "");
        });
    });

    it("changes the file a pane shows", () => {
        const layout = createLayout("main.tex");
        const only = listPanes(layout)[0]?.id ?? "";

        expect(paths(setPaneFile(layout, only, "other.tex"))).toEqual(["other.tex"]);
    });

    it("finds a pane by id, and reports a missing one", () => {
        const layout = createLayout("main.tex");
        const only = listPanes(layout)[0]?.id ?? "";

        expect(findPane(layout, only)?.path).toBe("main.tex");
        expect(findPane(layout, "nope")).toBeNull();
    });
});
