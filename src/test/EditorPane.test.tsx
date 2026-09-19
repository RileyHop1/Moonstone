/**
 * Tests for one editor pane's drop behaviour.
 *
 * `paneLayout.test.ts` covers the tree model; this covers the part that
 * touches the DOM, which is where findings A-2 (any dragged text was
 * treated as a path) and A-4 (directories were accepted) lived.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditorPane } from "../views/ProjectPage/EditorPane";
import { DEFAULT_EDITOR_PROFILE } from "../views/editor/TextEditor/editorProfile";
import type { EditorConfiguration } from "../views/editor/TextEditor/editorConfiguration";
import { writeFileDragPayload } from "../shared/dragPayload";
import type { FileDragPayload } from "../shared/dragPayload";
import { fireDragEvent, makeDataTransfer } from "./dataTransfer";

const CONFIGURATION: EditorConfiguration = {
    viewMode: "live",
    modalMode: "none",
    spellCheckEnabled: false,
    theme: "dark",
    lineNumberMode: "absolute",
    showDiagnostics: false,
    references: [],
    profile: DEFAULT_EDITOR_PROFILE,
    isFrozen: false,
};

/**
 * Renders a pane with no document, and reports what it was asked to do.
 *
 * @returns The pane element plus the drop and close spies.
 */
function renderPane() {
    const onDropFile = vi.fn();
    const onClose = vi.fn();
    const onActivate = vi.fn();

    render(
        <EditorPane
            paneId="pane-1"
            document={null}
            isActive
            isDirty={false}
            canClose
            configuration={CONFIGURATION}
            onActivate={onActivate}
            onDropFile={onDropFile}
            onClose={onClose}
            onViewReady={vi.fn()}
            onViewDestroyed={vi.fn()}
            onDocChanged={vi.fn()}
            onSaveRequested={vi.fn()}
            onDiagnosticsToggled={vi.fn()}
            pdfTarget={null}
            onPdfDoubleClick={vi.fn()}
        />,
    );

    // The placeholder is inside the pane; the pane itself is the
    // section that carries the drop handlers.
    const pane = screen.getByText("Select a file to start editing.").closest("section");
    if (!pane) throw new Error("The pane did not render");

    return { pane, onDropFile, onClose, onActivate };
}

/**
 * Drags something over the pane and drops it.
 *
 * @param pane - The pane element.
 * @param transfer - The drag's payload.
 */
function dropOnPane(pane: Element, transfer: DataTransfer): void {
    // A drop is always preceded by enter/over; the pane measures itself
    // on enter, so skipping it would not reflect a real gesture.
    fireEvent.dragEnter(pane, { dataTransfer: transfer });
    fireEvent.dragOver(pane, { dataTransfer: transfer });
    fireEvent.drop(pane, { dataTransfer: transfer });
}

/**
 * Drops `transfer` on a pane that has already accepted a drag.
 *
 * The pane refuses a foreign drag twice over: once by not arming itself
 * on `dragenter`, and again by validating the payload on `drop`. Going
 * through a legitimate enter first defeats the former, so what is left
 * under test is the latter — without this, a test for finding A-2 passes
 * even with the drop's validation removed entirely.
 *
 * @param pane - The pane element.
 * @param transfer - The payload actually dropped.
 */
function dropAfterAcceptedEnter(pane: Element, transfer: DataTransfer): void {
    const accepted = transferFor({ kind: "file", path: "C:\\p\\armed.tex" });

    fireEvent.dragEnter(pane, { dataTransfer: accepted });
    fireEvent.dragOver(pane, { dataTransfer: accepted });
    fireEvent.drop(pane, { dataTransfer: transfer });
}

/**
 * Builds a transfer carrying one of the project's entries.
 *
 * @param payload - The entry being dragged.
 * @returns The prepared transfer.
 */
function transferFor(payload: FileDragPayload): DataTransfer {
    const transfer = makeDataTransfer();
    writeFileDragPayload(transfer, payload);
    return transfer;
}

