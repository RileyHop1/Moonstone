/**
 * Tests for the editor area's split layout.
 *
 * The tree is the whole model for what the user sees, so it is worth
 * pinning down precisely: splitting, collapsing, the rule that keeps
 * repeated splits in one direction flat rather than nested, and how the
 * space between panes is divided.
 */

import { describe, expect, it } from "vitest";
import {
    closePane,
    createLayout,
    createPaneIdFactory,
    edgeForPoint,
    findPane,
    focusAfterClose,
    listPanes,
    boundaryShares,
    MIN_PANE_PX,
    resizeSplit,
    setPaneFile,
    splitPane,
} from "../views/ProjectPage/paneLayout";
import type { PaneId, PaneNode, PaneSplit } from "../views/ProjectPage/paneLayout";

/** The paths shown, in reading order. */
function paths(node: PaneNode): readonly (string | null)[] {
    return listPanes(node).map((pane) => pane.path);
}

/**
 * The id of the pane at one position in reading order.
 *
 * Throws rather than falling back, because a fallback is what makes a
 * broken layout look like a failed comparison somewhere else: a
 * regression that drops a pane would otherwise substitute `""` and
 * compare it against an id that can never match, or — worse — make a
 * no-op assertion pass for the wrong reason.
 *
 * @param node - The layout root.
 * @param index - Position in reading order.
 * @returns That pane's id.
 */
function paneIdAt(node: PaneNode, index: number): PaneId {
    const pane = listPanes(node)[index];

    if (!pane) {
        throw new Error(
            `Expected a pane at index ${index}, but the layout has ${listPanes(node).length}`,
        );
    }

    return pane.id;
}

/**
 * Narrows a node to a split, failing the test when it is a leaf.
 *
 * @param node - The node to narrow.
 * @returns The same node, typed as a split.
 */
function asSplit(node: PaneNode): PaneSplit {
    if (node.kind !== "split") throw new Error(`Expected a split, got a ${node.kind}`);

    return node;
}

/** Ids for a split, from a fresh factory. */
function ids(factory: () => PaneId) {
    return { paneId: factory(), splitId: factory() };
}

