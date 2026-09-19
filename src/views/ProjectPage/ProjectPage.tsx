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
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { NameDialog } from "../../components/NameDialog";
import { useConfirm } from "../../components/useConfirm";
import type { NameDialogResult } from "../../components/NameDialog";
import { ResizablePanel } from "../../components/ResizablePanel";
import { compiledPdfPath, DEFAULT_FILE_EXTENSION, isPdfPath } from "../../shared/fileTypes";
import { join, relativeTo, reparent, separatorOf, withSeparator } from "../../shared/paths";
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
    exportPdf,
    getProjectSettings,
    onCompileProgress,
    readFile,
    openExternalLink,
    renameEntry,
    saveFile,
    saveProjectSettings,
    syncToPdf,
    syncToSource,
} from "../../shared/tauri";
import type {
    CompileDiagnostic,
    FileNode,
    LoadState,
    PdfLocation,
    ProjectInfo,
    Reference,
    Result,
    ViewMode,
} from "../../shared/types";
import { useDockDrag } from "../../shared/useDockDrag";
import type { DockSide } from "../../shared/useDockDrag";
import { openSearchPanel } from "@codemirror/search";
import { DEFAULT_VIEW_MODE } from "../editor/TextEditor/viewMode";
import { SNIPPETS, insertSnippetIntoView } from "../editor/TextEditor/snippets";
import { FileBrowser } from "./FileBrowser";
import type { FileOperation } from "./FileBrowser";
import type { LoadedFile } from "./EditorPane";
import { PaneTree } from "./PaneTree";
import { ProblemsPanel } from "./ProblemsPanel";
import {
    projectFiles,
    resolveDiagnosticFile,
    resolveRootDocument,
    summarizeDiagnostics,
} from "./compileLoop";
import { useCompileLoop } from "./useCompileLoop";
import { usePaneConfigurations } from "./usePaneConfigurations";
import { usePaneWorkspace } from "./usePaneWorkspace";
import type { PaneWorkspace } from "./usePaneWorkspace";
import { listPanes } from "./paneLayout";
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

/** Why one pane's unsaved document is about to be discarded. */
type DiscardReason = "replace" | "close";

/** What the last compile reported, and which document it built. */
interface CompileProblems {
    /** The root document, relative to the project with `/`. */
    readonly rootFile: string;
    readonly diagnostics: readonly CompileDiagnostic[];
}

/** A source line to jump to once its file has opened. */
interface PendingJump {
    readonly path: string;
    readonly line: number;
}

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
 * Loads a file in the form a pane shows it.
 *
 * A PDF is not read at all: the viewer loads it straight off disk, and
 * `readFile` refuses anything that is not editable text.
 *
 * @param path - The file to load.
 * @returns The loaded file, or the read error.
 */
async function loadPaneFile(path: string): Promise<Result<LoadedFile>> {
    if (isPdfPath(path)) return { ok: true, data: { kind: "pdf", path } };

    const result = await readFile(path);

    return result.ok
        ? { ok: true, data: { kind: "text", path, initialDoc: result.data } }
        : result;
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
 * Puts the cursor at the start of a line, centred on screen.
 *
 * @param view - The editor.
 * @param line - The 1-based line; out-of-range values are clamped.
 */
function goToLine(view: EditorView, line: number): void {
    const { doc } = view.state;
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines));

    view.dispatch({
        selection: { anchor: target.from },
        effects: EditorView.scrollIntoView(target.from, { y: "center" }),
    });
    view.focus();
}

/**
 * The pane a source file should open in: the active one, unless it is
 * showing a PDF the author presumably wants to keep looking at.
 *
 * @param workspace - The panes.
 * @returns A pane not showing a PDF, or null when every pane is one.
 */
