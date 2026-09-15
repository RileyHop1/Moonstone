/**
 * Tests for the editor area's state.
 *
 * `paneLayout.test.ts` covers the tree arithmetic; this covers what
 * hangs off it — documents, dirtiness, focus, and the bookkeeping when
 * files are renamed or deleted underneath open panes.
 */

import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePaneWorkspace } from "../views/ProjectPage/usePaneWorkspace";
import type { PaneWorkspace } from "../views/ProjectPage/usePaneWorkspace";
import { listPanes } from "../views/ProjectPage/paneLayout";

/** Mounts a workspace and returns a live handle on it. */
function mountWorkspace() {
    const { result } = renderHook(() => usePaneWorkspace());

    /** The workspace as it stands now. */
    const workspace = (): PaneWorkspace => result.current;

    /** Runs an operation and lets React settle. */
    const run = (operation: (current: PaneWorkspace) => void): void => {
        act(() => {
            operation(result.current);
        });
    };

    return { workspace, run };
}

/** The paths every pane shows, in reading order. */
function shownPaths(workspace: PaneWorkspace): readonly (string | null)[] {
    return listPanes(workspace.layout).map((pane) => pane.path);
}

describe("usePaneWorkspace", () => {
    it("starts as one empty pane", () => {
        const { workspace } = mountWorkspace();

        expect(listPanes(workspace().layout)).toHaveLength(1);
        expect(workspace().activeDocument).toBeNull();
        expect(workspace().hasSeveralPanes).toBe(false);
    });

    it("shows a file in a pane", () => {
        const { workspace, run } = mountWorkspace();

        run((w) => {
            w.showDocument(w.activePaneId, { path: "C:\\p\\main.tex", initialDoc: "hello" });
        });

        expect(workspace().activeDocument?.path).toBe("C:\\p\\main.tex");
        expect(shownPaths(workspace())).toEqual(["C:\\p\\main.tex"]);
    });

    it("splits into a second pane and focuses it", () => {
        const { workspace, run } = mountWorkspace();

        run((w) => {
            w.showDocument(w.activePaneId, { path: "one.tex", initialDoc: "" });
        });
        const first = workspace().activePaneId;
        run((w) => {
            w.splitWith(first, "right", { path: "two.tex", initialDoc: "" });
        });

        expect(shownPaths(workspace())).toEqual(["one.tex", "two.tex"]);
        expect(workspace().activePaneId).not.toBe(first);
        expect(workspace().activeDocument?.path).toBe("two.tex");
        expect(workspace().hasSeveralPanes).toBe(true);
    });

    it("lets two panes show the same file independently", () => {
        // Keyed by pane, not by path: each needs its own editor state.
        const { workspace, run } = mountWorkspace();

        run((w) => {
            w.showDocument(w.activePaneId, { path: "same.tex", initialDoc: "" });
        });
        run((w) => {
            w.splitWith(w.activePaneId, "right", { path: "same.tex", initialDoc: "" });
        });

        const versions = Array.from(workspace().documents.values(), (d) => d.version);
        expect(workspace().documents.size).toBe(2);
        expect(new Set(versions).size).toBe(2);
    });

    describe("dirtiness", () => {
        it("tracks it per pane", () => {
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.showDocument(w.activePaneId, { path: "one.tex", initialDoc: "" });
            });
            const first = workspace().activePaneId;
            run((w) => {
                w.splitWith(first, "right", { path: "two.tex", initialDoc: "" });
            });
            run((w) => {
                w.markDirty(first);
            });

            expect(workspace().dirtyPanes.has(first)).toBe(true);
            // The focused pane is the *second* one, which is clean.
            expect(workspace().isActiveDirty).toBe(false);
            expect(workspace().hasUnsavedChanges).toBe(true);
        });

        it("clears on save", () => {
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.markDirty(w.activePaneId);
            });
            run((w) => {
                w.markClean(w.activePaneId);
            });

            expect(workspace().hasUnsavedChanges).toBe(false);
        });

        it("clears when a pane loads a different file", () => {
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.markDirty(w.activePaneId);
            });
            run((w) => {
                w.showDocument(w.activePaneId, { path: "fresh.tex", initialDoc: "" });
            });

            expect(workspace().isActiveDirty).toBe(false);
        });
    });

    describe("closing", () => {
        it("removes the pane and its document", () => {
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.showDocument(w.activePaneId, { path: "one.tex", initialDoc: "" });
            });
            run((w) => {
                w.splitWith(w.activePaneId, "right", { path: "two.tex", initialDoc: "" });
            });
            const second = workspace().activePaneId;
            run((w) => {
                w.close(second);
            });

            expect(shownPaths(workspace())).toEqual(["one.tex"]);
            expect(workspace().documents.has(second)).toBe(false);
        });

        it("moves focus off the closed pane", () => {
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.showDocument(w.activePaneId, { path: "one.tex", initialDoc: "" });
            });
            run((w) => {
                w.splitWith(w.activePaneId, "right", { path: "two.tex", initialDoc: "" });
            });
            const closed = workspace().activePaneId;
            run((w) => {
                w.close(closed);
            });

            expect(workspace().activePaneId).not.toBe(closed);
            expect(workspace().activeDocument?.path).toBe("one.tex");
        });

        it("refuses to close the only pane, leaving focus alone", () => {
            // The pane is still on screen, so moving focus off it would
            // leave the toolbar acting on nothing.
            const { workspace, run } = mountWorkspace();
            const only = workspace().activePaneId;

            run((w) => {
                w.close(only);
            });

            expect(listPanes(workspace().layout)).toHaveLength(1);
            expect(workspace().activePaneId).toBe(only);
        });
    });

    describe("when a file is renamed underneath a pane", () => {
        it("follows the new path", () => {
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.showDocument(w.activePaneId, { path: "C:\\p\\old.tex", initialDoc: "body" });
            });
            run((w) => {
                w.repointPaths("C:\\p\\old.tex", "C:\\p\\new.tex");
            });

            expect(workspace().activeDocument?.path).toBe("C:\\p\\new.tex");
            expect(shownPaths(workspace())).toEqual(["C:\\p\\new.tex"]);
        });

        it("follows a renamed ancestor directory", () => {
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.showDocument(w.activePaneId, {
                    path: "C:\\p\\old\\main.tex",
                    initialDoc: "",
                });
            });
            run((w) => {
                w.repointPaths("C:\\p\\old", "C:\\p\\new");
            });

            expect(workspace().activeDocument?.path).toBe("C:\\p\\new\\main.tex");
        });

        it("does not remount the editor", () => {
            // The version keys the editor. Bumping it here would throw
            // away the undo history of a file being actively edited.
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.showDocument(w.activePaneId, { path: "C:\\p\\old.tex", initialDoc: "" });
            });
            const before = workspace().activeDocument?.version;

            run((w) => {
                w.repointPaths("C:\\p\\old.tex", "C:\\p\\new.tex");
            });

            expect(workspace().activeDocument?.version).toBe(before);
        });

        it("leaves an unaffected pane alone", () => {
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.showDocument(w.activePaneId, { path: "C:\\p\\other.tex", initialDoc: "" });
            });
            run((w) => {
                w.repointPaths("C:\\p\\old.tex", "C:\\p\\new.tex");
            });

            expect(workspace().activeDocument?.path).toBe("C:\\p\\other.tex");
        });
    });

    describe("when a file is deleted underneath a pane", () => {
        it("empties the pane without closing it", () => {
            // The pane stays so there is somewhere to open the next file.
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.showDocument(w.activePaneId, { path: "C:\\p\\gone.tex", initialDoc: "" });
            });
            run((w) => {
                w.forgetDeleted("C:\\p\\gone.tex");
            });

            expect(workspace().activeDocument).toBeNull();
            expect(listPanes(workspace().layout)).toHaveLength(1);
            expect(shownPaths(workspace())).toEqual([null]);
        });

        it("empties panes showing anything inside a deleted directory", () => {
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.showDocument(w.activePaneId, {
                    path: "C:\\p\\chapters\\intro.tex",
                    initialDoc: "",
                });
            });
            run((w) => {
                w.forgetDeleted("C:\\p\\chapters");
            });

            expect(workspace().activeDocument).toBeNull();
        });

        it("leaves a prefix-sharing sibling alone", () => {
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.showDocument(w.activePaneId, {
                    path: "C:\\p\\chapters-old\\intro.tex",
                    initialDoc: "",
                });
            });
            run((w) => {
                w.forgetDeleted("C:\\p\\chapters");
            });

            expect(workspace().activeDocument?.path).toBe("C:\\p\\chapters-old\\intro.tex");
        });
    });

    describe("resizing", () => {
        it("applies new shares to a split", () => {
            const { workspace, run } = mountWorkspace();

            run((w) => {
                w.splitWith(w.activePaneId, "right", { path: "two.tex", initialDoc: "" });
            });

            const root = workspace().layout;
            if (root.kind !== "split") throw new Error("Expected a split");

            run((w) => {
                w.resize(root.id, 0, 0.7, 0.3);
            });

            const resized = workspace().layout;
            if (resized.kind !== "split") throw new Error("Expected a split");
            expect(resized.sizes).toEqual([0.7, 0.3]);
        });

        it("ignores an unknown split", () => {
            const { workspace, run } = mountWorkspace();
            const before = workspace().layout;

            run((w) => {
                w.resize("nope", 0, 0.7, 0.3);
            });

            expect(workspace().layout).toBe(before);
        });
    });

    it("reports which files are on screen", () => {
        const { workspace, run } = mountWorkspace();

        run((w) => {
            w.showDocument(w.activePaneId, { path: "one.tex", initialDoc: "" });
        });

        expect(workspace().isShowing("one.tex")).toBe(true);
        expect(workspace().isShowing("two.tex")).toBe(false);
    });
});
