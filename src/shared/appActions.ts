/**
 * App-wide action registry.
 *
 * The GlobalHotBar lives above the page switch, so pages register the
 * actions they can handle (e.g. Save while a project is open) into
 * this context. Unregistered actions render as disabled menu items.
 */

import { createContext, useContext } from "react";
import type { ViewMode } from "./types";

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

/**
 * Things that act on the open document.
 *
 * Split from the project-level and view-mode actions so a consumer can
 * ask for what it needs. The toolbar renders an undo button; it should
 * not have to depend on `exitProject` to do so.
 */
export interface EditorCommands {
    /** Persists the open file to disk. */
    readonly save: () => void;
    /** Undoes the last editor change. */
    readonly undo: () => void;
    /** Redoes the last undone editor change. */
    readonly redo: () => void;
    /** Inserts a named LaTeX snippet at the cursor. */
    readonly insertSnippet: (name: SnippetName) => void;
    /** Opens the find-and-replace search panel. */
    readonly findReplace: () => void;
}

/**
 * How the document is displayed.
 *
 * Its own interface because view mode is the one piece of *state* among
 * the actions, and the toolbar renders a control bound to it.
 */
export interface ViewModeControl {
    /** The editor's current view mode (source/live/read-only). */
    readonly viewMode: ViewMode;
    /** Switches the editor's view mode. */
    readonly setViewMode: (mode: ViewMode) => void;
}

/**
 * Things that act on the project rather than the document.
 *
 * Creating a file and leaving the project are file management and
 * navigation; they were only ever in `EditorActions` because that is
 * where the hot bar happened to look for them.
 */
export interface ProjectActions {
    /** Opens the new-file dialog for the project root. */
    readonly newFile: () => void;
    /** Compiles the project to PDF. */
    readonly compile: () => void;
    /** Copies the active document's PDF to a location the user picks. */
    readonly exportPdf: () => void;
    /** Leaves the project and returns to the browser. */
    readonly exitProject: () => void;
}

/**
 * Everything the project page registers.
 *
 * Composed from the three above rather than declared flat, so a
 * consumer can take `EditorCommands` alone and the type system will
 * hold it to that.
 */
export interface EditorActions extends EditorCommands, ViewModeControl, ProjectActions {}

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
