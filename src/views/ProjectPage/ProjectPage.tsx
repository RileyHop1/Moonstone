/**
 * Project page: dockable file browser, toolbar, file management, and
 * the live-preview editor for one open file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { NameDialog } from "../../components/NameDialog";
import type { NameDialogResult } from "../../components/NameDialog";
import { ResizablePanel } from "../../components/ResizablePanel";
import { DEFAULT_FILE_EXTENSION } from "../../shared/fileTypes";
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
    readFile,
    createImageSourceResolver,
    openExternalLink,
    renameEntry,
    saveFile,
} from "../../shared/tauri";
import type {
    FileNode,
    LoadState,
    ProjectInfo,
    Reference,
    ViewMode,
} from "../../shared/types";
import { useDockDrag } from "../../shared/useDockDrag";
import type { DockSide } from "../../shared/useDockDrag";
import { openSearchPanel } from "@codemirror/search";
import { setDiagnosticsVisible } from "../editor/TextEditor/Diagnostics";
import { TextEditor } from "../editor/TextEditor";
import {
    DEFAULT_VIEW_MODE,
    previewCompartment,
    previewExtensionForMode,
} from "../editor/TextEditor/viewMode";
import { modalCompartment, modalExtensionForMode } from "../editor/TextEditor/modalMode";
import { moonstoneThemeForMode, themeCompartment } from "../editor/TextEditor/moonstoneTheme";
import {
    spellCheckCompartment,
    spellCheckExtensionForEnabled,
} from "../editor/TextEditor/SpellCheck";
import {
    referencesCompartment,
    referencesExtension,
} from "../editor/TextEditor/References";
import {
    lineNumbersCompartment,
    lineNumbersExtensionForMode,
} from "../editor/TextEditor/LineNumbers";
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
    /**
     * False while the page is mounted but covered — by settings, say.
     * It keeps rendering so the open document survives, but stops
     * claiming the hot bar's editor actions, which would otherwise
     * edit a document the user cannot see.
     */
    readonly isActive?: boolean;
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

/** Width the file browser opens at, before the user resizes it. */
const DEFAULT_BROWSER_WIDTH_PX = 220;

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
export function ProjectPage({ project, isActive = true }: ProjectPageProps) {
    const { navigate } = useNavigation();
    const { registerEditor } = useAppActions();

    const [tree, setTree] = useState<LoadState<FileNode>>({ status: "loading" });
    const [openFile, setOpenFile] = useState<OpenFile | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [dockSide, setDockSide] = useState<DockSide>("left");
    const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
    const [dialog, setDialog] = useState<FileDialogState | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>(DEFAULT_VIEW_MODE);
    const [references, setReferences] = useState<readonly Reference[]>([]);

    // Modal editing and spell checking are user preferences, not
    // per-session editor state, so they come from settings and persist.
    const { settings, updateSettings } = useSettings();
    const { modalMode, spellCheckEnabled, lineNumberMode, showDiagnostics, theme } = settings;

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

    // The bibliography is read once per project; saving a file reloads
    // it, so an entry added in the editor is citable straight away.
    useEffect(() => {
        void refreshReferences();
    }, [refreshReferences]);


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

        // The saved file may have been a `.bib`, so the citation list
        // is refreshed rather than left stale until the project reopens.
        if (file.path.toLowerCase().endsWith(".bib")) void refreshReferences();
    }, [showStatus, refreshReferences]);

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
        }),
        [save, confirmDiscardChanges, navigate, project.path, viewMode],
    );

    // Image paths in LaTeX are relative to the document, so the
    // resolver is rebuilt whenever a different file opens.
    const resolveImageSource = useMemo(
        () => createImageSourceResolver(openFile?.path ?? null),
        [openFile?.path],
    );

    // Swap the preview configuration in place when the mode changes,
    // preserving the document and undo history (a remount would lose
    // both). No-ops when no file is open yet.
    useEffect(() => {
        viewRef.current?.dispatch({
            effects: previewCompartment.reconfigure(
                previewExtensionForMode(viewMode, resolveImageSource, openExternalLink),
            ),
        });
    }, [viewMode, resolveImageSource]);

    // Swap the modal keymap (vim/helix/none) in place, preserving
    // document and undo history.
    useEffect(() => {
        viewRef.current?.dispatch({
            effects: modalCompartment.reconfigure(modalExtensionForMode(modalMode)),
        });
    }, [modalMode]);

    // Hand the editor the current bibliography in place, so references
    // added while the project is open become citable immediately.
    useEffect(() => {
        viewRef.current?.dispatch({
            effects: referencesCompartment.reconfigure(referencesExtension(references)),
        });
    }, [references]);

    // Line numbering follows both its own setting and the modal mode,
    // since "mixed" is defined in terms of the modal editor's state.
    useEffect(() => {
        viewRef.current?.dispatch({
            effects: lineNumbersCompartment.reconfigure(
                lineNumbersExtensionForMode(lineNumberMode, modalMode),
            ),
        });
    }, [lineNumberMode, modalMode]);

    // Show or hide the diagnostic overlay in place.
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;

        setDiagnosticsVisible(view, showDiagnostics);
    }, [showDiagnostics]);

    // Swap the editor's palette in place. The CSS variables restyle
    // themselves, but CodeMirror's `dark` flag lives in the theme
    // extension and decides which half of every `&dark`/`&light` rule
    // applies — so it has to be reconfigured, not just repainted.
    useEffect(() => {
        viewRef.current?.dispatch({
            effects: themeCompartment.reconfigure(moonstoneThemeForMode(theme)),
        });
    }, [theme]);

    // Turn spell checking on or off in place.
    useEffect(() => {
        viewRef.current?.dispatch({
            effects: spellCheckCompartment.reconfigure(
                spellCheckExtensionForEnabled(spellCheckEnabled),
            ),
        });
    }, [spellCheckEnabled]);

    // Make the hotbar's Save/Undo/Redo/Insert items work while this
    // page is open.
    useEffect(() => {
        registerEditor(isActive ? actions : null);

        return () => registerEditor(null);
    }, [registerEditor, actions, isActive]);

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
                <ResizablePanel
                    initialWidth={DEFAULT_BROWSER_WIDTH_PX}
                    side={dockSide}
                    label="the file browser"
                >
                    <FileBrowser
                        tree={tree}
                        selectedPath={openFile?.path ?? null}
                        onSelectFile={(path) => void openFileByPath(path)}
                        onFileOperation={(operation) => void handleFileOperation(operation)}
                        onRename={renameInline}
                        dragHandleProps={handleProps}
                    />
                </ResizablePanel>

                <section className="project-editor-panel">
                    {openFile ? (
                        <TextEditor
                            // Remount per file: clean editor + fresh undo history.
                            key={openFile.path}
                            initialDoc={openFile.initialDoc}
                            initialViewMode={viewMode}
                            initialModalMode={modalMode}
                            initialSpellCheckEnabled={spellCheckEnabled}
                            initialTheme={theme}
                            initialLineNumberMode={lineNumberMode}
                            initialShowDiagnostics={showDiagnostics}
                            onDiagnosticsToggled={(visible) =>
                                updateSettings({ showDiagnostics: visible })
                            }
                            initialReferences={references}
                            resolveImageSource={resolveImageSource}
                            openLink={openExternalLink}
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
                    withFileType={dialog.kind === "newFile"}
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
