/**
 * Test suite for the hot bar's pure menu builders.
 */

import { describe, it, expect, vi } from "vitest";
import { buildMenus } from "../components/globalHotBarMenus";
import type { MenuContext } from "../components/globalHotBarMenus";
import type { EditorActions } from "../shared/appActions";

/** A fully wired editor-actions stub. */
function makeEditorActions(): EditorActions {
    return {
        save: vi.fn(),
        undo: vi.fn(),
        redo: vi.fn(),
        insertSnippet: vi.fn(),
        newFile: vi.fn(),
        exitProject: vi.fn(),
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
