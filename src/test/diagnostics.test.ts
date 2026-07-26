/**
 * Test suite for the opt-in editor diagnostic overlay: the pure report
 * builder and the hidden-by-default visibility contract.
 */

import { describe, it, expect, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import {
    DIAGNOSTICS_VISIBLE_BY_DEFAULT,
    collectDiagnostics,
    editorDiagnostics,
    isDiagnosticsVisible,
    setDiagnosticsVisible,
} from "../views/editor/TextEditor/Diagnostics";
import type {
    DiagnosticReport,
    DiagnosticsOptions,
} from "../views/editor/TextEditor/Diagnostics";
import { previewExtensionForMode } from "../views/editor/TextEditor/viewMode";
import { modalExtensionForMode } from "../views/editor/TextEditor/modalMode";

/**
 * Looks up one field's value in a report.
 *
 * @param report - The report to search.
 * @param section - The section title.
 * @param label - The field label.
 * @returns The field's value, or undefined when absent.
 */
function fieldValue(
    report: DiagnosticReport,
    section: string,
    label: string,
): string | undefined {
    return report
        .find((candidate) => candidate.title === section)
        ?.fields.find((field) => field.label === label)?.value;
}

describe("collectDiagnostics", () => {
    it("reports document size", () => {
        const state = EditorState.create({ doc: "one\ntwo\nthree" });

        const report = collectDiagnostics(state, null);

        expect(fieldValue(report, "Document", "Lines")).toBe("3");
        expect(fieldValue(report, "Document", "Characters")).toBe("13");
    });

    it("reports the cursor as a 1-based line and column", () => {
        const state = EditorState.create({ doc: "alpha\nbeta", selection: { anchor: 8 } });

        const report = collectDiagnostics(state, null);

        expect(fieldValue(report, "Selection", "Cursor")).toBe("line 2, col 3");
        expect(fieldValue(report, "Selection", "Offset")).toBe("8");
    });

    it("totals the selected characters across ranges", () => {
        const state = EditorState.create({
            doc: "alpha beta gamma",
            selection: { anchor: 0, head: 5 },
        });

        const report = collectDiagnostics(state, null);

        expect(fieldValue(report, "Selection", "Ranges")).toBe("1");
        expect(fieldValue(report, "Selection", "Selected")).toBe("5 chars");
    });

    it("reports the active view and modal modes", () => {
        const state = EditorState.create({
            extensions: [previewExtensionForMode("readonly"), modalExtensionForMode("helix")],
        });

        const report = collectDiagnostics(state, null);

        expect(fieldValue(report, "Modes", "View")).toBe("readonly");
        expect(fieldValue(report, "Modes", "Modal")).toBe("helix");
        expect(fieldValue(report, "Modes", "Editable")).toBe("no");
    });

    it("reports the rendered share of the document", () => {
        const state = EditorState.create({ doc: "a\nb\nc\nd" });

        // Lines 1-2 of 4 rendered.
        const report = collectDiagnostics(state, { from: 0, to: 3 });

        expect(fieldValue(report, "Viewport", "Lines")).toBe("1–2");
        expect(fieldValue(report, "Viewport", "Rendered")).toBe("2 of 4 (50%)");
    });

    it("degrades gracefully with no view attached", () => {
        const state = EditorState.create({ doc: "a" });

        const report = collectDiagnostics(state, null);

        expect(fieldValue(report, "Viewport", "Rendered")).toBe("no view attached");
    });
});

describe("editorDiagnostics", () => {
    let view: EditorView | null = null;

    afterEach(() => {
        view?.destroy();
        view = null;
    });

    /**
     * Mounts an editor carrying the diagnostic extension.
     *
     * @returns The mounted view.
     */
    function mountEditor(options: DiagnosticsOptions = {}): EditorView {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        view = new EditorView({
            doc: "hello",
            extensions: [editorDiagnostics(options)],
            parent,
        });
        return view;
    }

    it("is hidden by default", () => {
        expect(DIAGNOSTICS_VISIBLE_BY_DEFAULT).toBe(false);

        const editor = mountEditor();

        expect(isDiagnosticsVisible(editor)).toBe(false);
        expect(editor.dom.querySelector(".cm-diagnostic-panel")?.hasAttribute("hidden")).toBe(
            true,
        );
    });

    it("renders no content while hidden", () => {
        const editor = mountEditor();

        const panel = editor.dom.querySelector(".cm-diagnostic-panel");

        expect(panel?.childElementCount).toBe(0);
    });

    it("shows the report once enabled", () => {
        const editor = mountEditor();

        setDiagnosticsVisible(editor, true);

        const panel = editor.dom.querySelector(".cm-diagnostic-panel");
        expect(isDiagnosticsVisible(editor)).toBe(true);
        expect(panel?.hasAttribute("hidden")).toBe(false);
        expect(panel?.textContent).toContain("Document");
    });

    it("hides again when disabled", () => {
        const editor = mountEditor();

        setDiagnosticsVisible(editor, true);
        setDiagnosticsVisible(editor, false);

        const panel = editor.dom.querySelector(".cm-diagnostic-panel");
        expect(isDiagnosticsVisible(editor)).toBe(false);
        expect(panel?.childElementCount).toBe(0);
    });

    it("removes the panel when the editor is destroyed", () => {
        const editor = mountEditor();
        const { dom } = editor;

        editor.destroy();
        view = null;

        expect(dom.querySelector(".cm-diagnostic-panel")).toBeNull();
    });
});

/**
 * Fires the diagnostics shortcut at an editor.
 *
 * @param view - The editor to send the key to.
 */
function pressToggleShortcut(view: EditorView): void {
    // Dispatching a KeyboardEvent does not reach CodeMirror's keymap
    // under jsdom, so the binding is run the way CodeMirror runs it.
    const event = new KeyboardEvent("keydown", {
        key: "D",
        code: "KeyD",
        keyCode: 68,
        ctrlKey: true,
        shiftKey: true,
    } as KeyboardEventInit);

    runScopeHandlers(view, event, "editor");
}

describe("driving diagnostics from the settings preference", () => {
    let view: EditorView | null = null;

    afterEach(() => {
        view?.destroy();
        view = null;
    });

    /**
     * Mounts an editor carrying the diagnostic extension.
     *
     * @param options - Initial visibility and change callback.
     * @returns The mounted view.
     */
    function mount(options: DiagnosticsOptions): EditorView {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        view = new EditorView({
            doc: "hello",
            extensions: [editorDiagnostics(options)],
            parent,
        });
        return view;
    }

    it("mounts visible when the preference says so", () => {
        // Otherwise the panel would flash off before a dispatch turned
        // it on, every time a file opens.
        expect(isDiagnosticsVisible(mount({ initialVisible: true }))).toBe(true);
    });

    it("reports shortcut toggles so the preference can follow", () => {
        const changes: boolean[] = [];
        const editor = mount({ initialVisible: false, onVisibilityChange: (v) => changes.push(v) });

        pressToggleShortcut(editor);

        expect(isDiagnosticsVisible(editor)).toBe(true);
        expect(changes).toEqual([true]);
    });

    it("still toggles without a callback", () => {
        const editor = mount({ initialVisible: false });

        pressToggleShortcut(editor);

        expect(isDiagnosticsVisible(editor)).toBe(true);
    });
});
