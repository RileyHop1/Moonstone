/**
 * Browser-test harness for the project page's workspace layout: the
 * resizable file-browser panel beside the editor pane.
 *
 * No Tauri backend is involved and none is mocked. `FileBrowser` takes
 * its tree as a prop, so a fixture tree is enough to render the real
 * component — which keeps this harness honest, since a mocked backend
 * that drifted from the real one would produce tests that pass while
 * the app is broken.
 *
 * The editor area has two modes. By default it is a placeholder, since
 * what those specs test is how the panes share width and mounting
 * CodeMirror would only add noise. With `panes=on` it mounts the real
 * `PaneTree` over the real `usePaneWorkspace`, which is the only way to
 * exercise drop-to-split under real layout: the drag payload, the edge
 * geometry, and CodeMirror's own competing drop handler all matter, and
 * none of the three is visible to jsdom.
 *
 * | Param   | Values             | Default |
 * |---------|--------------------|---------|
 * | `side`  | `left` \| `right`  | `left` |
 * | `width` | initial panel width in px | 220 |
 * | `names` | `long` \| `short`  | `long` |
 * | `theme` | any registered theme id | `dark` |
 * | `panes` | `on` \| `off`      | `off` |
 */

import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ResizablePanel } from "../../components/ResizablePanel";
import { FileBrowser } from "../../views/ProjectPage/FileBrowser";
import { PaneTree } from "../../views/ProjectPage/PaneTree";
import { usePaneWorkspace } from "../../views/ProjectPage/usePaneWorkspace";
import { normalizeTheme } from "../../shared/themes";
import type { DockSide } from "../../shared/useDockDrag";
import type { FileNode, LoadState } from "../../shared/types";
import type { EditorConfiguration } from "../../views/editor/TextEditor/editorConfiguration";
import { editorProfileForPath } from "../../views/editor/TextEditor/editorProfile";
import type { PaneConfigurationKey } from "../../views/ProjectPage/usePaneConfigurations";
import "../../styles/styles.css";
import "../../views/ProjectPage/ProjectPage.css";

/** Handles the specs drive the harness through. */
export interface WorkspaceHarnessWindow extends Window {
    /** Set once the layout has mounted. */
    moonstoneReady?: boolean;
    /** Records rename attempts, so truncation can be shown to be visual only. */
    moonstoneRenames?: readonly { readonly path: string; readonly newName: string }[];
}

/** A name long enough to need truncating in any sane panel width. */
const LONG_NAME = "an-extremely-long-chapter-filename-about-methodology.tex";

/** Settings the harness's editors share, before the file type is known. */
const SHARED_SETTINGS = {
    viewMode: "live",
    modalMode: "none",
    spellCheckEnabled: false,
    theme: "dark",
    lineNumberMode: "absolute",
    showDiagnostics: false,
    references: [],
} as const satisfies Omit<EditorConfiguration, "profile" | "isFrozen">;

/**
 * Configurations by path, built once each.
 *
 * The app's own `usePaneConfigurations` is not reused here because it
 * pulls in `createImageSourceResolver`, which needs Tauri; the harness
 * runs in a plain browser. What matters for these specs is the shape —
 * one stable object per open path — which this reproduces.
 */
const CONFIGURATIONS = new Map<string, EditorConfiguration>();

/**
 * The configuration a pane runs under.
 *
 * @param key - The pane's document and whether it is frozen.
 * @returns That pane's configuration; the same object every time.
 */
function configurationFor({ path, isFrozen }: PaneConfigurationKey): EditorConfiguration {
    const cacheKey = `${isFrozen ? "frozen" : "live"}:${path ?? ""}`;
    const cached = CONFIGURATIONS.get(cacheKey);
    if (cached) return cached;

    const built: EditorConfiguration = {
        ...SHARED_SETTINGS,
        profile: editorProfileForPath(path),
        isFrozen,
    };

    CONFIGURATIONS.set(cacheKey, built);
    return built;
}

/**
 * Stand-in contents for a dropped file.
 *
 * Two deliberate choices. It contains no LaTeX a scanner would render,
 * because what the specs assert is the text itself. And it names the
 * file by its *base name*, never its full path — so "the document
 * contains a path" can only mean CodeMirror pasted the dragged payload
 * in, which is the regression these specs exist to catch.
 *
 * @param path - The file dropped.
 * @returns Its contents.
 */
function contentsFor(path: string): string {
    const name = path.split(/[/\\]/).pop() ?? path;

    return `contents of ${name}\n`;
}

/**
 * The real pane tree over the real workspace, minus the backend.
 *
 * `usePaneWorkspace` takes documents as values rather than reading
 * them, so no Tauri mock is needed — which keeps the harness honest.
 *
 * @returns The editor area.
 */
