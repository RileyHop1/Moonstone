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
        settings: {
            theme: "dark",
            editorFontSize: 14,
            modalMode: "none",
            spellCheckEnabled: true,
            lineNumberMode: "absolute",
        },
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

    it("keeps preferences off the menus", () => {
        // Edit modes, spell check and the theme toggle moved to the
        // settings page; leaving duplicates here would be two places to
        // change one preference.
        const context = makeContext(makeEditorActions());
        const labels = buildMenus(context).flatMap((menu) =>
            menu.items.map((item) => item.label),
        );

        for (const label of ["Vim Mode", "Helix Mode", "Spell Check", "Light/Dark"]) {
            expect(labels, label).not.toContain(label);
        }
    });

    it("navigates to the settings page", () => {
        const context = makeContext(null);

        findItem(context, "Settings", "Open Settings").action?.();

        expect(context.navigate).toHaveBeenCalledWith({ kind: "settings" });
    });
});
