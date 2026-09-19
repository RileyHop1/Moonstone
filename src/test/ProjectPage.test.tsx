/**
 * Test suite for the project page: file tree rendering, expand and
 * collapse, auto-open, file management (create/rename/delete),
 * toolbar state, and exiting.
 *
 * The real TextEditor is mocked out — CodeMirror needs DOM measurement
 * APIs jsdom does not provide, and the page's logic is independent of
 * the editor internals.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectPage } from "../views/ProjectPage";
import type { FileNode, ProjectInfo } from "../shared/types";
import { invokeMock, mockCommands, resetInvokeMock } from "./mockTauri";
import { renderWithProviders } from "./testUtils";
import { fireDragEvent, makeDataTransfer } from "./dataTransfer";

vi.mock("@tauri-apps/api/core", async () => {
    const { invokeMock: mock } = await import("./mockTauri");
    return {
        invoke: mock,
        isTauri: () => true,
        convertFileSrc: (path: string) => `asset://${path}`,
    };
});

vi.mock("../views/editor/TextEditor", async () => {
    const { createElement } = await import("react");
    return {
        TextEditor: ({ onDocChanged }: { readonly onDocChanged: () => void }) =>
            createElement("div", {
                "data-testid": "mock-editor",
                onClick: onDocChanged,
            }),
    };
});

// pdf.js needs canvas and a worker, neither of which jsdom has. The real
// viewer is covered by `pdfViewer.browser.spec.ts`; here only the URL it
// is handed matters, since that is what carries the reload.
vi.mock("../views/ProjectPage/PdfViewer", async () => {
    const { createElement } = await import("react");
    return {
        PdfViewer: ({ source }: { source: string }) =>
            createElement("div", { "data-testid": "pdf-viewer", "data-source": source }),
    };
});

/** The project under test. */
const PROJECT: ProjectInfo = {
    name: "demo",
    path: "C:/root/demo",
    lastModified: "2026-07-01T12:00:00+00:00",
    fileCount: 2,
};

/** Tree fixture: a nested directory plus a root-level file. */
const TREE: FileNode = {
    kind: "directory",
    name: "demo",
    path: "C:/root/demo",
    children: [
        {
            kind: "directory",
            name: "chapters",
            path: "C:/root/demo/chapters",
            children: [
                { kind: "file", name: "intro.tex", path: "C:/root/demo/chapters/intro.tex" },
            ],
        },
        { kind: "file", name: "demo.tex", path: "C:/root/demo/demo.tex" },
    ],
};

/** Tree fixture with no files at all (auto-open finds nothing). */
const EMPTY_TREE: FileNode = {
    kind: "directory",
    name: "demo",
    path: "C:/root/demo",
    children: [],
};

/**
 * A row in the file tree, by name.
 *
 * Scoped to the tree because the editor pane's header shows the open
 * file's name as well, so a bare `getByText` matches two elements.
 *
 * @param name - The entry's name.
 * @returns The row's label element.
 */
function fileRow(name: string): HTMLElement {
    return screen.getByText(name, { selector: ".file-tree-name" });
}

/**
 * Waits for a row to appear in the file tree.
 *
 * @param name - The entry's name.
 * @returns The row's label element.
 */
function findFileRow(name: string): Promise<HTMLElement> {
    return screen.findByText(name, { selector: ".file-tree-name" });
}

/**
 * Drops a file from the tree onto one edge of a pane.
 *
 * jsdom has no layout, so the pane is given a rectangle first: without
 * one every point is the centre, and a centre drop opens the file in
 * place instead of splitting.
 *
 * @param pane - The pane element to drop on.
 * @param name - The file's name in the tree.
 */
function dropOnPaneEdge(pane: Element, name: string): void {
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
    });

    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(fileRow(name), { dataTransfer });

    // 10px from the left edge, well inside the edge zone. Fired through
    // `fireDragEvent` because Testing Library's own drag helpers cannot
    // carry coordinates in jsdom — see its doc comment.
    fireDragEvent(pane, "dragenter", { dataTransfer, clientX: 10, clientY: 300 });
    fireDragEvent(pane, "dragover", { dataTransfer, clientX: 10, clientY: 300 });
    fireDragEvent(pane, "drop", { dataTransfer, clientX: 10, clientY: 300 });
}