describe("EditorPane drops", () => {
    it("opens a file dropped on it", () => {
        const { pane, onDropFile } = renderPane();

        dropOnPane(pane, transferFor({ kind: "file", path: "C:\\p\\main.tex" }));

        // The side is null — a centre drop — because jsdom reports every
        // rectangle as 0x0, so there are no edges to be near. Which edge
        // a point resolves to is geometry, covered by the pure
        // `edgeForPoint` tests rather than here.
        expect(onDropFile).toHaveBeenCalledTimes(1);
        expect(onDropFile).toHaveBeenCalledWith("pane-1", null, "C:\\p\\main.tex");
    });

    it("ignores a dragged text selection", () => {
        // CodeMirror puts a dragged selection on `text/plain`, which is
        // exactly what the file browser used to use. Without a private
        // type the pane would ask the backend to open the prose.
        const { pane, onDropFile } = renderPane();

        dropOnPane(pane, makeDataTransfer({ "text/plain": "some dragged prose" }));

        expect(onDropFile).not.toHaveBeenCalled();
    });

    it("ignores text dragged in from another application", () => {
        const { pane, onDropFile } = renderPane();

        dropOnPane(
            pane,
            makeDataTransfer({
                "text/plain": "C:\\somewhere\\else.tex",
                "text/html": "<p>C:\\somewhere\\else.tex</p>",
            }),
        );

        expect(onDropFile).not.toHaveBeenCalled();
    });

    it("refuses a directory", () => {
        // Directory rows are draggable so they can be moved between
        // folders, but a pane shows one file and cannot open a folder.
        const { pane, onDropFile } = renderPane();

        dropOnPane(pane, transferFor({ kind: "directory", path: "C:\\p\\chapters" }));

        expect(onDropFile).not.toHaveBeenCalled();
    });

    it("validates the payload on drop, not only on drag-enter", () => {
        // The guard under test is the one in the drop handler itself.
        // See `dropAfterAcceptedEnter` for why that needs saying.
        const { pane, onDropFile } = renderPane();

        dropAfterAcceptedEnter(pane, makeDataTransfer({ "text/plain": "some prose" }));

        expect(onDropFile).not.toHaveBeenCalled();
    });

    it("refuses a directory even once the pane has armed itself", () => {
        const { pane, onDropFile } = renderPane();

        dropAfterAcceptedEnter(
            pane,
            transferFor({ kind: "directory", path: "C:\\p\\chapters" }),
        );

        expect(onDropFile).not.toHaveBeenCalled();
    });

    it("asks for a copy, which the source allows", () => {
        // A `dropEffect` the source does not allow resolves to "none",
        // and then no drop event fires at all (finding A-3).
        const { pane } = renderPane();
        const transfer = transferFor({ kind: "file", path: "C:\\p\\main.tex" });

        fireEvent.dragEnter(pane, { dataTransfer: transfer });
        fireEvent.dragOver(pane, { dataTransfer: transfer });

        expect(transfer.dropEffect).toBe("copy");
        expect(transfer.effectAllowed).toBe("copyMove");
    });

    it("leaves a foreign drag's effect alone so another target can take it", () => {
        const { pane } = renderPane();
        const transfer = makeDataTransfer({ "text/plain": "prose" });

        fireEvent.dragEnter(pane, { dataTransfer: transfer });
        fireEvent.dragOver(pane, { dataTransfer: transfer });

        expect(transfer.dropEffect).toBe("none");
    });

    it("activates the pane it was dropped on", () => {
        const { pane, onActivate } = renderPane();

        dropOnPane(pane, transferFor({ kind: "file", path: "C:\\p\\main.tex" }));

        expect(onActivate).toHaveBeenCalledWith("pane-1");
    });
});

describe("EditorPane drop hint", () => {
    it("keeps the hint while the pointer crosses into a child element", () => {
        // `dragleave` bubbles, so moving onto the header fires one on the
        // pane. Clearing on the first leave made the hint blink (A-8).
        const { pane } = renderPane();
        const transfer = transferFor({ kind: "file", path: "C:\\p\\main.tex" });
        const child = pane.querySelector(".editor-pane-header");
        if (!child) throw new Error("The pane header did not render");

        fireEvent.dragEnter(pane, { dataTransfer: transfer });
        fireEvent.dragOver(pane, { dataTransfer: transfer });
        expect(pane.querySelector(".pane-drop-hint")).not.toBeNull();

        // Entering the child, then leaving the pane on the way in.
        fireEvent.dragEnter(child, { dataTransfer: transfer });
        fireEvent.dragLeave(pane, { dataTransfer: transfer });

        expect(pane.querySelector(".pane-drop-hint")).not.toBeNull();
    });

    it("clears the hint once the drag actually leaves", () => {
        const { pane } = renderPane();
        const transfer = transferFor({ kind: "file", path: "C:\\p\\main.tex" });

        fireEvent.dragEnter(pane, { dataTransfer: transfer });
        fireEvent.dragOver(pane, { dataTransfer: transfer });
        expect(pane.querySelector(".pane-drop-hint")).not.toBeNull();

        fireEvent.dragLeave(pane, { dataTransfer: transfer });

        expect(pane.querySelector(".pane-drop-hint")).toBeNull();
    });

    it("shows no hint for a drag it would not accept", () => {
        const { pane } = renderPane();
        const transfer = makeDataTransfer({ "text/plain": "prose" });

        fireEvent.dragEnter(pane, { dataTransfer: transfer });
        fireEvent.dragOver(pane, { dataTransfer: transfer });

        expect(pane.querySelector(".pane-drop-hint")).toBeNull();
    });
});

