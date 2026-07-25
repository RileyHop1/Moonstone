/**
 * Project page: dockable file browser, toolbar, file management, and
 * the live-preview editor for one open file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { NameDialog } from "../../components/NameDialog";
import { useNavigation } from "../../shared/navigation";
import { useAppActions } from "../../shared/appActions";
import type { EditorActions, SnippetName } from "../../shared/appActions";
import {
    createDirectory,
    createFile,
    deleteEntry,
    listProjectFiles,
    moveEntry,
    readFile,
    renameEntry,
    saveFile,
} from "../../shared/tauri";
import type { FileNode, LoadState, ModalMode, ProjectInfo, ViewMode } from "../../shared/types";
import { useDockDrag } from "../../shared/useDockDrag";
import type { DockSide } from "../../shared/useDockDrag";
import { openSearchPanel } from "@codemirror/search";
import { TextEditor } from "../editor/TextEditor";
import {
    DEFAULT_VIEW_MODE,
    previewCompartment,
    previewExtensionForMode,
} from "../editor/TextEditor/viewMode";
import {
    DEFAULT_MODAL_MODE,
    modalCompartment,
    modalExtensionForMode,
} from "../editor/TextEditor/modalMode";
import { SNIPPETS, insertSnippetIntoView } from "../editor/TextEditor/snippets";
import { FileBrowser } from "./FileBrowser";
import type { FileOperation } from "./FileBrowser";
import { Toolbar } from "./Toolbar";
import type { StatusMessage } from "./Toolbar";
import "./ProjectPage.css";

/** Props for {@link ProjectPage}. */
export interface ProjectPageProps {
    /** The project being edited. */
    readonly project: ProjectInfo;
}

/** The file currently loaded into the editor. */
interface OpenFile {
    readonly path: string;
    readonly initialDoc: string;
}

/** A pending name-prompt dialog for a file operation. */
type FileDialogState =
    | { readonly kind: "newFile"; readonly parentDir: string }
    | { readonly kind: "newFolder"; readonly parentDir: string };

/** How long transient info status messages stay visible. */
const STATUS_CLEAR_MS = 2000;

/**
 * Picks the file to auto-open for a freshly loaded project: the
 * root-level `<name>.tex` if present, else the first root-level file.
 *
 * @param tree - The project's root directory node.
 * @param projectName - The project's name.
 * @returns The path to open, or null when the project has no files.
 */
function findMainFilePath(tree: FileNode, projectName: string): string | null {
    if (tree.kind !== "directory") return tree.path;

    const files = tree.children.filter((child) => child.kind === "file");

    const mainFile = files.find((file) => file.name === `${projectName}.tex`);
    if (mainFile) return mainFile.path;

    return files[0]?.path ?? null;
}

/**
 * Renders the project page and owns its state: the file tree, the
 * open file, dirtiness, dock side, file-management dialogs, and the
 * editor actions it registers with the global hotbar.
 *
 * @param props - The project to display.
 * @returns The project page element.
 */