describe("paneLayout", () => {
    it("starts as a single pane", () => {
        const layout = createLayout("main.tex", "pane-1");

        expect(layout.kind).toBe("leaf");
        expect(paths(layout)).toEqual(["main.tex"]);
    });

    it("allows a pane with nothing open", () => {
        const layout = createLayout(null, "pane-1");

        expect(paths(layout)).toEqual([null]);
    });

    describe("id factory", () => {
        it("mints a distinct id per call", () => {
            const nextId = createPaneIdFactory();

            expect(nextId()).not.toBe(nextId());
        });

        it("is independent of any other factory", () => {
            // A module-level counter would make these differ, and would
            // make every test depend on the order the suite ran in.
            expect(createPaneIdFactory()()).toBe(createPaneIdFactory()());
        });

        it("can resume past ids a restored layout already uses", () => {
            const nextId = createPaneIdFactory(7);

            expect(nextId()).toBe("pane-8");
        });
    });

    describe("splitting", () => {
        it("puts a pane to the right", () => {
            const layout = createLayout("main.tex", "pane-1");

            const split = splitPane(layout, "pane-1", "right", "notes.tex", {
                paneId: "pane-2",
                splitId: "split-1",
            });

            expect(split.kind).toBe("split");
            expect(paths(split)).toEqual(["main.tex", "notes.tex"]);
        });

        it("puts a pane to the left, before the target", () => {
            const layout = createLayout("main.tex", "pane-1");

            const split = splitPane(layout, "pane-1", "left", "notes.tex", {
                paneId: "pane-2",
                splitId: "split-1",
            });

            expect(paths(split)).toEqual(["notes.tex", "main.tex"]);
        });

        it("arranges a bottom split as a column", () => {
            const layout = createLayout("main.tex", "pane-1");

            const split = splitPane(layout, "pane-1", "bottom", "notes.tex", {
                paneId: "pane-2",
                splitId: "split-1",
            });

            expect(asSplit(split).direction).toBe("column");
        });

        it("is fully determined by its inputs", () => {
            // The whole point of taking ids as parameters: the same call
            // twice gives the same tree, so it can be asserted by value.
            const layout = createLayout("main.tex", "pane-1");
            const args = [
                "pane-1",
                "right",
                "notes.tex",
                { paneId: "p", splitId: "s" },
            ] as const;

            expect(splitPane(layout, ...args)).toEqual(splitPane(layout, ...args));
        });

        it("keeps repeated splits in one direction flat", () => {
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());

            layout = splitPane(layout, paneIdAt(layout, 0), "right", "two.tex", ids(nextId));
            layout = splitPane(layout, paneIdAt(layout, 1), "right", "three.tex", ids(nextId));

            const split = asSplit(layout);
            expect(split.children).toHaveLength(3);
            expect(split.children.every((child) => child.kind === "leaf")).toBe(true);
            expect(paths(layout)).toEqual(["one.tex", "two.tex", "three.tex"]);
        });

        it("inserts before an existing sibling on a left split", () => {
            // The branch that puts a pane *before* a target already
            // inside a matching split — the append path is what repeated
            // right-splits exercise, so this one needs saying separately.
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());

            layout = splitPane(layout, paneIdAt(layout, 0), "right", "two.tex", ids(nextId));
            layout = splitPane(layout, paneIdAt(layout, 1), "left", "middle.tex", ids(nextId));

            expect(asSplit(layout).children).toHaveLength(3);
            expect(paths(layout)).toEqual(["one.tex", "middle.tex", "two.tex"]);
        });

        it("nests when the split runs the other way", () => {
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());

            layout = splitPane(layout, paneIdAt(layout, 0), "right", "two.tex", ids(nextId));
            layout = splitPane(layout, paneIdAt(layout, 1), "bottom", "three.tex", ids(nextId));

            const split = asSplit(layout);
            expect(split.direction).toBe("row");
            expect(split.children[1]?.kind).toBe("split");
        });

        it("ignores an unknown pane id", () => {
            const layout = createLayout("main.tex", "pane-1");

            const result = splitPane(layout, "nope", "right", "notes.tex", {
                paneId: "pane-2",
                splitId: "split-1",
            });

            expect(result).toEqual(layout);
        });
    });

    describe("sizes", () => {
        it("splits a pane evenly in two", () => {
            const layout = createLayout("one.tex", "pane-1");

            const split = splitPane(layout, "pane-1", "right", "two.tex", {
                paneId: "pane-2",
                splitId: "split-1",
            });

            expect(asSplit(split).sizes).toEqual([0.5, 0.5]);
        });

        it("takes the new pane's share from the pane it split", () => {
            // Splitting one of three panes must not disturb the other
            // two, or every split would quietly reshuffle the whole row.
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());

            layout = splitPane(layout, paneIdAt(layout, 0), "right", "two.tex", ids(nextId));
            layout = splitPane(layout, paneIdAt(layout, 0), "right", "three.tex", ids(nextId));

            // "one" gave half its 0.5 to the newcomer; "two" is untouched.
            expect(asSplit(layout).sizes).toEqual([0.25, 0.25, 0.5]);
        });

        it("always sums to one", () => {
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());

            for (const path of ["two.tex", "three.tex", "four.tex"]) {
                layout = splitPane(layout, paneIdAt(layout, 0), "right", path, ids(nextId));
            }

            const total = asSplit(layout).sizes.reduce((sum, size) => sum + size, 0);
            expect(total).toBeCloseTo(1);
        });

        it("shares a closed pane's space among the survivors, in proportion", () => {
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());

            layout = splitPane(layout, paneIdAt(layout, 0), "right", "two.tex", ids(nextId));
            layout = splitPane(layout, paneIdAt(layout, 0), "right", "three.tex", ids(nextId));
            // Sizes are now [0.25, 0.25, 0.5].

            const { layout: after } = closePane(layout, paneIdAt(layout, 1));

            // The survivors keep their 1:2 ratio.
            expect(asSplit(after).sizes).toEqual([1 / 3, 2 / 3]);
        });
    });

    describe("resizing", () => {
        it("sets a split's shares", () => {
            const layout = splitPane(
                createLayout("one.tex", "pane-1"),
                "pane-1",
                "right",
                "two.tex",
                {
                    paneId: "pane-2",
                    splitId: "split-1",
                },
            );

            const resized = resizeSplit(layout, "split-1", [0.3, 0.7]);

            expect(asSplit(resized).sizes).toEqual([0.3, 0.7]);
        });

        it("normalises shares that do not sum to one", () => {
            const layout = splitPane(
                createLayout("one.tex", "pane-1"),
                "pane-1",
                "right",
                "two.tex",
                {
                    paneId: "pane-2",
                    splitId: "split-1",
                },
            );

            const resized = resizeSplit(layout, "split-1", [300, 100]);

            expect(asSplit(resized).sizes).toEqual([0.75, 0.25]);
        });

        it("refuses a count that does not match the children", () => {
            // Applying these would leave sizes and children out of step,
            // which every other function here assumes cannot happen.
            const layout = splitPane(
                createLayout("one.tex", "pane-1"),
                "pane-1",
                "right",
                "two.tex",
                {
                    paneId: "pane-2",
                    splitId: "split-1",
                },
            );

            expect(resizeSplit(layout, "split-1", [0.2, 0.3, 0.5])).toEqual(layout);
        });

        it.each([
            ["a zero share", [0, 1]],
            ["a negative share", [-0.5, 1.5]],
            ["a non-finite share", [Number.NaN, 1]],
        ])("refuses %s", (_description, sizes) => {
            const layout = splitPane(
                createLayout("one.tex", "pane-1"),
                "pane-1",
                "right",
                "two.tex",
                {
                    paneId: "pane-2",
                    splitId: "split-1",
                },
            );

            expect(resizeSplit(layout, "split-1", sizes)).toEqual(layout);
        });

        it("ignores an unknown split id", () => {
            const layout = createLayout("one.tex", "pane-1");

            expect(resizeSplit(layout, "nope", [1])).toEqual(layout);
        });
    });

    describe("closing", () => {
        it("collapses a two-pane split back to a single pane", () => {
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());
            layout = splitPane(layout, paneIdAt(layout, 0), "right", "two.tex", ids(nextId));

            const { layout: after, closed } = closePane(layout, paneIdAt(layout, 1));

            expect(closed).toBe(true);
            expect(after.kind).toBe("leaf");
            expect(paths(after)).toEqual(["one.tex"]);
        });

        it("removes a pane from the middle of a row", () => {
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());
            layout = splitPane(layout, paneIdAt(layout, 0), "right", "two.tex", ids(nextId));
            layout = splitPane(layout, paneIdAt(layout, 1), "right", "three.tex", ids(nextId));

            const { layout: after } = closePane(layout, paneIdAt(layout, 1));

            expect(paths(after)).toEqual(["one.tex", "three.tex"]);
        });

        it("refuses to remove the last pane, and says so", () => {
            // The distinction matters: a caller that moves focus after a
            // close would otherwise move it off a pane still on screen.
            const layout = createLayout("one.tex", "pane-1");

            const { layout: after, closed } = closePane(layout, "pane-1");

            expect(closed).toBe(false);
            expect(after).toEqual(layout);
        });

        it("reports an unknown pane id as nothing closed", () => {
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());
            layout = splitPane(layout, paneIdAt(layout, 0), "right", "two.tex", ids(nextId));

            const { layout: after, closed } = closePane(layout, "nope");

            expect(closed).toBe(false);
            expect(after).toEqual(layout);
        });

        it("collapses a nested split left holding one child", () => {
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());
            layout = splitPane(layout, paneIdAt(layout, 0), "right", "two.tex", ids(nextId));
            layout = splitPane(layout, paneIdAt(layout, 1), "bottom", "three.tex", ids(nextId));

            const { layout: after } = closePane(layout, paneIdAt(layout, 2));

            const split = asSplit(after);
            expect(split.direction).toBe("row");
            expect(split.children).toHaveLength(2);
            expect(split.children.every((child) => child.kind === "leaf")).toBe(true);
        });
    });

    describe("focus after closing", () => {
        it("keeps the preferred pane when it survived", () => {
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());
            layout = splitPane(layout, paneIdAt(layout, 0), "right", "two.tex", ids(nextId));

            expect(focusAfterClose(layout, paneIdAt(layout, 1))).toBe(paneIdAt(layout, 1));
        });

        it("falls back to the first pane when the preferred one is gone", () => {
            const nextId = createPaneIdFactory();
            let layout = createLayout("one.tex", nextId());
            layout = splitPane(layout, paneIdAt(layout, 0), "right", "two.tex", ids(nextId));

            expect(focusAfterClose(layout, "gone")).toBe(paneIdAt(layout, 0));
        });

        it("falls back to the first pane when nothing was preferred", () => {
            const layout = createLayout("one.tex", "pane-1");

            expect(focusAfterClose(layout, null)).toBe("pane-1");
        });
    });

    describe("edgeForPoint", () => {
        it("resolves a point near the left edge", () => {
            expect(edgeForPoint(10, 300, 800, 600)).toBe("left");
        });

        it("resolves a point near the bottom edge", () => {
            expect(edgeForPoint(400, 590, 800, 600)).toBe("bottom");
        });

        it("treats the middle as no edge at all", () => {
            expect(edgeForPoint(400, 300, 800, 600)).toBeNull();
        });

        it("compares distances in pixels, not fractions of each axis", () => {
            // On a 1600x300 pane, a point 200px from the left and 70px
            // from the top is physically nearest the top. Comparing
            // fractions of each axis instead gives 200/1600 = 0.125
            // against 70/300 = 0.233, so the *left* edge wins despite
            // being nearly three times further away (finding A-9).
            expect(edgeForPoint(200, 70, 1600, 300)).toBe("top");
        });

        it("keeps edge zones usable on a very large pane", () => {
            // A quarter of a 4000px-wide pane would make 1000px of it a
            // drop zone; the cap keeps it to something pointable.
            expect(edgeForPoint(300, 1000, 4000, 2000)).toBeNull();
            expect(edgeForPoint(100, 1000, 4000, 2000)).toBe("left");
        });

        it("has no edges when the pane has no area", () => {
            // jsdom reports every rectangle as 0x0.
            expect(edgeForPoint(0, 0, 0, 0)).toBeNull();
        });

        it("resolves a corner to whichever edge is physically nearer", () => {
            expect(edgeForPoint(5, 40, 800, 600)).toBe("left");
            expect(edgeForPoint(40, 5, 800, 600)).toBe("top");
        });
    });

    it("changes the file a pane shows", () => {
        const layout = createLayout("one.tex", "pane-1");

        expect(paths(setPaneFile(layout, "pane-1", "two.tex"))).toEqual(["two.tex"]);
    });

    it("finds a pane by id, and reports a missing one", () => {
        const layout = createLayout("one.tex", "pane-1");

        expect(findPane(layout, "pane-1")?.path).toBe("one.tex");
        expect(findPane(layout, "nope")).toBeNull();
    });
});

