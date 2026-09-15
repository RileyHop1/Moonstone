/**
 * Tests that the layout tree renders as the nested rows and columns it
 * describes, and that each pane gets the share of space the model gives
 * it.
 *
 * `paneLayout.test.ts` proves the tree arithmetic; this proves the tree
 * actually reaches the screen, which is the half that would otherwise
 * be caught only by looking at the running app.
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { PaneTree } from "../views/ProjectPage/PaneTree";
import type { PaneDocument } from "../views/ProjectPage/EditorPane";
import {
    createLayout,
    createPaneIdFactory,
    listPanes,
    splitPane,
} from "../views/ProjectPage/paneLayout";
import type { PaneId, PaneNode } from "../views/ProjectPage/paneLayout";
import type { EditorConfiguration } from "../views/editor/TextEditor/editorConfiguration";

const CONFIGURATION: EditorConfiguration = {
    viewMode: "live",
    modalMode: "none",
    spellCheckEnabled: false,
    theme: "dark",
    lineNumberMode: "absolute",
    showDiagnostics: false,
    references: [],
};

/**
 * Renders a layout with no documents open in any pane.
 *
 * @param layout - The tree to render.
 * @param documents - Optional documents, keyed by pane.
 * @returns The rendered container.
 */
function renderTree(
    layout: PaneNode,
    documents: ReadonlyMap<PaneId, PaneDocument> = new Map(),
): HTMLElement {
    const panes = listPanes(layout);
    const firstId = panes[0]?.id;
    if (firstId === undefined) throw new Error("The layout has no panes");

    const { container } = render(
        <PaneTree
            node={layout}
            documents={documents}
            dirtyPanes={new Set()}
            activePaneId={firstId}
            canClose={panes.length > 1}
            configuration={CONFIGURATION}
            onActivate={vi.fn()}
            onDropFile={vi.fn()}
            onClose={vi.fn()}
            onViewReady={vi.fn()}
            onViewDestroyed={vi.fn()}
            onDocChanged={vi.fn()}
            onSaveRequested={vi.fn()}
            onDiagnosticsToggled={vi.fn()}
        />,
    );

    return container;
}

/** Builds a row of `count` panes, split repeatedly to the right. */
function rowOf(count: number): PaneNode {
    const nextId = createPaneIdFactory();
    let layout = createLayout("one.tex", nextId());

    for (let index = 1; index < count; index++) {
        const panes = listPanes(layout);
        const target = panes[panes.length - 1];
        if (!target) throw new Error("The layout lost its panes");

        layout = splitPane(layout, target.id, "right", `file-${index}.tex`, {
            paneId: nextId(),
            splitId: nextId(),
        });
    }

    return layout;
}

describe("PaneTree", () => {
    it("renders a lone pane without a split wrapper", () => {
        const container = renderTree(createLayout("main.tex", "pane-1"));

        expect(container.querySelectorAll(".editor-pane")).toHaveLength(1);
        expect(container.querySelector(".pane-split")).toBeNull();
    });

    it("renders a row of panes", () => {
        const container = renderTree(rowOf(3));

        expect(container.querySelectorAll(".editor-pane")).toHaveLength(3);
        expect(container.querySelector(".pane-split-row")).not.toBeNull();
    });

    it("renders a column split as a column", () => {
        const layout = splitPane(
            createLayout("one.tex", "pane-1"),
            "pane-1",
            "bottom",
            "two.tex",
            { paneId: "pane-2", splitId: "split-1" },
        );

        const container = renderTree(layout);

        expect(container.querySelector(".pane-split-column")).not.toBeNull();
    });

    it("nests a split inside a split", () => {
        const nextId = createPaneIdFactory();
        let layout = createLayout("one.tex", nextId());
        layout = splitPane(layout, "pane-1", "right", "two.tex", {
            paneId: nextId(),
            splitId: nextId(),
        });
        layout = splitPane(layout, "pane-2", "bottom", "three.tex", {
            paneId: nextId(),
            splitId: nextId(),
        });

        const container = renderTree(layout);

        expect(container.querySelector(".pane-split-row")).not.toBeNull();
        expect(container.querySelector(".pane-split-row .pane-split-column")).not.toBeNull();
        expect(container.querySelectorAll(".editor-pane")).toHaveLength(3);
    });

    it("gives two panes an equal share", () => {
        const container = renderTree(rowOf(2));
        const panes = container.querySelectorAll<HTMLElement>(".editor-pane");

        expect(panes[0]?.style.flexGrow).toBe("0.5");
        expect(panes[1]?.style.flexGrow).toBe("0.5");
    });

    it("renders unequal shares after a nested split", () => {
        // Splitting the second of two panes leaves shares of 0.5 / 0.25
        // / 0.25; without this the CSS `flex: 1` would show three equal
        // columns whatever the model said (finding A-10).
        const nextId = createPaneIdFactory();
        let layout = createLayout("one.tex", nextId());
        layout = splitPane(layout, "pane-1", "right", "two.tex", {
            paneId: nextId(),
            splitId: nextId(),
        });
        layout = splitPane(layout, "pane-2", "right", "three.tex", {
            paneId: nextId(),
            splitId: nextId(),
        });

        const container = renderTree(layout);
        const grows = Array.from(
            container.querySelectorAll<HTMLElement>(".editor-pane"),
            (pane) => pane.style.flexGrow,
        );

        expect(grows).toEqual(["0.5", "0.25", "0.25"]);
    });

    it("names the file each pane has open", () => {
        const documents = new Map<PaneId, PaneDocument>([
            ["pane-1", { path: "C:\\p\\main.tex", initialDoc: "" }],
        ]);

        const container = renderTree(createLayout("main.tex", "pane-1"), documents);

        expect(container.textContent).toContain("main.tex");
    });

    it("offers no close button when only one pane is open", () => {
        const container = renderTree(createLayout("main.tex", "pane-1"));

        expect(container.querySelector(".editor-pane-close")).toBeNull();
    });

    it("offers a close button on each pane once there are several", () => {
        const container = renderTree(rowOf(3));

        expect(container.querySelectorAll(".editor-pane-close")).toHaveLength(3);
    });
});