describe("ProjectPage", () => {
    beforeEach(() => {
        resetInvokeMock();
        mockCommands({
            list_project_files: () => TREE,
            read_file: () => "\\documentclass{article}",
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders the project's file tree from the backend", async () => {
        renderWithProviders(<ProjectPage project={PROJECT} />);

        expect(await findFileRow("demo.tex")).toBeInTheDocument();
        expect(fileRow("chapters")).toBeInTheDocument();
        // Collapsed directories keep their children hidden.
        expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();
    });

    it("expands and collapses directories on click", async () => {
        renderWithProviders(<ProjectPage project={PROJECT} />);

        fireEvent.click(await findFileRow("chapters"));
        expect(fileRow("intro.tex")).toBeInTheDocument();

        fireEvent.click(fileRow("chapters"));
        expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();
    });

    it("auto-opens the project's main file", async () => {
        renderWithProviders(<ProjectPage project={PROJECT} />);

        expect(await screen.findByTestId("mock-editor")).toBeInTheDocument();
        expect(invokeMock).toHaveBeenCalledWith("read_file", {
            filePath: "C:/root/demo/demo.tex",
        });
    });

    it("opens a nested file on click", async () => {
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByTestId("mock-editor");

        fireEvent.click(fileRow("chapters"));
        fireEvent.click(fileRow("intro.tex"));

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("read_file", {
                filePath: "C:/root/demo/chapters/intro.tex",
            });
        });
    });

    it("shows a placeholder when the project has no files", async () => {
        mockCommands({ list_project_files: () => EMPTY_TREE });

        renderWithProviders(<ProjectPage project={PROJECT} />);

        expect(await screen.findByText("Select a file to start editing.")).toBeInTheDocument();
    });

    it("shows the file tree error state when listing fails", async () => {
        mockCommands({ list_project_files: () => Promise.reject("tree unavailable") });

        renderWithProviders(<ProjectPage project={PROJECT} />);

        expect(await screen.findByText("tree unavailable")).toBeInTheDocument();
    });

    it("disables Save until the open file is dirty", async () => {
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByTestId("mock-editor");

        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("creates a file from the header button", async () => {
        mockCommands({
            list_project_files: () => EMPTY_TREE,
            create_file: () => "C:/root/demo/notes.tex",
        });
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByText("This project is empty.");

        fireEvent.click(screen.getByTitle("New file"));
        fireEvent.change(screen.getByPlaceholderText("File name"), {
            target: { value: "notes" },
        });
        fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("create_file", {
                parentDirectory: "C:/root/demo",
                fileName: "notes",
                fileExtension: "tex",
            });
        });
    });

    it("creates a file with the chosen extension", async () => {
        mockCommands({
            list_project_files: () => EMPTY_TREE,
            create_file: () => "C:/root/demo/refs.bib",
        });
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByText("This project is empty.");

        fireEvent.click(screen.getByTitle("New file"));
        fireEvent.change(screen.getByPlaceholderText("File name"), {
            target: { value: "refs" },
        });
        fireEvent.change(screen.getByLabelText("File type"), {
            target: { value: "bib" },
        });
        fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("create_file", {
                parentDirectory: "C:/root/demo",
                fileName: "refs",
                fileExtension: "bib",
            });
        });
    });

    it("previews the filename that will be created", async () => {
        mockCommands({ list_project_files: () => EMPTY_TREE });
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByText("This project is empty.");

        fireEvent.click(screen.getByTitle("New file"));
        fireEvent.change(screen.getByPlaceholderText("File name"), {
            target: { value: "notes" },
        });

        expect(screen.getByText("notes.tex")).toBeInTheDocument();
    });

    it("offers no file type when creating a folder", async () => {
        mockCommands({ list_project_files: () => EMPTY_TREE });
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByText("This project is empty.");

        fireEvent.click(screen.getByTitle("New folder"));

        expect(screen.queryByLabelText("File type")).not.toBeInTheDocument();
    });

    it("rejects an invalid file name before calling the backend", async () => {
        mockCommands({ list_project_files: () => EMPTY_TREE });
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByText("This project is empty.");

        fireEvent.click(screen.getByTitle("New file"));
        fireEvent.change(screen.getByPlaceholderText("File name"), {
            target: { value: "CON" },
        });
        fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);

        await screen.findByText(/reserved name on Windows/);
        expect(invokeMock).not.toHaveBeenCalledWith("create_file", expect.anything());
    });

    it("renames a file inline via the context menu", async () => {
        mockCommands({
            list_project_files: () => TREE,
            read_file: () => "",
            rename_entry: () => "C:/root/demo/renamed.tex",
        });
        renderWithProviders(<ProjectPage project={PROJECT} />);

        fireEvent.contextMenu(await findFileRow("demo.tex"));
        fireEvent.click(screen.getByText("Rename"));

        const input = screen.getByDisplayValue("demo.tex");
        fireEvent.change(input, { target: { value: "renamed" } });
        fireEvent.keyDown(input, { key: "Enter" });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("rename_entry", {
                path: "C:/root/demo/demo.tex",
                newName: "renamed",
            });
        });
    });

    it("loads the project's bibliography when it opens", async () => {
        mockCommands({ list_project_files: () => TREE, read_file: () => "" });
        renderWithProviders(<ProjectPage project={PROJECT} />);

        await waitFor(() =>
            expect(invokeMock).toHaveBeenCalledWith("list_references", {
                projectPath: "C:/root/demo",
            }),
        );
    });

    it("still opens the project when the bibliography cannot be read", async () => {
        // Completion simply offers nothing; a bad .bib must not stop
        // the author from editing.
        mockCommands({
            list_project_files: () => TREE,
            read_file: () => "",
            list_references: () => Promise.reject("unreadable"),
        });
        renderWithProviders(<ProjectPage project={PROJECT} />);

        expect(await findFileRow("demo.tex")).toBeInTheDocument();
    });

    it("rejects an invalid inline rename before calling the backend", async () => {
        mockCommands({ list_project_files: () => TREE, read_file: () => "" });
        renderWithProviders(<ProjectPage project={PROJECT} />);

        fireEvent.contextMenu(await findFileRow("demo.tex"));
        fireEvent.click(screen.getByText("Rename"));

        const input = screen.getByDisplayValue("demo.tex");
        fireEvent.change(input, { target: { value: "a/b.tex" } });
        fireEvent.keyDown(input, { key: "Enter" });

        await waitFor(() => {
            expect(screen.getByDisplayValue("a/b.tex")).toHaveAttribute(
                "title",
                expect.stringContaining("can't contain"),
            );
        });
        expect(invokeMock).not.toHaveBeenCalledWith("rename_entry", expect.anything());
    });

    it("moves a file onto a folder via drag-and-drop", async () => {
        mockCommands({
            list_project_files: () => TREE,
            read_file: () => "",
            move_entry: () => "C:/root/demo/chapters/demo.tex",
        });
        renderWithProviders(<ProjectPage project={PROJECT} />);

        // A stub that actually stores what the drag source writes: the
        // browser marks its drags with a private MIME type, and the drop
        // target reads it back to decide whether the drag is one of ours.
        const dataTransfer = makeDataTransfer();

        fireEvent.dragStart(await findFileRow("demo.tex"), { dataTransfer });
        fireEvent.dragOver(fileRow("chapters"), { dataTransfer });
        fireEvent.drop(fileRow("chapters"), { dataTransfer });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("move_entry", {
                sourcePath: "C:/root/demo/demo.tex",
                destinationDir: "C:/root/demo/chapters",
            });
        });
    });

    it("expands and collapses all folders", async () => {
        mockCommands({ list_project_files: () => TREE, read_file: () => "" });
        renderWithProviders(<ProjectPage project={PROJECT} />);

        // Nested file hidden while its folder is collapsed.
        await findFileRow("chapters");
        expect(screen.queryByText("intro.tex")).toBeNull();

        fireEvent.click(screen.getByTitle("Expand all folders"));
        expect(fileRow("intro.tex")).toBeInTheDocument();

        fireEvent.click(screen.getByTitle("Collapse all folders"));
        expect(screen.queryByText("intro.tex")).toBeNull();
    });

    it("deletes a file via the context menu after confirmation", async () => {
        mockCommands({
            list_project_files: () => TREE,
            read_file: () => "",
            delete_entry: () => null,
        });
        renderWithProviders(<ProjectPage project={PROJECT} />);

        fireEvent.contextMenu(await findFileRow("demo.tex"));
        fireEvent.click(screen.getByText("Delete"));
        fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("delete_entry", {
                path: "C:/root/demo/demo.tex",
            });
        });
    });

    it("closes the editor when the open file is deleted", async () => {
        mockCommands({
            list_project_files: () => TREE,
            read_file: () => "",
            delete_entry: () => null,
        });
        renderWithProviders(<ProjectPage project={PROJECT} />);
        // demo.tex auto-opens.
        await screen.findByTestId("mock-editor");

        fireEvent.contextMenu(fileRow("demo.tex"));
        fireEvent.click(screen.getByText("Delete"));
        fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

        await waitFor(() => {
            expect(screen.queryByTestId("mock-editor")).not.toBeInTheDocument();
        });
    });

    it("re-reads a file when it is opened again", async () => {
        // Deliberately not a no-op: re-clicking the open file is the
        // only way to discard unsaved changes and reload from disk.
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByTestId("mock-editor");

        const readsBefore = invokeMock.mock.calls.filter(
            (call) => call[0] === "read_file",
        ).length;

        fireEvent.click(fileRow("demo.tex"));

        await waitFor(() => {
            const readsAfter = invokeMock.mock.calls.filter(
                (call) => call[0] === "read_file",
            ).length;
            expect(readsAfter).toBe(readsBefore + 1);
        });
    });

    it("shows the file asked for last when two opens race", async () => {
        // The slow read resolves second; without a request token its
        // answer would overwrite the file the user actually clicked.
        const pending = new Map<string, (contents: string) => void>();

        mockCommands({
            list_project_files: () => TREE,
            read_file: (args) => {
                const filePath = (args as { filePath: string }).filePath;
                if (!filePath.endsWith("intro.tex")) return "root contents";

                return new Promise<string>((resolve) => {
                    pending.set(filePath, resolve);
                });
            },
        });

        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByTestId("mock-editor");

        // Ask for the slow file, then immediately for a fast one.
        fireEvent.click(fileRow("chapters"));
        fireEvent.click(fileRow("intro.tex"));
        fireEvent.click(fileRow("demo.tex"));

        await waitFor(() => {
            expect(screen.getByTitle("C:/root/demo/demo.tex")).toBeInTheDocument();
        });

        // Now let the earlier, slower read finish, and let its
        // continuation actually run. Asserting through `waitFor` alone
        // would pass on the first check, before the late answer had any
        // chance to overwrite anything — which is no test at all.
        const resolveIntro = pending.get("C:/root/demo/chapters/intro.tex");
        expect(resolveIntro).toBeDefined();

        await act(async () => {
            resolveIntro?.("intro contents");
            await Promise.resolve();
        });

        // The file the user asked for last is still the one on screen.
        expect(screen.getByTitle("C:/root/demo/demo.tex")).toBeInTheDocument();
        expect(screen.queryByTitle("C:/root/demo/chapters/intro.tex")).toBeNull();
    });

    it("splits into a second pane when a file is dropped on a pane edge", async () => {
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByTestId("mock-editor");
        expect(document.querySelectorAll(".editor-pane")).toHaveLength(1);

        const pane = document.querySelector(".editor-pane");
        if (!pane) throw new Error("The pane did not render");

        dropOnPaneEdge(pane, "demo.tex");

        await waitFor(() => {
            expect(document.querySelectorAll(".editor-pane")).toHaveLength(2);
        });
    });

    it("closes a pane on request", async () => {
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByTestId("mock-editor");

        const pane = document.querySelector(".editor-pane");
        if (!pane) throw new Error("The pane did not render");

        dropOnPaneEdge(pane, "demo.tex");

        await waitFor(() => {
            expect(document.querySelectorAll(".editor-pane")).toHaveLength(2);
        });

        const closeButtons = document.querySelectorAll<HTMLElement>(".editor-pane-close");
        closeButtons[1]?.click();

        await waitFor(() => {
            expect(document.querySelectorAll(".editor-pane")).toHaveLength(1);
        });
    });

    it("keeps a dirty pane open when discarding its changes is cancelled", async () => {
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByTestId("mock-editor");

        const pane = document.querySelector(".editor-pane");
        if (!pane) throw new Error("The pane did not render");

        dropOnPaneEdge(pane, "demo.tex");

        await waitFor(() => {
            expect(document.querySelectorAll(".editor-pane")).toHaveLength(2);
        });

        fireEvent.click(screen.getAllByTestId("mock-editor")[1]!);
        fireEvent.click(document.querySelectorAll<HTMLElement>(".editor-pane-close")[1]!);

        expect(await screen.findByText("This pane has unsaved changes. Closing it discards them."))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(document.querySelectorAll(".editor-pane")).toHaveLength(2);
    });

    it("closes a dirty pane after discarding its changes is confirmed", async () => {
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByTestId("mock-editor");

        const pane = document.querySelector(".editor-pane");
        if (!pane) throw new Error("The pane did not render");

        dropOnPaneEdge(pane, "demo.tex");

        await waitFor(() => {
            expect(document.querySelectorAll(".editor-pane")).toHaveLength(2);
        });

        fireEvent.click(screen.getAllByTestId("mock-editor")[1]!);
        fireEvent.click(document.querySelectorAll<HTMLElement>(".editor-pane-close")[1]!);
        fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

        await waitFor(() => {
            expect(document.querySelectorAll(".editor-pane")).toHaveLength(1);
        });
    });

    it("exits to the project browser", async () => {
        const { navigateCalls } = renderWithProviders(<ProjectPage project={PROJECT} />);

        fireEvent.click(await screen.findByRole("button", { name: "Exit" }));

        await waitFor(() => expect(navigateCalls).toEqual([{ kind: "browser" }]));
    });
});

