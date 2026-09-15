/**
 * Project page: dockable file browser, toolbar, file management, and a
 * split editor area showing one or more files.
 *
 * The page orchestrates; it owns very little itself. Pane state lives in
 * `usePaneWorkspace`, editor settings in `EditorConfiguration`, and the
 * layout arithmetic in `paneLayout.ts`. What is left here is the
 * project's own concerns: the file tree, the bibliography, file
 * management dialogs, and the actions the toolbar registers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { redo, undo } from "@codemirror/commands";
import { NameDialog } from "../../components/NameDialog";
import { useConfirm } from "../../components/useConfirm";
import type { NameDialogResult } from "../../components/NameDialog";
import { ResizablePanel } from "../../components/ResizablePanel";
import { DEFAULT_FILE_EXTENSION } from "../../shared/fileTypes";
import { relativeTo } from "../../shared/paths";
import { useNavigation } from "../../shared/navigation";
import { useAppActions } from "../../shared/appActions";
import { useSettings } from "../../shared/settings";
import type { EditorActions, SnippetName } from "../../shared/appActions";
import {
    createDirectory,
    createFile,
    deleteEntry,
    listProjectFiles,
    listReferences,
    moveEntry,
    compileProject,
    readFile,
    openExternalLink,
    renameEntry,
    saveFile,
} from "../../shared/tauri";
import type { FileNode, LoadState, ProjectInfo, Reference, ViewMode } from "../../shared/types";
import { useDockDrag } from "../../shared/useDockDrag";
import type { DockSide } from "../../shared/useDockDrag";
import { openSearchPanel } from "@codemirror/search";
import { DEFAULT_VIEW_MODE } from "../editor/TextEditor/viewMode";
import { SNIPPETS, insertSnippetIntoView } from "../editor/TextEditor/snippets";
import { FileBrowser } from "./FileBrowser";
import type { FileOperation } from "./FileBrowser";
import { PaneTree } from "./PaneTree";
import { usePaneConfigurations } from "./usePaneConfigurations";
import { usePaneWorkspace } from "./usePaneWorkspace";
import type { DropSide, PaneId } from "./paneLayout";
import { Toolbar } from "./Toolbar";
import type { StatusMessage } from "./Toolbar";
import "./ProjectPage.css";

/** Props for {@link ProjectPage}. */
export interface ProjectPageProps {
    /** The project being edited. */
    readonly project: ProjectInfo;
    /**
     * False while the page is mounted but covered — by settings, say.
     * It keeps rendering so the open document survives, but stops
     * claiming the hot bar's editor actions, which would otherwise
     * edit a document the user cannot see.
     */
    readonly isActive?: boolean;
}

/** A pending name-prompt dialog for a file operation. */
type FileDialogState =
    | { readonly kind: "newFile"; readonly parentDir: string }
    | { readonly kind: "newFolder"; readonly parentDir: string };

/** How long transient info status messages stay visible. */
const STATUS_CLEAR_MS = 2000;

/** Width the file browser opens at, before the user resizes it. */
const DEFAULT_BROWSER_WIDTH_PX = 220;

/**
 * Picks the file to auto-open for a freshly loaded project.
 *
 * Prefers a root-level `<name>.tex`, then a root-level `main.tex`, then
 * the first root-level file — and failing all of those, searches the
 * subdirectories. A project whose `.tex` files all live in `chapters/`
 * otherwise opens to an empty editor.
 *
 * @param tree - The project's root directory node.
 * @param projectName - The project's name.
 * @returns The path to open, or null when the project has no files.
 */
function findMainFilePath(tree: FileNode, projectName: string): string | null {
    if (tree.kind !== "directory") return tree.path;

    const files = tree.children.filter((child) => child.kind === "file");

    const named = files.find((file) => file.name === `${projectName}.tex`);
    if (named) return named.path;

    const main = files.find((file) => file.name === "main.tex");
    if (main) return main.path;

    const rootFile = files[0];
    if (rootFile) return rootFile.path;

    return findFirstFile(tree);
}

/**
 * The first file anywhere below a node, depth first.
 *
 * @param node - The node to search.
 * @returns A file path, or null when the subtree holds none.
 */
function findFirstFile(node: FileNode): string | null {
    if (node.kind === "file") return node.path;

    for (const child of node.children) {
        const found = findFirstFile(child);
        if (found) return found;
    }

    return null;
}

/**
 * Renders the project page and owns its state: the file tree, the
 * bibliography, dock side, file-management dialogs, and the editor
 * actions it registers with the global hotbar.
 *
 * @param props - The project to display.
 * @returns The project page element.
 */
