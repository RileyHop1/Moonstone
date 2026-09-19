/**
 * The editor area's state: which panes exist, what each has open, which
 * ones have unsaved changes, and which one the toolbar is acting on.
 *
 * Split out of `ProjectPage` because the page was already long and
 * every one of these became a collection when panes arrived. Keeping it
 * here also means the whole thing can be tested by calling functions,
 * without rendering an editor.
 *
 * The layout tree (`paneLayout.ts`) says where panes sit; this owns
 * everything hanging off them. Documents are keyed by pane rather than
 * by path on purpose: two panes may show the same file, and each needs
 * its own editor state and undo history.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { isAtOrInside, reparent } from "../../shared/paths";
import type { LoadedFile, PaneDocument } from "./EditorPane";
import {
    closePane,
    createLayout,
    createPaneIdFactory,
    focusAfterClose,
    listPanes,
    resizeSplit,
    setPaneFile,
    splitPane,
} from "./paneLayout";
import type { DropSide, PaneId, PaneNode, PaneSplit } from "./paneLayout";

/** What the editor area currently looks like, and how to change it. */
export interface PaneWorkspace {
    readonly layout: PaneNode;
    readonly documents: ReadonlyMap<PaneId, PaneDocument>;
    readonly dirtyPanes: ReadonlySet<PaneId>;
    readonly activePaneId: PaneId;
    /** The pane the toolbar acts on, or null when it has nothing open. */
    readonly activeDocument: PaneDocument | null;
    /** True when the active pane has unsaved changes. */
    readonly isActiveDirty: boolean;
    /** True when any pane has unsaved changes. */
    readonly hasUnsavedChanges: boolean;
    /** True once more than one pane is open. */
    readonly hasSeveralPanes: boolean;

    /** The live editor for a pane, if it has one. */
    readonly viewFor: (paneId: PaneId) => EditorView | null;
    /** The live editor of the pane the toolbar acts on. */
    readonly activeView: () => EditorView | null;

    readonly activate: (paneId: PaneId) => void;
    /** Loads a file into a pane, replacing whatever it showed. */
    readonly showDocument: (paneId: PaneId, loaded: LoadedFile) => void;
    /** Opens a file in a new pane beside an existing one; returns the
     * new pane. */
    readonly splitWith: (paneId: PaneId, side: DropSide, loaded: LoadedFile) => PaneId;
    readonly close: (paneId: PaneId) => void;
    readonly markDirty: (paneId: PaneId) => void;
    readonly markClean: (paneId: PaneId) => void;
    readonly resize: (
        splitId: PaneId,
        index: number,
        beforeSize: number,
        afterSize: number,
    ) => void;

    readonly registerView: (paneId: PaneId, view: EditorView) => void;
    readonly unregisterView: (paneId: PaneId) => void;

    /** Rewrites every pane's path after an entry moved or was renamed. */
    readonly repointPaths: (from: string, to: string) => void;
    /** Empties every pane showing a deleted entry. */
    readonly forgetDeleted: (deletedPath: string) => void;
    /** Whether any pane currently shows this file. */
    readonly isShowing: (path: string) => boolean;
}

/**
 * Hosts the editor area's panes.
 *
 * @returns The current workspace and the operations on it.
 */