describe("ProjectPage against a malformed backend", () => {
    beforeEach(() => {
        resetInvokeMock();
    });

    it("shows an error instead of crashing on a malformed file tree", async () => {
        // A directory with no `children` array used to arrive typed as a
        // FileNode and throw inside the render (finding C-1).
        mockCommands({
            list_project_files: () => ({
                kind: "directory",
                name: "demo",
                path: "C:/root/demo",
            }),
        });

        renderWithProviders(<ProjectPage project={PROJECT} />);

        expect(
            await screen.findByText(/could not understand the response/i),
        ).toBeInTheDocument();
    });
});

describe("ProjectPage auto-open", () => {
    beforeEach(() => {
        resetInvokeMock();
    });

    it("opens a file from a subdirectory when the root has none", async () => {
        // The bundled book and thesis templates both put chapters in a
        // subdirectory. A project restructured that way used to open to
        // an empty editor, because the search never recursed (F-5).
        mockCommands({
            list_project_files: () => ({
                kind: "directory",
                name: "demo",
                path: "C:/root/demo",
                children: [
                    {
                        kind: "directory",
                        name: "chapters",
                        path: "C:/root/demo/chapters",
                        children: [
                            {
                                kind: "file",
                                name: "intro.tex",
                                path: "C:/root/demo/chapters/intro.tex",
                            },
                        ],
                    },
                ],
            }),
            read_file: () => "",
        });

        renderWithProviders(<ProjectPage project={PROJECT} />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("read_file", {
                filePath: "C:/root/demo/chapters/intro.tex",
            });
        });
    });

    it("prefers a root-level file named after the project", async () => {
        mockCommands({ list_project_files: () => TREE, read_file: () => "" });

        renderWithProviders(<ProjectPage project={PROJECT} />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("read_file", {
                filePath: "C:/root/demo/demo.tex",
            });
        });
    });
});