describe("EditorPane close button", () => {
    it("closes on request", () => {
        const { onClose } = renderPane();

        fireEvent.click(screen.getByRole("button", { name: /close/i }));

        expect(onClose).toHaveBeenCalledWith("pane-1");
    });
});

describe("EditorPane edge resolution", () => {
    /**
     * Gives the pane a rectangle, since jsdom reports every box as 0x0.
     *
     * @param pane - The pane element.
     */
    function givePaneABox(pane: Element): void {
        vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 800,
            bottom: 600,
            width: 800,
            height: 600,
            toJSON: () => ({}),
        });
    }

    it.each([
        ["left", 10, 300],
        ["right", 790, 300],
        ["top", 400, 10],
        ["bottom", 400, 590],
    ])("reports a drop near the %s edge", (side, clientX, clientY) => {
        const { pane, onDropFile } = renderPane();
        givePaneABox(pane);
        const transfer = transferFor({ kind: "file", path: "C:\\p\\main.tex" });

        fireDragEvent(pane, "dragenter", { dataTransfer: transfer, clientX, clientY });
        fireDragEvent(pane, "dragover", { dataTransfer: transfer, clientX, clientY });
        fireDragEvent(pane, "drop", { dataTransfer: transfer, clientX, clientY });

        expect(onDropFile).toHaveBeenCalledWith("pane-1", side, "C:\\p\\main.tex");
    });

    it("reports a drop in the middle as no edge, which opens in place", () => {
        const { pane, onDropFile } = renderPane();
        givePaneABox(pane);
        const transfer = transferFor({ kind: "file", path: "C:\\p\\main.tex" });

        fireDragEvent(pane, "dragenter", {
            dataTransfer: transfer,
            clientX: 400,
            clientY: 300,
        });
        fireDragEvent(pane, "dragover", { dataTransfer: transfer, clientX: 400, clientY: 300 });
        fireDragEvent(pane, "drop", { dataTransfer: transfer, clientX: 400, clientY: 300 });

        expect(onDropFile).toHaveBeenCalledWith("pane-1", null, "C:\\p\\main.tex");
    });
});

describe("EditorPane and the editor's own drop handling", () => {
    it("claims the drop before an inner element can consume it", () => {
        // CodeMirror registers a `drop` handler on its content DOM: it
        // inserts the dragged text and stops propagation. A pane
        // listening in the bubble phase therefore never runs — which in
        // the real app pasted the dragged file's *path* into the
        // document instead of splitting the pane, and left the drop
        // hint on screen because nothing cleared it.
        const { pane, onDropFile } = renderPane();
        const inner = pane.querySelector(".editor-pane-header");
        if (!inner) throw new Error("The pane header did not render");

        inner.addEventListener("drop", (event) => {
            event.stopPropagation();
        });

        const transfer = transferFor({ kind: "file", path: "C:\\p\\main.tex" });
        fireDragEvent(pane, "dragenter", { dataTransfer: transfer });
        fireDragEvent(pane, "dragover", { dataTransfer: transfer });
        fireDragEvent(inner, "drop", { dataTransfer: transfer });

        expect(onDropFile).toHaveBeenCalledWith("pane-1", null, "C:\\p\\main.tex");
    });

    it("clears the drop hint even when an inner element consumes the drop", () => {
        const { pane } = renderPane();
        const inner = pane.querySelector(".editor-pane-header");
        if (!inner) throw new Error("The pane header did not render");

        inner.addEventListener("drop", (event) => {
            event.stopPropagation();
        });

        const transfer = transferFor({ kind: "file", path: "C:\\p\\main.tex" });
        fireDragEvent(pane, "dragenter", { dataTransfer: transfer });
        fireDragEvent(pane, "dragover", { dataTransfer: transfer });
        expect(pane.querySelector(".pane-drop-hint")).not.toBeNull();

        fireDragEvent(inner, "drop", { dataTransfer: transfer });

        expect(pane.querySelector(".pane-drop-hint")).toBeNull();
    });

    it("leaves a drag the editor should handle alone", () => {
        // Dragging a text selection within the editor is CodeMirror's
        // to handle; the pane must not preventDefault it.
        const { pane, onDropFile } = renderPane();
        const transfer = makeDataTransfer({ "text/plain": "some prose" });

        fireDragEvent(pane, "dragenter", { dataTransfer: transfer });
        fireDragEvent(pane, "dragover", { dataTransfer: transfer });
        fireDragEvent(pane, "drop", { dataTransfer: transfer });

        expect(onDropFile).not.toHaveBeenCalled();
        expect(transfer.dropEffect).toBe("none");
    });
});