describe("boundaryShares", () => {
    it("moves space from one pane to its neighbour", () => {
        // 400px and 400px, dragged 100px right, out of a combined 0.5.
        const shares = boundaryShares(400, 400, 100, 0.5);

        expect(shares).toEqual([0.3125, 0.1875]);
    });

    it("leaves the pair's combined share untouched", () => {
        // The rest of the split must not move when one boundary does.
        const shares = boundaryShares(400, 400, 137, 0.5);

        expect((shares?.[0] ?? 0) + (shares?.[1] ?? 0)).toBeCloseTo(0.5);
    });

    it("does not drag a pane below the minimum", () => {
        const shares = boundaryShares(400, 400, -10_000, 1);

        expect(shares?.[0]).toBeCloseTo(MIN_PANE_PX / 800);
    });

    it("does not drag the neighbour below the minimum", () => {
        const shares = boundaryShares(400, 400, 10_000, 1);

        expect(shares?.[1]).toBeCloseTo(MIN_PANE_PX / 800);
    });

    it("refuses a pair too small to divide", () => {
        // Both minimums cannot fit, so there is no honest answer and
        // squashing one side arbitrarily would be worse than nothing.
        expect(boundaryShares(100, 100, 20, 1)).toBeNull();
    });

    it("is a no-op for a drag that has not moved", () => {
        expect(boundaryShares(300, 500, 0, 1)).toEqual([0.375, 0.625]);
    });
});