export function ProjectPage({ project }: ProjectPageProps) {
    const { navigate } = useNavigation();
    const { registerEditor } = useAppActions();

    const [tree, setTree] = useState<LoadState<FileNode>>({ status: "loading" });
    const [openFile, setOpenFile] = useState<OpenFile | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [dockSide, setDockSide] = useState<DockSide>("left");
    const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
    const [dialog, setDialog] = useState<FileDialogState | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>(DEFAULT_VIEW_MODE);
    const [modalMode, setModalMode] = useState<ModalMode>(DEFAULT_MODAL_MODE);

    const viewRef = useRef<EditorView | null>(null);
    const statusTimerRef = useRef<number | null>(null);

    // Refs mirror state read inside stable callbacks so those
    // callbacks never see stale values.
    const isDirtyRef = useRef(isDirty);
    isDirtyRef.current = isDirty;
    const openFileRef = useRef<OpenFile | null>(openFile);
    openFileRef.current = openFile;

    /**
     * Shows a status message; info messages clear themselves.
     */
    const showStatus = useCallback((message: StatusMessage | null): void => {
        if (statusTimerRef.current !== null) {
            window.clearTimeout(statusTimerRef.current);
            statusTimerRef.current = null;
        }

        setStatusMessage(message);

        if (message?.kind === "info") {
            statusTimerRef.current = window.setTimeout(() => {
                setStatusMessage(null);
                statusTimerRef.current = null;
            }, STATUS_CLEAR_MS);
        }
    }, []);

    // Dispose the pending status timer on unmount.
    useEffect(() => {
        return () => {
            if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
        };
    }, []);

    const confirmDiscardChanges = useCallback((): boolean => {
        if (!isDirtyRef.current) return true;

        return window.confirm("You have unsaved changes. Discard them?");
    }, []);

    const openFileByPath = useCallback(
        async (path: string): Promise<void> => {
            if (path === openFileRef.current?.path) return;

            if (!confirmDiscardChanges()) return;

            const result = await readFile(path);

            if (!result.ok) {
                showStatus({ kind: "error", text: result.error });
                return;
            }

            showStatus(null);
            setIsDirty(false);
            setOpenFile({ path, initialDoc: result.data });
        },
        [confirmDiscardChanges, showStatus],
    );

    /** Re-fetches the project's file tree. */
    const refreshTree = useCallback(async (): Promise<LoadState<FileNode>> => {
        const result = await listProjectFiles(project.path);

        const next: LoadState<FileNode> = result.ok
            ? { status: "ready", data: result.data }
            : { status: "error", message: result.error };

        setTree(next);
        return next;
    }, [project.path]);

    // Initial tree load; auto-open the project's main file. The
    // cancelled flag guards StrictMode's double-mounted first pass.
    useEffect(() => {
        let cancelled = false;

        void (async () => {
            const result = await listProjectFiles(project.path);
            if (cancelled) return;

            if (!result.ok) {
                setTree({ status: "error", message: result.error });
                return;
            }

            setTree({ status: "ready", data: result.data });

            if (openFileRef.current === null) {
                const mainFilePath = findMainFilePath(result.data, project.name);
                if (mainFilePath) void openFileByPath(mainFilePath);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [project.path, project.name, openFileByPath]);

    const save = useCallback(async (): Promise<void> => {
        const view = viewRef.current;
        const file = openFileRef.current;
        if (!view || !file) return;

        const result = await saveFile(file.path, view.state.doc.toString());

        if (!result.ok) {
            showStatus({ kind: "error", text: `Save failed: ${result.error}` });
            return;
        }

        showStatus({ kind: "info", text: "Saved ✓" });
        setIsDirty(false);
    }, [showStatus]);

    /**
     * Repoints the open file after an entry it lives under is renamed
     * or moved, preserving any unsaved contents.
     *
     * @param from - The entry's old path.
     * @param to - The entry's new path.
     */
    const repointOpenFile = useCallback((from: string, to: string): void => {
        const openPath = openFileRef.current?.path;
        if (openPath === undefined) return;

        const newPath = renamedOpenFilePath(openPath, from, to);
        if (newPath === null) return;

        const currentDoc =
            viewRef.current?.state.doc.toString() ?? openFileRef.current?.initialDoc ?? "";
        setOpenFile({ path: newPath, initialDoc: currentDoc });
    }, []);

    /**
     * Handles a file-management request from the browser: prompts for
     * names via dialog, performs a move, or confirms and deletes.
     */
    const handleFileOperation = useCallback(
        async (operation: FileOperation): Promise<void> => {
            if (operation.kind === "newFile" || operation.kind === "newFolder") {
                setDialog(operation);
                return;
            }

            if (operation.kind === "move") {
                const result = await moveEntry(operation.sourcePath, operation.destDir);
                if (!result.ok) {
                    showStatus({ kind: "error", text: result.error });
                    return;
                }
                repointOpenFile(operation.sourcePath, result.data);
                void refreshTree();
                return;
            }

            const confirmed = window.confirm(
                `Delete ${operation.name}? It will be moved to the recycle bin.`,
            );
            if (!confirmed) return;

            const result = await deleteEntry(operation.path);

            if (!result.ok) {
                showStatus({ kind: "error", text: result.error });
                return;
            }

            // Close the editor when the open file (or an ancestor
            // directory of it) was deleted.
            const openPath = openFileRef.current?.path;
            const deletedOpenFile =
                openPath !== undefined &&
                (openPath === operation.path || openPath.startsWith(`${operation.path}\\`) ||
                    openPath.startsWith(`${operation.path}/`));
            if (deletedOpenFile) {
                setOpenFile(null);
                setIsDirty(false);
            }

            void refreshTree();
        },
        [refreshTree, showStatus, repointOpenFile],
    );

    /**
     * Renames an entry in place (from the inline tree editor).
     *
     * @param path - The entry to rename.
     * @param newName - The new bare name.
     * @returns An error message, or null on success.
     */
    const renameInline = useCallback(
        async (path: string, newName: string): Promise<string | null> => {
            const result = await renameEntry(path, newName);
            if (!result.ok) return result.error;

            repointOpenFile(path, result.data);
            void refreshTree();
            return null;
        },
        [refreshTree, repointOpenFile],
    );

    /**
     * Executes the operation behind the open name dialog.
     *
     * @param name - The validated name from the dialog.
     * @returns An inline error message, or null on success.
     */
    const handleDialogSubmit = useCallback(
        async (name: string): Promise<string | null> => {
            if (!dialog) return null;

            switch (dialog.kind) {
                case "newFile": {
                    const result = await createFile(dialog.parentDir, name);
                    if (!result.ok) return result.error;
                    break;
                }

                case "newFolder": {
                    const result = await createDirectory(dialog.parentDir, name);
                    if (!result.ok) return result.error;
                    break;
                }

                default:
                    return null;
            }

            setDialog(null);
            void refreshTree();
            return null;
        },
        [dialog, refreshTree],
    );

    const actions = useMemo<EditorActions>(
        () => ({
            save: () => {
                void save();
            },
            undo: () => {
                const view = viewRef.current;
                if (!view) return;
                undo(view);
                view.focus();
            },
            redo: () => {
                const view = viewRef.current;
                if (!view) return;
                redo(view);
                view.focus();
            },
            insertSnippet: (name: SnippetName) => {
                const view = viewRef.current;
                if (!view) return;
                insertSnippetIntoView(view, SNIPPETS[name]);
            },
            newFile: () => {
                setDialog({ kind: "newFile", parentDir: project.path });
            },
            exitProject: () => {
                if (!confirmDiscardChanges()) return;
                navigate({ kind: "browser" });
            },
            viewMode,
            setViewMode: (mode: ViewMode) => setViewMode(mode),
            findReplace: () => {
                const view = viewRef.current;
                if (!view) return;
                openSearchPanel(view);
                view.focus();
            },
            modalMode,
            setModalMode: (mode: ModalMode) => setModalMode(mode),
        }),
        [save, confirmDiscardChanges, navigate, project.path, viewMode, modalMode],
    );

    // Swap the preview configuration in place when the mode changes,
    // preserving the document and undo history (a remount would lose
    // both). No-ops when no file is open yet.
    useEffect(() => {
        viewRef.current?.dispatch({
            effects: previewCompartment.reconfigure(previewExtensionForMode(viewMode)),
        });
    }, [viewMode]);

    // Swap the modal keymap (vim/helix/none) in place, preserving
    // document and undo history.
    useEffect(() => {
        viewRef.current?.dispatch({
            effects: modalCompartment.reconfigure(modalExtensionForMode(modalMode)),
        });
    }, [modalMode]);

    // Make the hotbar's Save/Undo/Redo/Insert items work while this
    // page is open.
    useEffect(() => {
        registerEditor(actions);

        return () => registerEditor(null);
    }, [registerEditor, actions]);

    const { isDragging, hoverSide, handleProps } = useDockDrag(setDockSide);

    return (
        <div className={`project-page${dockSide === "right" ? " project-page-dock-right" : ""}`}>
            <Toolbar
                isDirty={isDirty}
                hasOpenFile={openFile !== null}
                viewMode={viewMode}
                actions={actions}
                statusMessage={statusMessage}
            />

            <div className="project-workspace">
                <FileBrowser
                    tree={tree}
                    selectedPath={openFile?.path ?? null}
                    onSelectFile={(path) => void openFileByPath(path)}
                    onFileOperation={(operation) => void handleFileOperation(operation)}
                    onRename={renameInline}
                    dragHandleProps={handleProps}
                />

                <section className="project-editor-panel">
                    {openFile ? (
                        <TextEditor
                            // Remount per file: clean editor + fresh undo history.
                            key={openFile.path}
                            initialDoc={openFile.initialDoc}
                            initialViewMode={viewMode}
                            initialModalMode={modalMode}
                            onViewReady={(view) => {
                                viewRef.current = view;
                            }}
                            onDocChanged={() => setIsDirty(true)}
                            onSaveRequested={() => void save()}
                        />
                    ) : (
                        <div className="editor-placeholder">Select a file to start editing.</div>
                    )}
                </section>
            </div>

            {dialog && (
                <NameDialog
                    title={dialogTitle(dialog)}
                    placeholder={dialog.kind === "newFolder" ? "Folder name" : "File name"}
                    submitLabel="Create"
                    onSubmit={handleDialogSubmit}
                    onCancel={() => setDialog(null)}
                />
            )}

            {isDragging && (
                <div className="dock-zones">
                    <div
                        className={`dock-zone dock-zone-left${hoverSide === "left" ? " dock-zone-active" : ""}`}
                    />
                    <div
                        className={`dock-zone dock-zone-right${hoverSide === "right" ? " dock-zone-active" : ""}`}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * Human-readable heading for a file dialog.
 *
 * @param dialog - The pending dialog state.
 * @returns The dialog title.
 */
function dialogTitle(dialog: FileDialogState): string {
    switch (dialog.kind) {
        case "newFile":
            return "New File";
        case "newFolder":
            return "New Folder";
        default:
            return "";
    }
}

/**
 * Computes the open file's new path after a rename, if affected.
 *
 * @param openPath - Path of the currently open file.
 * @param renamedFrom - Path of the entry that was renamed.
 * @param renamedTo - The entry's new path.
 * @returns The open file's updated path, or null when unaffected.
 */
function renamedOpenFilePath(
    openPath: string,
    renamedFrom: string,
    renamedTo: string,
): string | null {
    if (openPath === renamedFrom) return renamedTo;

    // The open file lives inside a renamed directory.
    for (const separator of ["\\", "/"]) {
        const prefix = `${renamedFrom}${separator}`;
        if (openPath.startsWith(prefix)) {
            return `${renamedTo}${separator}${openPath.slice(prefix.length)}`;
        }
    }

    return null;
}
