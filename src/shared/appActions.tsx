/**
 * App-wide action registry.
 *
 * The GlobalHotBar lives above the page switch, so pages register the
 * actions they can handle (e.g. Save while a project is open) into
 * this context. Unregistered actions render as disabled menu items.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ModalMode, ViewMode } from "./types";

/** Names of the LaTeX snippets the editor can insert at the cursor. */
export type SnippetName =
    | "inlineMath"
    | "blockMath"
    | "table"
    | "template"
    | "alpha"
    | "beta"
    | "sum"
    | "integral"
    | "fraction"
    | "squareRoot";

/** Actions available while a project (and its editor) is open. */
export interface EditorActions {
    /** Persists the open file to disk. */
    readonly save: () => void;
    /** Undoes the last editor change. */
    readonly undo: () => void;
    /** Redoes the last undone editor change. */
    readonly redo: () => void;
    /** Inserts a named LaTeX snippet at the cursor. */
    readonly insertSnippet: (name: SnippetName) => void;
    /** Opens the new-file dialog for the project root. */
    readonly newFile: () => void;
    /** Leaves the project and returns to the browser. */
    readonly exitProject: () => void;
    /** The editor's current view mode (source/live/read-only). */
    readonly viewMode: ViewMode;
    /** Switches the editor's view mode. */
    readonly setViewMode: (mode: ViewMode) => void;
    /** Opens the find-and-replace search panel. */
    readonly findReplace: () => void;
    /** The active modal editing mode (none/vim/helix). */
    readonly modalMode: ModalMode;
    /** Switches the modal editing mode. */
    readonly setModalMode: (mode: ModalMode) => void;
    /** Whether prose spell checking is on. */
    readonly spellCheckEnabled: boolean;
    /** Turns prose spell checking on or off. */
    readonly setSpellCheckEnabled: (enabled: boolean) => void;
}

/** Everything pages can currently handle; null means unavailable. */
export interface AppActions {
    /** Opens the new-project dialog (registered by the browser page). */
    readonly newProject: (() => void) | null;
    /** Editor actions (registered by the project page). */
    readonly editor: EditorActions | null;
}

/** Value provided by the app-actions context. */
export interface AppActionsValue {
    /** The currently registered actions. */
    readonly actions: AppActions;
    /** Registers (or clears, with null) the new-project handler. */
    readonly registerNewProject: (handler: (() => void) | null) => void;
    /** Registers (or clears, with null) the editor actions. */
    readonly registerEditor: (actions: EditorActions | null) => void;
}

/** Context carrying registered actions and their registrars. */
export const AppActionsContext = createContext<AppActionsValue | null>(null);

/**
 * Accesses the app-actions context.
 *
 * @returns The registered actions and registration functions.
 * @throws If called outside of an AppActionsProvider.
 */
export function useAppActions(): AppActionsValue {
    const value = useContext(AppActionsContext);

    if (!value) {
        throw new Error("useAppActions must be used inside an AppActionsProvider");
    }

    return value;
}

/**
 * Hosts the mutable action registry and provides it to descendants.
 *
 * @param props - The provider's children.
 * @returns The context provider element.
 */
export function AppActionsProvider({ children }: { readonly children: ReactNode }) {
    const [newProject, setNewProject] = useState<(() => void) | null>(null);
    const [editor, setEditor] = useState<EditorActions | null>(null);

    // Wrap in useCallback so registering pages can safely list these
    // in useEffect dependency arrays without re-running every render.
    const registerNewProject = useCallback((handler: (() => void) | null) => {
        // Functional update: storing a function directly would invoke
        // it as an updater.
        setNewProject(() => handler);
    }, []);

    const registerEditor = useCallback((actions: EditorActions | null) => {
        setEditor(actions);
    }, []);

    const value = useMemo<AppActionsValue>(
        () => ({
            actions: { newProject, editor },
            registerNewProject,
            registerEditor,
        }),
        [newProject, editor, registerNewProject, registerEditor],
    );

    return <AppActionsContext.Provider value={value}>{children}</AppActionsContext.Provider>;
}
