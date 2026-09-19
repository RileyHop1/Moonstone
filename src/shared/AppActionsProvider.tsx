/**
 * Hosts the app-wide action registry and provides it to descendants.
 *
 * Kept apart from `appActions.ts` so that module — the types, context
 * and hook every page imports — exports no components and Fast Refresh
 * stays reliable.
 */

import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AppActionsContext } from "./appActions";
import type { AppActionsValue, EditorActions } from "./appActions";

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
