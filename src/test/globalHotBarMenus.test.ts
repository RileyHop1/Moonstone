/**
 * Test suite for the hot bar's pure menu builders.
 */

import { describe, it, expect, vi } from "vitest";
import { buildMenus } from "../components/globalHotBarMenus";
import type { MenuContext } from "../components/globalHotBarMenus";
import type { EditorActions } from "../shared/appActions";

/** A fully wired editor-actions stub. */
function makeEditorActions(overrides?: Partial<EditorActions>): EditorActions {
    return {
        save: vi.fn(),
        undo: vi.fn(),
        redo: vi.fn(),
        insertSnippet: vi.fn(),
        newFile: vi.fn(),
        exitProject: vi.fn(),
        viewMode: "live",
        setViewMode: vi.fn(),
        findReplace: vi.fn(),
        modalMode: "none",
        setModalMode: vi.fn(),
        ...overrides,
    };
}

/**
 * Builds a menu context with optional editor actions registered.
 *
 * @param editor - Editor actions, or null for non-project pages.
 * @returns The context for buildMenus.
 */
function makeContext(editor: EditorActions | null): MenuContext {
    return {
        actions: { newProject: vi.fn(), editor },
        editor,
        navigate: vi.fn(),
        settings: { theme: "dark", editorFontSize: 14 },
        updateSettings: vi.fn(),
    };
}

/** Finds a menu item by menu name and label, asserting it exists. */
function findItem(context: MenuContext, menuName: string, label: string) {
    const menu = buildMenus(context).find((candidate) => candidate.name === menuName);
    const item = menu?.items.find((candidate) => candidate.label === label);

    expect(item).toBeDefined();
    return item!;
}

describe("buildMenus", () => {
    it("builds all six menus in display order", () => {
        const names = buildMenus(makeContext(null)).map((menu) => menu.name);

        expect(names).toEqual(["File", "Edit", "Insert", "View", "Settings", "Help"]);
    });

    it("disables editor items when no editor is registered", () => {
        const context = makeContext(null);

        expect(findItem(context, "File", "Save").action).toBeNull();
        expect(findItem(context, "Edit", "Undo").action).toBeNull();
        expect(findItem(context, "Insert", "Math").action).toBeNull();
    });

    it("wires editor items when an editor is registered", () => {
        const editor = makeEditorActions();
        const context = makeContext(editor);

        findItem(context, "File", "Save").action?.();
        expect(editor.save).toHaveBeenCalled();

        findItem(context, "Insert", "Math").action?.();
        expect(editor.insertSnippet).toHaveBeenCalledWith("inlineMath");
    });

    it("disables View and Find & Replace without an editor", () => {
        const context = makeContext(null);

        expect(findItem(context, "Edit", "Find & Replace").action).toBeNull();
        expect(findItem(context, "View", "Source").action).toBeNull();
        expect(findItem(context, "View", "Live Preview").action).toBeNull();
        expect(findItem(context, "View", "Read Only").action).toBeNull();
    });

    it("wires Find & Replace to the editor", () => {
        const editor = makeEditorActions();
        const context = makeContext(editor);

        findItem(context, "Edit", "Find & Replace").action?.();

        expect(editor.findReplace).toHaveBeenCalled();
    });

    it("dispatches each view mode from the View menu", () => {
        const editor = makeEditorActions();
        const context = makeContext(editor);

        findItem(context, "View", "Source").action?.();
        findItem(context, "View", "Live Preview").action?.();
        findItem(context, "View", "Read Only").action?.();

        expect(editor.setViewMode).toHaveBeenNthCalledWith(1, "source");
        expect(editor.setViewMode).toHaveBeenNthCalledWith(2, "live");
        expect(editor.setViewMode).toHaveBeenNthCalledWith(3, "readonly");
    });

    it("checks the active view mode", () => {
        const context = makeContext(makeEditorActions({ viewMode: "readonly" }));

        expect(findItem(context, "View", "Source").checked).toBe(false);
        expect(findItem(context, "View", "Live Preview").checked).toBe(false);
        expect(findItem(context, "View", "Read Only").checked).toBe(true);
    });

    it("disables the modal-mode items without an editor", () => {
        expect(findItem(makeContext(null), "View", "Vim Mode").action).toBeNull();
        expect(findItem(makeContext(null), "View", "Helix Mode").action).toBeNull();
    });

    it("selects a modal mode from off", () => {
        const editor = makeEditorActions({ modalMode: "none" });
        const context = makeContext(editor);

        findItem(context, "View", "Vim Mode").action?.();
        expect(editor.setModalMode).toHaveBeenCalledWith("vim");

        findItem(context, "View", "Helix Mode").action?.();
        expect(editor.setModalMode).toHaveBeenCalledWith("helix");
    });

    it("turns the active modal mode back off", () => {
        const editor = makeEditorActions({ modalMode: "vim" });

        findItem(makeContext(editor), "View", "Vim Mode").action?.();
        expect(editor.setModalMode).toHaveBeenCalledWith("none");
    });

    it("checks only the active modal mode (mutually exclusive)", () => {
        const context = makeContext(makeEditorActions({ modalMode: "helix" }));

        expect(findItem(context, "View", "Vim Mode").checked).toBe(false);
        expect(findItem(context, "View", "Helix Mode").checked).toBe(true);
    });

    it("toggles the theme from the Settings menu", () => {
        const context = makeContext(null);

        findItem(context, "Settings", "Light/Dark").action?.();

        expect(context.updateSettings).toHaveBeenCalledWith({ theme: "light" });
    });

    it("navigates to the settings page", () => {
        const context = makeContext(null);

        findItem(context, "Settings", "Settings Menu").action?.();

        expect(context.navigate).toHaveBeenCalledWith({ kind: "settings" });
    });
});