export function ProjectPage({ project, isActive = true }: ProjectPageProps) {
    const { navigate } = useNavigation();
    const { registerEditor } = useAppActions();

    const [tree, setTree] = useState<LoadState<FileNode>>({ status: "loading" });
    const [dockSide, setDockSide] = useState<DockSide>("left");
    const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
    const [dialog, setDialog] = useState<FileDialogState | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>(DEFAULT_VIEW_MODE);
    const [references, setReferences] = useState<readonly Reference[]>([]);
    const [isCompiling, setIsCompiling] = useState(false);

    // Modal editing and spell checking are user preferences, not
    // per-session editor state, so they come from settings and persist.
    const { settings, updateSettings } = useSettings();
    const { modalMode, spellCheckEnabled, lineNumberMode, showDiagnostics, theme } = settings;

    const { confirm, dialog: confirmationDialog } = useConfirm();
    const panes = usePaneWorkspace();
    const panesRef = useRef(panes);
    panesRef.current = panes;

    const statusTimerRef = useRef<number | null>(null);

    /**
     * Counts file-open requests so a slow one cannot overwrite a newer.
     *
     * Two quick clicks would otherwise resolve last-to-finish rather
     * than last-clicked, and the editor would show whichever read
     * happened to come back second.
     */
    const openRequestRef = useRef(0);

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

    /**
     * Asks before throwing away unsaved work in a particular pane.
     *
     * @param paneId - The pane about to be reused, or null to ask about
     *   every pane at once (leaving the project).
     * @returns True when it is safe to proceed.
     */
    const confirmDiscardChanges = useCallback(
        async (paneId: PaneId | null): Promise<boolean> => {
            const dirty =
                paneId === null
                    ? panesRef.current.hasUnsavedChanges
                    : panesRef.current.dirtyPanes.has(paneId);

            if (!dirty) return true;

            return confirm({
                title: "Discard changes?",
                message:
                    paneId === null
                        ? "This project has unsaved changes. Leaving now discards them."
                        : "This pane has unsaved changes. Opening another file discards them.",
                confirmLabel: "Discard",
                isDestructive: true,
            });
        },
        [confirm],
    );

    /**
     * Reads a file and shows it, either in a pane or beside one.
     *
     * Re-opening the file a pane already shows is deliberately *not* a
     * no-op: it re-reads from disk, which is the only way to discard
     * unsaved changes and start again.
     *
     * @param paneId - The pane to open in, or to split.
     * @param path - The file to read.
     * @param side - Which edge to split on, or null to open in place.
     */
    const openFileInPane = useCallback(
        async (paneId: PaneId, path: string, side: DropSide | null = null): Promise<void> => {
            if (side === null && !(await confirmDiscardChanges(paneId))) return;

            const request = (openRequestRef.current += 1);
            const result = await readFile(path);

            // A newer request has been made since; its answer is the one
            // the user is waiting for.
            if (request !== openRequestRef.current) return;

            if (!result.ok) {
                showStatus({ kind: "error", text: result.error });
                return;
            }

            showStatus(null);

            const document = { path, initialDoc: result.data };
            if (side === null) panesRef.current.showDocument(paneId, document);
            else panesRef.current.splitWith(paneId, side, document);
        },
        [confirmDiscardChanges, showStatus],
    );

    /** Opens a file in whichever pane the toolbar is acting on. */
    const openFileByPath = useCallback(
        (path: string): void => {
            void openFileInPane(panesRef.current.activePaneId, path);
        },
        [openFileInPane],
    );

    /**
     * Re-reads the project's bibliography.
     *
     * A missing or unreadable `.bib` file is not worth interrupting the
     * author over — completion simply offers nothing — so a failure
     * leaves the list empty rather than raising a status message.
     */
    const refreshReferences = useCallback(async (): Promise<void> => {
        const result = await listReferences(project.path);

        setReferences(result.ok ? result.data : []);
    }, [project.path]);

    /** Re-fetches the project's file tree. */
    const refreshTree = useCallback(async (): Promise<void> => {
        const result = await listProjectFiles(project.path);

        setTree(
            result.ok
                ? { status: "ready", data: result.data }
                : { status: "error", message: result.error },
        );
    }, [project.path]);

    // Initial tree load; auto-open the project's main file. The
    // cancelled flag guards StrictMode's double-mounted first pass.
    useEffect(() => {
        let cancelled = false;

        void (async () => {
            const result = await listProjectFiles(project.path);
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the cleanup below assigns to this flag, which ESLint's flow analysis does not follow
            if (cancelled) return;

            if (!result.ok) {
                setTree({ status: "error", message: result.error });
                return;
            }

            setTree({ status: "ready", data: result.data });

            if (panesRef.current.activeDocument === null) {
                const mainFilePath = findMainFilePath(result.data, project.name);
                if (mainFilePath) {
                    void openFileInPane(panesRef.current.activePaneId, mainFilePath);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [project.path, project.name, openFileInPane]);

    // The bibliography is read once per project; saving a file reloads
    // it, so an entry added in the editor is citable straight away.
    useEffect(() => {
        void refreshReferences();
    }, [refreshReferences]);

    /**
     * Writes one pane's document back to disk.
     *
     * @param paneId - The pane to save.
     */
    const savePane = useCallback(
        async (paneId: PaneId): Promise<void> => {
            const view = panesRef.current.viewFor(paneId);
            const document = panesRef.current.documents.get(paneId);
            if (!view || !document) return;

            const result = await saveFile(document.path, view.state.doc.toString());

            if (!result.ok) {
                showStatus({ kind: "error", text: `Save failed: ${result.error}` });
                return;
            }

            showStatus({ kind: "info", text: "Saved ✓" });
            panesRef.current.markClean(paneId);

            // The saved file may have been a `.bib`, so the citation list
            // is refreshed rather than left stale until the project reopens.
            if (document.path.toLowerCase().endsWith(".bib")) void refreshReferences();
        },
        [showStatus, refreshReferences],
    );

    /**
     * Compiles the active pane's document to PDF.
     *
     * Saves first. Compiling what is on disk while the author looks at
     * something newer on screen reports errors against lines they
     * cannot see, which is worse than not compiling at all.
     */
    const compileActivePane = useCallback(async (): Promise<void> => {
        const document = panesRef.current.documents.get(panesRef.current.activePaneId);
        if (!document) return;

        const mainFile = relativeTo(project.path, document.path);
        if (mainFile === null) {
            showStatus({ kind: "error", text: "That file is not part of this project" });
            return;
        }

        await savePane(panesRef.current.activePaneId);

        setIsCompiling(true);
        const result = await compileProject(project.path, mainFile);
        setIsCompiling(false);

        if (!result.ok) {
            showStatus({ kind: "error", text: `Compile failed: ${result.error}` });
            return;
        }

        // The PDF lands beside the source, so the browser is a file out
        // of date until it is reloaded. This happens even when the
        // document had errors: the engine writes a best-effort PDF
        // anyway, and hiding it would be pretending it does not exist.
        if (result.data.pdfPath !== null) void refreshTree();

        const errors = result.data.diagnostics.filter(
            (diagnostic) => diagnostic.severity === "error",
        );
        const first = errors[0];

        if (first) {
            const where = first.line === null ? first.file : `${first.file}:${first.line}`;

            showStatus({
                kind: "error",
                text: `${errors.length} error${errors.length === 1 ? "" : "s"} — ${where} ${first.message}`,
            });
            return;
        }

        showStatus({
            kind: "info",
            text: result.data.pdfPath ? "Compiled ✓" : "No PDF produced",
        });
    }, [project.path, savePane, showStatus, refreshTree]);

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
                panesRef.current.repointPaths(operation.sourcePath, result.data);
                void refreshTree();
                return;
            }

            const confirmed = await confirm({
                title: "Delete this entry?",
                message: `"${operation.name}" will be moved to the recycle bin.`,
                confirmLabel: "Delete",
                isDestructive: true,
            });
            if (!confirmed) return;

            const result = await deleteEntry(operation.path);

            if (!result.ok) {
                showStatus({ kind: "error", text: result.error });
                return;
            }

            // Empty any pane showing the deleted entry, or something
            // that lived inside it.
            panesRef.current.forgetDeleted(operation.path);

            void refreshTree();
        },
        [refreshTree, showStatus, confirm],
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

            panesRef.current.repointPaths(path, result.data);
            void refreshTree();
            return null;
        },
        [refreshTree],
    );

    /**
     * Executes the operation behind the open name dialog.
     *
     * @param name - The validated name from the dialog.
     * @returns An inline error message, or null on success.
     */
    const handleDialogSubmit = useCallback(
        async ({ name, extension }: NameDialogResult): Promise<string | null> => {
            if (!dialog) return null;

            switch (dialog.kind) {
                case "newFile": {
                    const result = await createFile(
                        dialog.parentDir,
                        name,
                        extension ?? DEFAULT_FILE_EXTENSION,
                    );
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
                void savePane(panesRef.current.activePaneId);
            },
            undo: () => {
                const view = panesRef.current.activeView();
                if (!view) return;
                undo(view);
                view.focus();
            },
            redo: () => {
                const view = panesRef.current.activeView();
                if (!view) return;
                redo(view);
                view.focus();
            },
            insertSnippet: (name: SnippetName) => {
                const view = panesRef.current.activeView();
                if (!view) return;
                insertSnippetIntoView(view, SNIPPETS[name]);
            },
            newFile: () => {
                setDialog({ kind: "newFile", parentDir: project.path });
            },
            compile: () => {
                void compileActivePane();
            },
            exitProject: () => {
                void (async () => {
                    if (!(await confirmDiscardChanges(null))) return;
                    navigate({ kind: "browser" });
                })();
            },
            viewMode,
            setViewMode: (mode: ViewMode) => setViewMode(mode),
            findReplace: () => {
                const view = panesRef.current.activeView();
                if (!view) return;
                openSearchPanel(view);
                view.focus();
            },
        }),
        [savePane, confirmDiscardChanges, compileActivePane, navigate, project.path, viewMode],
    );

    // The settings every editor on this page shares. The editor applies
    // these itself, so the page does not hold a view in order to change
    // a setting — which is what lets a second editor exist.
    //
    // The two per-*file* fields are deliberately absent: the file type
    // and the image resolver depend on which document a pane has open,
    // and `usePaneConfigurations` fills them in per pane.
    const sharedSettings = useMemo(
        () => ({
            viewMode,
            modalMode,
            spellCheckEnabled,
            theme,
            lineNumberMode,
            showDiagnostics,
            references,
            openLink: openExternalLink,
        }),
        [
            viewMode,
            modalMode,
            spellCheckEnabled,
            theme,
            lineNumberMode,
            showDiagnostics,
            references,
        ],
    );

    const configurationFor = usePaneConfigurations(sharedSettings);

    // Make the hotbar's Save/Undo/Redo/Insert items work while this
    // page is open.
    useEffect(() => {
        registerEditor(isActive ? actions : null);

        return () => registerEditor(null);
    }, [registerEditor, actions, isActive]);

    const { isDragging, hoverSide, handleProps } = useDockDrag(setDockSide);

    return (
        <div
            className={`project-page${dockSide === "right" ? " project-page-dock-right" : ""}`}
        >
            <Toolbar
                isDirty={panes.isActiveDirty}
                hasOpenFile={panes.activeDocument !== null}
                isCompiling={isCompiling}
                actions={actions}
                statusMessage={statusMessage}
            />

            <div className="project-workspace">
                <ResizablePanel
                    initialWidth={DEFAULT_BROWSER_WIDTH_PX}
                    side={dockSide}
                    label="the file browser"
                >
                    <FileBrowser
                        tree={tree}
                        selectedPath={panes.activeDocument?.path ?? null}
                        onSelectFile={openFileByPath}
                        onFileOperation={(operation) => void handleFileOperation(operation)}
                        onRename={renameInline}
                        dragHandleProps={handleProps}
                    />
                </ResizablePanel>

                <section className="project-editor-panel">
                    <PaneTree
                        node={panes.layout}
                        documents={panes.documents}
                        dirtyPanes={panes.dirtyPanes}
                        activePaneId={panes.activePaneId}
                        canClose={panes.hasSeveralPanes}
                        configurationFor={configurationFor}
                        onActivate={panes.activate}
                        onDropFile={(paneId, side, path) => {
                            void openFileInPane(paneId, path, side);
                        }}
                        onClose={panes.close}
                        onViewReady={panes.registerView}
                        onViewDestroyed={panes.unregisterView}
                        onDocChanged={panes.markDirty}
                        onSaveRequested={(paneId) => void savePane(paneId)}
                        onDiagnosticsToggled={(visible) => {
                            updateSettings({ showDiagnostics: visible });
                        }}
                        onResizeSplit={panes.resize}
                    />
                </section>
            </div>

            {dialog && (
                <NameDialog
                    title={dialogTitle(dialog)}
                    placeholder={dialog.kind === "newFolder" ? "Folder name" : "File name"}
                    submitLabel="Create"
                    withFileType={dialog.kind === "newFile"}
                    onSubmit={handleDialogSubmit}
                    onCancel={() => setDialog(null)}
                />
            )}

            {confirmationDialog}

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