function sourcePaneOf(workspace: PaneWorkspace): PaneId | null {
    const candidates = [
        workspace.activePaneId,
        ...listPanes(workspace.layout).map((p) => p.id),
    ];

    return candidates.find((id) => workspace.documents.get(id)?.kind !== "pdf") ?? null;
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
    const [storedMainFile, setStoredMainFile] = useState<string | null>(null);
    const [problems, setProblems] = useState<CompileProblems | null>(null);
    const [pdfTarget, setPdfTarget] = useState<{
        readonly paneId: PaneId;
        readonly location: PdfLocation;
    } | null>(null);

    // Modal editing and spell checking are user preferences, not
    // per-session editor state, so they come from settings and persist.
    const { settings, updateSettings } = useSettings();
    const {
        modalMode,
        spellCheckEnabled,
        lineNumberMode,
        showDiagnostics,
        theme,
        openPdfAfterCompile,
        compileOnSave,
    } = settings;

    // Every file in the project, relative → absolute. Compiling works in
    // relative paths (the engine's and the settings' form); the map turns
    // them back into the exact paths the file tree and panes use.
    const files = useMemo(
        () =>
            tree.status === "ready"
                ? projectFiles(tree.data, project.path)
                : new Map<string, string>(),
        [tree, project.path],
    );
    const filesRef = useRef(files);
    filesRef.current = files;
    const storedMainFileRef = useRef(storedMainFile);
    storedMainFileRef.current = storedMainFile;

    const pendingJumpRef = useRef<PendingJump | null>(null);

    /** Set by a Compile click, so only a compile the author asked for
     * opens a PDF pane — a compile on save only reloads one. */
    const shouldOpenPdfRef = useRef(false);

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
     * @param reason - What will discard a single pane's document.
     * @returns True when it is safe to proceed.
     */
    const confirmDiscardChanges = useCallback(
        async (paneId: PaneId | null, reason: DiscardReason = "replace"): Promise<boolean> => {
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
                        : reason === "close"
                          ? "This pane has unsaved changes. Closing it discards them."
                          : "This pane has unsaved changes. Opening another file discards them.",
                confirmLabel: "Discard",
                isDestructive: true,
            });
        },
        [confirm],
    );

    /** Closes a pane after protecting any unsaved document it contains. */
    const closePane = useCallback(
        (paneId: PaneId): void => {
            void (async () => {
                if (!(await confirmDiscardChanges(paneId, "close"))) return;

                panesRef.current.close(paneId);
            })();
        },
        [confirmDiscardChanges],
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
            const result = await loadPaneFile(path);

            // A newer request has been made since; its answer is the one
            // the user is waiting for.
            if (request !== openRequestRef.current) return;

            if (!result.ok) {
                showStatus({ kind: "error", text: result.error });
                return;
            }

            showStatus(null);

            if (side === null) panesRef.current.showDocument(paneId, result.data);
            else panesRef.current.splitWith(paneId, side, result.data);
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
            const [result, stored] = await Promise.all([
                listProjectFiles(project.path),
                getProjectSettings(project.path),
            ]);
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the cleanup below assigns to this flag, which ESLint's flow analysis does not follow
            if (cancelled) return;

            if (!result.ok) {
                setTree({ status: "error", message: result.error });
                return;
            }

            setTree({ status: "ready", data: result.data });

            // Unreadable settings are no reason to refuse the project; the
            // root is then worked out as if none had been chosen.
            const mainFile = stored.ok ? stored.data.mainFile : null;
            setStoredMainFile(mainFile);

            if (panesRef.current.activeDocument === null) {
                const storedMainPath =
                    mainFile === null
                        ? undefined
                        : projectFiles(result.data, project.path).get(mainFile);
                const mainFilePath =
                    storedMainPath ?? findMainFilePath(result.data, project.name);
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
     * @returns True when the file was written.
     */
    const writePane = useCallback(
        async (paneId: PaneId): Promise<boolean> => {
            const view = panesRef.current.viewFor(paneId);
            const document = panesRef.current.documents.get(paneId);
            if (!view || !document) return false;

            const result = await saveFile(document.path, view.state.doc.toString());

            if (!result.ok) {
                showStatus({ kind: "error", text: `Save failed: ${result.error}` });
                return false;
            }

            showStatus({ kind: "info", text: "Saved ✓" });
            panesRef.current.markClean(paneId);

            // The saved file may have been a `.bib`, so the citation list
            // is refreshed rather than left stale until the project reopens.
            if (document.path.toLowerCase().endsWith(".bib")) void refreshReferences();
            return true;
        },
        [showStatus, refreshReferences],
    );

    /**
     * The absolute path of a project file.
     *
     * @param relative - The file, relative to the project with `/`.
     * @returns Its path in the file tree, or one built from the project
     *   path for a file the tree has not caught up with.
     */
    const absolutePathOf = useCallback(
        (relative: string): string =>
            filesRef.current.get(relative) ??
            join(project.path, withSeparator(relative, separatorOf(project.path))),
        [project.path],
    );

    /**
     * Decides which document compiling builds right now.
     *
     * @returns The root document, relative with `/`, or null.
     */
    const resolveRoot = useCallback((): string | null => {
        const workspace = panesRef.current;
        const document = workspace.activeDocument;
        const view = workspace.activeView();
        const file = document?.kind === "text" ? relativeTo(project.path, document.path) : null;

        return resolveRootDocument({
            projectName: project.name,
            files: filesRef.current,
            storedMainFile: storedMainFileRef.current,
            active: file !== null && view ? { file, text: view.state.doc.toString() } : null,
        });
    }, [project.path, project.name]);

    /**
     * The pane already showing a PDF, if any.
     *
     * @param pdfPath - The PDF.
     * @returns That pane, or null.
     */
    const paneShowingPdf = useCallback((pdfPath: string): PaneId | null => {
        for (const [paneId, document] of panesRef.current.documents) {
            if (document.kind === "pdf" && document.path === pdfPath) return paneId;
        }

        return null;
    }, []);

    /**
     * Opens a PDF to the right of a pane, keeping focus where it was so
     * the author carries on typing rather than in the viewer.
     *
     * @param besidePaneId - The pane to open beside.
     * @param pdfPath - The PDF.
     * @returns The new pane.
     */
    const openPdfBeside = useCallback((besidePaneId: PaneId, pdfPath: string): PaneId => {
        const workspace = panesRef.current;
        const paneId = workspace.splitWith(besidePaneId, "right", {
            kind: "pdf",
            path: pdfPath,
        });
        workspace.activate(besidePaneId);
        return paneId;
    }, []);

    /**
     * Compiles the root document and reports what happened.
     *
     * Run through {@link useCompileLoop}, which guarantees only one of
     * these is ever in flight.
     */
    const runCompile = useCallback(async (): Promise<void> => {
        const shouldOpenPdf = shouldOpenPdfRef.current && openPdfAfterCompile;
        shouldOpenPdfRef.current = false;

        const rootFile = resolveRoot();
        if (rootFile === null) {
            showStatus({ kind: "error", text: "There is no .tex document to compile" });
            return;
        }

        const sourcePaneId = panesRef.current.activePaneId;
        const result = await compileProject(project.path, rootFile);

        if (!result.ok) {
            showStatus({ kind: "error", text: `Compile failed: ${result.error}` });
            return;
        }

        const { pdfPath, diagnostics } = result.data;

        // Even a document with errors gets a best-effort PDF; hiding it
        // would be pretending it does not exist.
        if (pdfPath !== null) {
            const relativePdf = relativeTo(project.path, pdfPath);
            if (relativePdf === null || !filesRef.current.has(relativePdf)) void refreshTree();

            const showing = paneShowingPdf(pdfPath);
            if (showing !== null)
                panesRef.current.showDocument(showing, { kind: "pdf", path: pdfPath });
            else if (shouldOpenPdf) openPdfBeside(sourcePaneId, pdfPath);
        }

        setProblems(diagnostics.length > 0 ? { rootFile, diagnostics } : null);

        const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
        showStatus(
            diagnostics.length > 0
                ? {
                      kind: hasErrors ? "error" : "info",
                      text: summarizeDiagnostics(diagnostics),
                  }
                : { kind: "info", text: pdfPath ? "Compiled ✓" : "No PDF produced" },
        );
    }, [
        project.path,
        resolveRoot,
        showStatus,
        refreshTree,
        openPdfAfterCompile,
        paneShowingPdf,
        openPdfBeside,
    ]);

    const compileLoop = useCompileLoop(runCompile);

    /**
     * Saves one pane, then compiles in the background if the user asked
     * for compile-on-save.
     *
     * @param paneId - The pane to save.
     */
    const savePane = useCallback(
        async (paneId: PaneId): Promise<void> => {
            if ((await writePane(paneId)) && compileOnSave) compileLoop.compileSoon();
        },
        [writePane, compileOnSave, compileLoop],
    );

    /**
     * Saves every unsaved pane, then compiles.
     *
     * Compiling what is on disk while the author looks at something
     * newer reports errors against lines they cannot see. With a root
     * document the edits may be in any pane, so all of them are saved.
     */
    const compileManually = useCallback(async (): Promise<void> => {
        await Promise.all([...panesRef.current.dirtyPanes].map(writePane));

        shouldOpenPdfRef.current = true;
        compileLoop.compileNow();
    }, [writePane, compileLoop]);

    // Name each package a cold-cache compile downloads, so a first
    // compile that takes a minute does not look like a hang.
    useEffect(() => {
        const unsubscribe = onCompileProgress((file) => {
            showStatus({
                kind: "info",
                text: `Downloading LaTeX packages (first compile only): ${file}`,
            });
        });

        return () => {
            void unsubscribe.then((stop) => stop());
        };
    }, [showStatus]);

    /**
     * Shows a source line in an editor, opening its file if need be.
     *
     * @param file - The file, relative to the project with `/`.
     * @param line - The 1-based line.
     */
    const revealSource = useCallback(
        async (file: string, line: number): Promise<void> => {
            const workspace = panesRef.current;
            const path = absolutePathOf(file);

            for (const [paneId, document] of workspace.documents) {
                const view = workspace.viewFor(paneId);
                if (document.kind !== "text" || document.path !== path || !view) continue;

                workspace.activate(paneId);
                goToLine(view, line);
                return;
            }

            // The editor does not exist until the file loads; the jump is
            // made when it registers (see `handleViewReady`).
            pendingJumpRef.current = { path, line };
            const paneId = sourcePaneOf(workspace);

            if (paneId !== null) await openFileInPane(paneId, path);
            else await openFileInPane(workspace.activePaneId, path, "left");
        },
        [absolutePathOf, openFileInPane],
    );

    /**
     * Registers a pane's editor, and makes any jump waiting for it.
     *
     * @param paneId - The pane.
     * @param view - Its new editor.
     */
    const handleViewReady = useCallback((paneId: PaneId, view: EditorView): void => {
        panesRef.current.registerView(paneId, view);

        const jump = pendingJumpRef.current;
        if (!jump || panesRef.current.documents.get(paneId)?.path !== jump.path) return;

        pendingJumpRef.current = null;
        goToLine(view, jump.line);
    }, []);

    /**
     * Jumps to the source line behind a double-clicked spot in a PDF.
     *
     * @param pdfPath - The PDF.
     * @param location - Where it was clicked.
     */
    const jumpToSource = useCallback(
        async (pdfPath: string, location: PdfLocation): Promise<void> => {
            const result = await syncToSource(pdfPath, location);
            if (!result.ok) {
                showStatus({ kind: "error", text: result.error });
                return;
            }

            const file = relativeTo(project.path, result.data.file);
            if (file === null) {
                showStatus({
                    kind: "error",
                    text: "That text comes from outside this project",
                });
                return;
            }

            await revealSource(file, result.data.line);
        },
        [project.path, showStatus, revealSource],
    );

    /**
     * Scrolls the compiled PDF to the cursor's line, opening it if it is
     * not on screen.
     */
    const showInPdf = useCallback(async (): Promise<void> => {
        const workspace = panesRef.current;
        const document = workspace.activeDocument;
        const view = workspace.activeView();
        const rootFile = resolveRoot();
        if (document?.kind !== "text" || !view || rootFile === null) return;

        const pdfPath = compiledPdfPath(project.path, absolutePathOf(rootFile));
        const line = view.state.doc.lineAt(view.state.selection.main.head).number;
        const result = await syncToPdf(pdfPath, document.path, line);

        if (!result.ok) {
            showStatus({ kind: "error", text: result.error });
            return;
        }

        const paneId =
            paneShowingPdf(pdfPath) ?? openPdfBeside(workspace.activePaneId, pdfPath);
        setPdfTarget({ paneId, location: result.data });
    }, [project.path, resolveRoot, absolutePathOf, showStatus, paneShowingPdf, openPdfBeside]);

    /**
     * Jumps to the line a compile problem names.
     *
     * @param diagnostic - The problem picked.
     */
    const selectProblem = useCallback(
        (diagnostic: CompileDiagnostic): void => {
            if (!problems) return;

            const file = resolveDiagnosticFile(
                diagnostic.file,
                problems.rootFile,
                filesRef.current,
            );
            if (file === null) {
                showStatus({
                    kind: "error",
                    text: `${diagnostic.file} is not in this project`,
                });
                return;
            }

            void revealSource(file, diagnostic.line ?? 1);
        },
        [problems, showStatus, revealSource],
    );

    /**
     * Stores the document compiling should build.
     *
     * @param relative - The document, relative with `/`, or null.
     * @returns An error message, or null on success.
     */
    const storeMainFile = useCallback(
        async (relative: string | null): Promise<string | null> => {
            const result = await saveProjectSettings(project.path, { mainFile: relative });
            if (!result.ok) return result.error;

            setStoredMainFile(relative);
            return null;
        },
        [project.path],
    );

    /**
     * Keeps the stored main document pointing at its file when the file,
     * or a folder above it, is renamed or moved.
     *
     * @param from - The entry's old path.
     * @param to - Its new path.
     */
    const followMainFile = useCallback(
        (from: string, to: string): void => {
            const stored = storedMainFileRef.current;
            const moved = stored === null ? null : reparent(absolutePathOf(stored), from, to);
            const relative = moved === null ? null : relativeTo(project.path, moved);

            if (relative !== null) void storeMainFile(relative);
        },
        [absolutePathOf, project.path, storeMainFile],
    );

    /**
     * Exports the active pane's PDF to wherever the user chooses.
     *
     * A PDF pane exports what it shows; a document exports the PDF its
     * root document compiles to. The destination dialog is opened by the
     * backend, so there is no path to choose here.
     */
    const exportActivePdf = useCallback(async (): Promise<void> => {
        const document = panesRef.current.activeDocument;
        const rootFile = resolveRoot();
        if (!document) return;

        const pdfPath =
            document.kind === "pdf"
                ? document.path
                : compiledPdfPath(
                      project.path,
                      rootFile === null ? document.path : absolutePathOf(rootFile),
                  );
        const result = await exportPdf(pdfPath);

        if (!result.ok) {
            showStatus({ kind: "error", text: `Export failed: ${result.error}` });
            return;
        }

        // Null means the dialog was cancelled, which needs no comment.
        const { exportedTo } = result.data;
        if (exportedTo !== null)
            showStatus({ kind: "info", text: `Exported to ${exportedTo}` });
    }, [project.path, showStatus, resolveRoot, absolutePathOf]);

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

            if (operation.kind === "setMain") {
                const relative = relativeTo(project.path, operation.path);
                const error =
                    relative === null
                        ? "That file is not part of this project"
                        : await storeMainFile(relative);
                showStatus(
                    error === null
                        ? { kind: "info", text: "Main document set ✓" }
                        : { kind: "error", text: error },
                );
                return;
            }

            if (operation.kind === "move") {
                const result = await moveEntry(operation.sourcePath, operation.destDir);
                if (!result.ok) {
                    showStatus({ kind: "error", text: result.error });
                    return;
                }
                panesRef.current.repointPaths(operation.sourcePath, result.data);
                followMainFile(operation.sourcePath, result.data);
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
        [refreshTree, showStatus, confirm, project.path, storeMainFile, followMainFile],
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
            followMainFile(path, result.data);
            void refreshTree();
            return null;
        },
        [refreshTree, followMainFile],
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
                void compileManually();
            },
            showInPdf: () => {
                void showInPdf();
            },
            exportPdf: () => {
                void exportActivePdf();
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
        [
            savePane,
            confirmDiscardChanges,
            compileManually,
            showInPdf,
            exportActivePdf,
            navigate,
            project.path,
            viewMode,
        ],
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

    // What the file browser badges as "main": the document compiling
    // builds when no open file overrides it with a magic comment.
    const defaultRoot = useMemo(
        () =>
            resolveRootDocument({
                projectName: project.name,
                files,
                storedMainFile,
                active: null,
            }),
        [project.name, files, storedMainFile],
    );

    /**
     * Page-wide shortcuts that are not the editor's business.
     *
     * @param event - The key press.
     */
    const handleKeyDown = (event: ReactKeyboardEvent): void => {
        if (!event.ctrlKey || !event.altKey || event.key.toLowerCase() !== "j") return;

        event.preventDefault();
        actions.showInPdf();
    };

    return (
        <div
            className={`project-page${dockSide === "right" ? " project-page-dock-right" : ""}`}
            onKeyDown={handleKeyDown}
        >
            <Toolbar
                isDirty={panes.isActiveDirty}
                hasOpenFile={panes.activeDocument !== null}
                canEditFile={panes.activeDocument?.kind === "text"}
                isCompiling={compileLoop.isCompiling}
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
                        mainFilePath={
                            defaultRoot === null ? null : (files.get(defaultRoot) ?? null)
                        }
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
                        onClose={closePane}
                        onViewReady={handleViewReady}
                        onViewDestroyed={panes.unregisterView}
                        onDocChanged={panes.markDirty}
                        onSaveRequested={(paneId) => void savePane(paneId)}
                        onDiagnosticsToggled={(visible) => {
                            updateSettings({ showDiagnostics: visible });
                        }}
                        onResizeSplit={panes.resize}
                        pdfTarget={pdfTarget}
                        onPdfDoubleClick={(pdfPath, location) => {
                            void jumpToSource(pdfPath, location);
                        }}
                    />
                    {problems && (
                        <ProblemsPanel
                            diagnostics={problems.diagnostics}
                            onSelect={selectProblem}
                            onClose={() => setProblems(null)}
                        />
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
