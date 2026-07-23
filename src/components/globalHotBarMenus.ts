/**
 * Menu definitions for the GlobalHotBar.
 *
 * Pure builders: given the wiring context (registered actions,
 * navigation, settings), they return menu data — no JSX, no hooks —
 * so the hot bar's contents are unit-testable without rendering.
 */

import type { AppActions, EditorActions } from "../shared/appActions";
import type { NavigationValue } from "../shared/navigation";
import type { SettingsValue } from "../shared/settings";

/** One hot bar menu item: its label and its action (null = disabled). */
export interface MenuItem {
    readonly label: string;
    readonly action: (() => void) | null;
    /** True renders a checkmark (e.g. the active view mode). */
    readonly checked?: boolean;
}

/** One hot bar menu: its button label and its items. */
export interface Menu {
    readonly name: string;
    readonly items: readonly MenuItem[];
}

/** Everything the menu builders need to wire their actions. */
export interface MenuContext {
    readonly actions: AppActions;
    readonly editor: EditorActions | null;
    readonly navigate: NavigationValue["navigate"];
    readonly settings: SettingsValue["settings"];
    readonly updateSettings: SettingsValue["updateSettings"];
}

/**
 * Builds the File menu.
 *
 * @param context - The wiring context.
 * @returns The menu definition.
 */
function buildFileMenu({ actions, editor, navigate }: MenuContext): Menu {
    return {
        name: "File",
        items: [
            { label: "New Project", action: actions.newProject },
            { label: "Open Project", action: () => navigate({ kind: "browser" }) },
            { label: "New File", action: editor ? editor.newFile : null },
            { label: "Save", action: editor ? editor.save : null },
            { label: "Recent Projects", action: null },
        ],
    };
}

/**
 * Builds the Edit menu.
 *
 * @param context - The wiring context.
 * @returns The menu definition.
 */
function buildEditMenu({ editor }: MenuContext): Menu {
    return {
        name: "Edit",
        items: [
            { label: "Undo", action: editor ? editor.undo : null },
            { label: "Redo", action: editor ? editor.redo : null },
            { label: "Find & Replace", action: editor ? editor.findReplace : null },
        ],
    };
}

/**
 * Builds the Insert menu.
 *
 * @param context - The wiring context.
 * @returns The menu definition.
 */
function buildInsertMenu({ editor }: MenuContext): Menu {
    return {
        name: "Insert",
        items: [
            { label: "Math", action: editor ? () => editor.insertSnippet("inlineMath") : null },
            { label: "Tables", action: editor ? () => editor.insertSnippet("table") : null },
            { label: "Template", action: editor ? () => editor.insertSnippet("template") : null },
        ],
    };
}

/**
 * Builds the View menu: the three view modes, with a checkmark on the
 * active one.
 *
 * @param context - The wiring context.
 * @returns The menu definition.
 */
function buildViewMenu({ editor }: MenuContext): Menu {
    return {
        name: "View",
        items: [
            {
                label: "Source",
                action: editor ? () => editor.setViewMode("source") : null,
                checked: editor?.viewMode === "source",
            },
            {
                label: "Live Preview",
                action: editor ? () => editor.setViewMode("live") : null,
                checked: editor?.viewMode === "live",
            },
            {
                label: "Read Only",
                action: editor ? () => editor.setViewMode("readonly") : null,
                checked: editor?.viewMode === "readonly",
            },
        ],
    };
}

/**
 * Builds the Settings menu.
 *
 * @param context - The wiring context.
 * @returns The menu definition.
 */
function buildSettingsMenu({ navigate, settings, updateSettings }: MenuContext): Menu {
    return {
        name: "Settings",
        items: [
            {
                label: "Light/Dark",
                action: () =>
                    updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" }),
            },
            { label: "Settings Menu", action: () => navigate({ kind: "settings" }) },
        ],
    };
}

/**
 * Builds the Help menu.
 *
 * @returns The menu definition.
 */
function buildHelpMenu(): Menu {
    return {
        name: "Help",
        items: [{ label: "Documentation", action: null }],
    };
}

/**
 * Assembles every hot bar menu in display order.
 *
 * @param context - The wiring context.
 * @returns The menu definitions.
 */
export function buildMenus(context: MenuContext): readonly Menu[] {
    return [
        buildFileMenu(context),
        buildEditMenu(context),
        buildInsertMenu(context),
        buildViewMenu(context),
        buildSettingsMenu(context),
        buildHelpMenu(),
    ];
}