describe("ProjectPage PDFs", () => {
    /** The tree with a compiled PDF beside the source. */
    const PDF_TREE: FileNode = {
        kind: "directory",
        name: "demo",
        path: "C:/root/demo",
        children: [
            { kind: "file", name: "demo.tex", path: "C:/root/demo/demo.tex" },
            { kind: "file", name: "demo.pdf", path: "C:/root/demo/demo.pdf" },
        ],
    };

    /** A clean compile of `demo.tex`. */
    const COMPILED = { pdfPath: "C:/root/demo/demo.pdf", logPath: null, diagnostics: [] };

    /**
     * Routes the commands a compile needs.
     *
     * @param openPdfAfterCompile - The stored setting.
     */
    function mockProject(openPdfAfterCompile: boolean): void {
        mockCommands({
            get_settings: () => ({ theme: "dark", openPdfAfterCompile }),
            list_project_files: () => PDF_TREE,
            read_file: () => "",
            compile_project: () => COMPILED,
            export_pdf: () => ({ exportedTo: "D:/out/demo.pdf" }),
        });
    }

    /**
     * Renders the page and waits for the main file to open.
     *
     * @returns Nothing; the page is on screen once this resolves.
     */
    async function renderWithMainFile(): Promise<void> {
        renderWithProviders(<ProjectPage project={PROJECT} />);
        await screen.findByTestId("mock-editor");
    }

    beforeEach(() => {
        resetInvokeMock();
    });

    it("opens a PDF in a viewer without trying to read it as text", async () => {
        mockProject(true);
        await renderWithMainFile();

        fireEvent.click(fileRow("demo.pdf"));

        const viewer = await screen.findByTestId("pdf-viewer");
        expect(viewer.getAttribute("data-source")).toMatch(
            /^asset:\/\/C:\/root\/demo\/demo\.pdf\?v=\d+$/,
        );
        // `read_file` refuses non-text files; asking it is the old bug.
        expect(invokeMock).not.toHaveBeenCalledWith("read_file", {
            filePath: "C:/root/demo/demo.pdf",
        });
    });

    it("offers export but not editing while a PDF pane is active", async () => {
        mockProject(true);
        await renderWithMainFile();

        fireEvent.click(fileRow("demo.pdf"));
        await screen.findByTestId("pdf-viewer");

        expect(screen.getByRole("button", { name: "Export PDF…" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Compile" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    });

    it("opens the compiled PDF beside the source and keeps focus on the source", async () => {
        mockProject(true);
        await renderWithMainFile();

        fireEvent.click(screen.getByRole("button", { name: "Compile" }));

        await screen.findByTestId("pdf-viewer");
        expect(document.querySelectorAll(".editor-pane")).toHaveLength(2);
        const active = document.querySelector(".editor-pane-active");
        expect(active?.querySelector("[data-testid='mock-editor']")).not.toBeNull();
    });

    it("reloads the open preview on a second compile instead of splitting again", async () => {
        mockProject(true);
        await renderWithMainFile();

        fireEvent.click(screen.getByRole("button", { name: "Compile" }));
        const firstSource = (await screen.findByTestId("pdf-viewer")).getAttribute("src");

        fireEvent.click(await screen.findByRole("button", { name: "Compile" }));

        await waitFor(() => {
            expect(screen.getByTestId("pdf-viewer").getAttribute("data-source")).not.toBe(
                firstSource,
            );
        });
        expect(document.querySelectorAll(".editor-pane")).toHaveLength(2);
    });

    it("leaves the layout alone when the preview setting is off", async () => {
        mockProject(false);
        await renderWithMainFile();

        fireEvent.click(screen.getByRole("button", { name: "Compile" }));

        expect(await screen.findByText("Compiled ✓")).toBeInTheDocument();
        expect(screen.queryByTestId("pdf-viewer")).not.toBeInTheDocument();
        expect(document.querySelectorAll(".editor-pane")).toHaveLength(1);
    });

    it("exports the PDF the open document compiles to", async () => {
        mockProject(true);
        await renderWithMainFile();

        fireEvent.click(screen.getByRole("button", { name: "Export PDF…" }));

        expect(await screen.findByText("Exported to D:/out/demo.pdf")).toBeInTheDocument();
        expect(invokeMock).toHaveBeenCalledWith("export_pdf", {
            pdfPath: "C:/root/demo/demo.pdf",
        });
    });

    it("says nothing when the export dialog is cancelled", async () => {
        mockCommands({
            get_settings: () => ({ theme: "dark" }),
            list_project_files: () => PDF_TREE,
            read_file: () => "",
            export_pdf: () => ({ exportedTo: null }),
        });
        await renderWithMainFile();

        fireEvent.click(screen.getByRole("button", { name: "Export PDF…" }));

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("export_pdf", expect.anything());
        });
        expect(screen.queryByText(/Export/, { selector: ".toolbar-status" })).toBeNull();
    });
});
