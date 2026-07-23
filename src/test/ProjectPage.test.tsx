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
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectPage } from "../views/ProjectPage";
import type { FileNode, ProjectInfo } from "../shared/types";
import { invokeMock, mockCommands, resetInvokeMock } from "./mockTauri";
import { renderWithProviders } from "./testUtils";

vi.mock("@tauri-apps/api/core", async () => {
    const { invokeMock: mock } = await import("./mockTauri");
    return { invoke: mock, isTauri: () => true };
});

vi.mock("../views/editor/TextEditor", async () => {
    const { createElement } = await import("react");
    return {
        TextEditor: () => createElement("div", { "data-testid": "mock-editor" }),
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

        expect(await screen.findByText("demo.tex")).toBeInTheDocument();
        expect(screen.getByText("chapters")).toBeInTheDocument();
        // Collapsed directories keep their children hidden.
        expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();
    });

    it("expands and collapses directories on click", async () => {
        renderWithProviders(<ProjectPage project={PROJECT} />);

        fireEvent.click(await screen.findByText("chapters"));
        expect(screen.getByText("intro.tex")).toBeInTheDocument();

        fireEvent.click(screen.getByText("chapters"));
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

        fireEvent.click(screen.getByText("chapters"));
        fireEvent.click(screen.getByText("intro.tex"));

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

    it("renames a file via the context menu", async () => {
        mockCommands({
            list_project_files: () => TREE,
            read_file: () => "",
            rename_entry: () => "C:/root/demo/renamed.tex",
        });
        renderWithProviders(<ProjectPage project={PROJECT} />);

        fireEvent.contextMenu(await screen.findByText("demo.tex"));
        fireEvent.click(screen.getByText("Rename"));
        fireEvent.change(screen.getByPlaceholderText("File name"), {
            target: { value: "renamed" },
        });
        fireEvent.submit(screen.getByRole("button", { name: "Rename" }).closest("form")!);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("rename_entry", {
                path: "C:/root/demo/demo.tex",
                newName: "renamed",
            });
        });
    });

    it("deletes a file via the context menu after confirmation", async () => {
        vi.spyOn(window, "confirm").mockReturnValue(true);
        mockCommands({
            list_project_files: () => TREE,
            read_file: () => "",
            delete_entry: () => null,
        });
        renderWithProviders(<ProjectPage project={PROJECT} />);

        fireEvent.contextMenu(await screen.findByText("demo.tex"));
        fireEvent.click(screen.getByText("Delete"));

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("delete_entry", {
                path: "C:/root/demo/demo.tex",
            });
        });
    });

    it("closes the editor when the open file is deleted", async () => {
        vi.spyOn(window, "confirm").mockReturnValue(true);
        mockCommands({
            list_project_files: () => TREE,
            read_file: () => "",
            delete_entry: () => null,
        });
        renderWithProviders(<ProjectPage project={PROJECT} />);
        // demo.tex auto-opens.
        await screen.findByTestId("mock-editor");

        fireEvent.contextMenu(screen.getByText("demo.tex"));
        fireEvent.click(screen.getByText("Delete"));

        await waitFor(() => {
            expect(screen.queryByTestId("mock-editor")).not.toBeInTheDocument();
        });
    });

    it("exits to the project browser", async () => {
        const { navigateCalls } = renderWithProviders(<ProjectPage project={PROJECT} />);

        fireEvent.click(await screen.findByRole("button", { name: "Exit" }));

        await waitFor(() => expect(navigateCalls).toEqual([{ kind: "browser" }]));
    });
});