function PaneArea() {
    const panes = usePaneWorkspace();
    const { activePaneId, showDocument } = panes;

    // One document open to begin with, so the starting state matches
    // the app's rather than an empty pane.
    useEffect(() => {
        showDocument(activePaneId, {
            kind: "text",
            path: "main.tex",
            initialDoc: contentsFor("main.tex"),
        });
        // Mount only: re-running would reload the document under the user.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <PaneTree
            node={panes.layout}
            documents={panes.documents}
            dirtyPanes={panes.dirtyPanes}
            activePaneId={panes.activePaneId}
            canClose={panes.hasSeveralPanes}
            configurationFor={configurationFor}
            onActivate={panes.activate}
            onDropFile={(paneId, side, path) => {
                const loaded = { kind: "text" as const, path, initialDoc: contentsFor(path) };

                if (side === null) panes.showDocument(paneId, loaded);
                else panes.splitWith(paneId, side, loaded);
            }}
            onClose={panes.close}
            onViewReady={panes.registerView}
            onViewDestroyed={panes.unregisterView}
            onDocChanged={panes.markDirty}
            onSaveRequested={() => undefined}
            onDiagnosticsToggled={() => undefined}
            onResizeSplit={panes.resize}
        />
    );
}

/**
 * Builds the fixture tree.
 *
 * @param useLongNames - Whether entries should have overflowing names.
 * @returns The project's root directory node.
 */
function buildTree(useLongNames: boolean): FileNode {
    const fileName = useLongNames ? LONG_NAME : "main.tex";

    return {
        kind: "directory",
        name: "project",
        path: "C:/projects/project",
        children: [
            { kind: "file", name: fileName, path: `C:/projects/project/${fileName}` },
            { kind: "file", name: "notes.tex", path: "C:/projects/project/notes.tex" },
            {
                kind: "directory",
                name: useLongNames ? "a-very-long-directory-name-for-chapters" : "chapters",
                path: "C:/projects/project/chapters",
                children: [
                    {
                        kind: "file",
                        name: "intro.tex",
                        path: "C:/projects/project/chapters/intro.tex",
                    },
                ],
            },
        ],
    };
}

/**
 * Reads a query parameter constrained to a set of values.
 *
 * @param name - Parameter name.
 * @param allowed - Accepted values.
 * @param fallback - Used when missing or invalid.
 * @returns The chosen value.
 */
function readEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    const raw = new URLSearchParams(window.location.search).get(name);

    return allowed.find((value) => value === raw) ?? fallback;
}

/**
 * Mounts the workspace described by the query string.
 *
 * @returns Nothing; the layout is attached to `#harness-root`.
 */
function mountHarness(): void {
    const root = document.querySelector<HTMLDivElement>("#harness-root");
    if (!root) throw new Error("Harness root element is missing");

    const params = new URLSearchParams(window.location.search);
    const side = readEnum<DockSide>("side", ["left", "right"], "left");
    const requestedWidth = Number.parseInt(params.get("width") ?? "", 10);
    const initialWidth = Number.isInteger(requestedWidth) ? requestedWidth : 220;
    const useLongNames = readEnum("names", ["long", "short"] as const, "long") === "long";
    const usePanes = readEnum("panes", ["on", "off"] as const, "off") === "on";

    // The app sets this on the document element; the harness has no
    // settings backend, so it applies the same attribute directly.
    // Validated through the registry so every theme is reachable here
    // as soon as it is registered.
    document.documentElement.setAttribute("data-theme", normalizeTheme(params.get("theme")));

    const tree: LoadState<FileNode> = { status: "ready", data: buildTree(useLongNames) };

    const harnessWindow = window as WorkspaceHarnessWindow;
    harnessWindow.moonstoneRenames = [];

    const noop = (): void => {};

    createRoot(root).render(
        <StrictMode>
            <div
                className={`project-page${side === "right" ? " project-page-dock-right" : ""}`}
            >
                <div className="project-workspace">
                    <ResizablePanel
                        initialWidth={initialWidth}
                        side={side}
                        label="the file browser"
                    >
                        <FileBrowser
                            tree={tree}
                            selectedPath={null}
                            onSelectFile={noop}
                            onFileOperation={noop}
                            onRename={(path, newName) => {
                                harnessWindow.moonstoneRenames = [
                                    ...(harnessWindow.moonstoneRenames ?? []),
                                    { path, newName },
                                ];
                                return Promise.resolve(null);
                            }}
                            dragHandleProps={{
                                onPointerDown: noop,
                                onPointerMove: noop,
                                onPointerUp: noop,
                                onPointerCancel: noop,
                            }}
                        />
                    </ResizablePanel>

                    <section className="project-editor-panel">
                        {usePanes ? (
                            <PaneArea />
                        ) : (
                            <div className="editor-placeholder">Editor pane</div>
                        )}
                    </section>
                </div>
            </div>
        </StrictMode>,
    );

    harnessWindow.moonstoneReady = true;
}

mountHarness();