export function usePaneWorkspace(): PaneWorkspace {
    // One factory per workspace, so ids are unique here without any
    // module-level state — and so a restored layout could seed it.
    const nextPaneIdRef = useRef(createPaneIdFactory());
    const nextPaneId = nextPaneIdRef.current;

    const [initialPaneId] = useState(() => nextPaneId());
    const [layout, setLayout] = useState<PaneNode>(() => createLayout(null, initialPaneId));
    const [documents, setDocuments] = useState<ReadonlyMap<PaneId, PaneDocument>>(new Map());
    const [dirtyPanes, setDirtyPanes] = useState<ReadonlySet<PaneId>>(new Set());
    const [activePaneId, setActivePaneId] = useState<PaneId>(initialPaneId);

    // Live editors, by pane. A ref rather than state: nothing renders
    // differently because a view exists, and putting CodeMirror
    // instances in state would re-render the tree on every mount.
    const viewsRef = useRef(new Map<PaneId, EditorView>());

    // Mirrors the layout so operations that need to read it *and* write
    // several pieces of state can compute outside an updater.
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

    // Counts loads across the whole workspace, so every remount key is
    // distinct even when the same file is opened into two panes.
    const loadCounterRef = useRef(0);

    const viewFor = useCallback((paneId: PaneId): EditorView | null => {
        return viewsRef.current.get(paneId) ?? null;
    }, []);

    const registerView = useCallback((paneId: PaneId, view: EditorView): void => {
        viewsRef.current.set(paneId, view);
    }, []);

    const unregisterView = useCallback((paneId: PaneId): void => {
        // Without this the map keeps entries for editors that no longer
        // exist. CodeMirror ignores a dispatch to a destroyed view, so a
        // stale entry fails silently rather than loudly.
        viewsRef.current.delete(paneId);
    }, []);

    const activate = useCallback((paneId: PaneId): void => {
        setActivePaneId(paneId);
    }, []);

    const markDirty = useCallback((paneId: PaneId): void => {
        setDirtyPanes((previous) => {
            if (previous.has(paneId)) return previous;

            return new Set(previous).add(paneId);
        });
    }, []);

    const markClean = useCallback((paneId: PaneId): void => {
        setDirtyPanes((previous) => {
            if (!previous.has(paneId)) return previous;

            const next = new Set(previous);
            next.delete(paneId);
            return next;
        });
    }, []);

    const showDocument = useCallback((paneId: PaneId, loaded: LoadedFile): void => {
        const version = (loadCounterRef.current += 1);

        setLayout((previous) => setPaneFile(previous, paneId, loaded.path));
        setDocuments((previous) => new Map(previous).set(paneId, { ...loaded, version }));
        setDirtyPanes((previous) => {
            if (!previous.has(paneId)) return previous;

            const next = new Set(previous);
            next.delete(paneId);
            return next;
        });
    }, []);

    const splitWith = useCallback(
        (paneId: PaneId, side: DropSide, loaded: LoadedFile): PaneId => {
            const newPaneId = nextPaneId();
            const version = (loadCounterRef.current += 1);

            setLayout((previous) =>
                splitPane(previous, paneId, side, loaded.path, {
                    paneId: newPaneId,
                    splitId: nextPaneId(),
                }),
            );
            setDocuments((previous) =>
                new Map(previous).set(newPaneId, { ...loaded, version }),
            );
            setActivePaneId(newPaneId);
            return newPaneId;
        },
        [nextPaneId],
    );

    const close = useCallback((paneId: PaneId): void => {
        // Computed outside every updater. React may invoke an updater
        // more than once — it does, under StrictMode — so one that
        // closes over other setters would run them twice.
        const { layout: next, closed } = closePane(layoutRef.current, paneId);

        // `closed` is why this is not just "did the tree change":
        // closing the last pane is refused, and moving focus off a pane
        // that is still on screen would be worse than nothing.
        if (!closed) return;

        viewsRef.current.delete(paneId);

        setLayout(next);
        setDocuments((current) => {
            const remaining = new Map(current);
            remaining.delete(paneId);
            return remaining;
        });
        setDirtyPanes((current) => {
            if (!current.has(paneId)) return current;

            const remaining = new Set(current);
            remaining.delete(paneId);
            return remaining;
        });
        setActivePaneId((current) =>
            focusAfterClose(next, current === paneId ? null : current),
        );
    }, []);

    const resize = useCallback(
        (splitId: PaneId, index: number, beforeSize: number, afterSize: number): void => {
            const split = findSplit(layoutRef.current, splitId);
            if (!split) return;

            const sizes = [...split.sizes];
            sizes[index] = beforeSize;
            sizes[index + 1] = afterSize;

            setLayout(resizeSplit(layoutRef.current, splitId, sizes));
        },
        [],
    );

    const repointPaths = useCallback((from: string, to: string): void => {
        // The live document is read out of each editor, so a rename
        // mid-edit does not cost the author their unsaved work.
        setDocuments((previous) => {
            const next = new Map(previous);
            let changed = false;

            for (const [paneId, document] of previous) {
                const newPath = reparent(document.path, from, to);
                if (newPath === null) continue;

                // Version deliberately unchanged: the editor must not
                // remount, or the rename costs the undo history.
                next.set(
                    paneId,
                    document.kind === "text"
                        ? {
                              ...document,
                              path: newPath,
                              initialDoc:
                                  viewsRef.current.get(paneId)?.state.doc.toString() ??
                                  document.initialDoc,
                          }
                        : { ...document, path: newPath },
                );
                changed = true;
            }

            return changed ? next : previous;
        });

        setLayout((previous) => {
            let next = previous;

            for (const pane of listPanes(previous)) {
                if (pane.path === null) continue;

                const newPath = reparent(pane.path, from, to);
                if (newPath !== null) next = setPaneFile(next, pane.id, newPath);
            }

            return next;
        });
    }, []);

    const forgetDeleted = useCallback((deletedPath: string): void => {
        setDocuments((previous) => {
            const next = new Map(previous);
            let changed = false;

            for (const [paneId, document] of previous) {
                if (!isAtOrInside(deletedPath, document.path)) continue;

                next.delete(paneId);
                changed = true;
            }

            return changed ? next : previous;
        });

        setLayout((previous) => {
            let next = previous;

            for (const pane of listPanes(previous)) {
                if (pane.path !== null && isAtOrInside(deletedPath, pane.path)) {
                    next = setPaneFile(next, pane.id, null);
                }
            }

            return next;
        });
    }, []);

    const activeDocument = documents.get(activePaneId) ?? null;

    const isShowing = useCallback(
        (path: string): boolean => {
            for (const document of documents.values()) {
                if (document.path === path) return true;
            }

            return false;
        },
        [documents],
    );

    const activeView = useCallback(
        (): EditorView | null => viewsRef.current.get(activePaneId) ?? null,
        [activePaneId],
    );

    return useMemo<PaneWorkspace>(
        () => ({
            layout,
            documents,
            dirtyPanes,
            activePaneId,
            activeDocument,
            isActiveDirty: dirtyPanes.has(activePaneId),
            hasUnsavedChanges: dirtyPanes.size > 0,
            hasSeveralPanes: listPanes(layout).length > 1,
            viewFor,
            activeView,
            activate,
            showDocument,
            splitWith,
            close,
            markDirty,
            markClean,
            resize,
            registerView,
            unregisterView,
            repointPaths,
            forgetDeleted,
            isShowing,
        }),
        [
            layout,
            documents,
            dirtyPanes,
            activePaneId,
            activeDocument,
            viewFor,
            activeView,
            activate,
            showDocument,
            splitWith,
            close,
            markDirty,
            markClean,
            resize,
            registerView,
            unregisterView,
            repointPaths,
            forgetDeleted,
            isShowing,
        ],
    );
}

/**
 * Finds a split by id.
 *
 * @param node - The layout root.
 * @param splitId - The split to find.
 * @returns The split, or null when the id names a leaf or nothing.
 */
function findSplit(node: PaneNode, splitId: PaneId): PaneSplit | null {
    if (node.kind === "leaf") return null;
    if (node.id === splitId) return node;

    for (const child of node.children) {
        const found = findSplit(child, splitId);
        if (found) return found;
    }

    return null;
}
