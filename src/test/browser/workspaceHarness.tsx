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
 * The editor pane is a placeholder rather than a real `TextEditor`:
 * what is under test is how the panes share width, and mounting
 * CodeMirror here would only add noise. It carries the real
 * `project-editor-panel` class so it flexes exactly as the editor does.
 *
 * | Param   | Values             | Default |
 * |---------|--------------------|---------|
 * | `side`  | `left` \| `right`  | `left` |
 * | `width` | initial panel width in px | 220 |
 * | `names` | `long` \| `short`  | `long` |
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ResizablePanel } from "../../components/ResizablePanel";
import { FileBrowser } from "../../views/ProjectPage/FileBrowser";
import type { DockSide } from "../../shared/useDockDrag";
import type { FileNode, LoadState } from "../../shared/types";
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

    const tree: LoadState<FileNode> = { status: "ready", data: buildTree(useLongNames) };

    const harnessWindow = window as WorkspaceHarnessWindow;
    harnessWindow.moonstoneRenames = [];

    const noop = (): void => {};

    createRoot(root).render(
        <StrictMode>
            <div className={`project-page${side === "right" ? " project-page-dock-right" : ""}`}>
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
                        <div className="editor-placeholder">Editor pane</div>
                    </section>
                </div>
            </div>
        </StrictMode>,
    );

    harnessWindow.moonstoneReady = true;
}

mountHarness();
