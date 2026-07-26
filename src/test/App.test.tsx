/**
 * Test suite for the app shell's page switching, and the one thing it
 * must not do: throw away the work when settings is opened.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { App } from "../App";
import type { FileNode, ProjectInfo } from "../shared/types";
import { mockCommands, resetInvokeMock } from "./mockTauri";

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

/** The one project the browser lists. */
const PROJECT: ProjectInfo = {
    name: "thesis",
    path: "C:/root/thesis",
    lastModified: "2026-07-01T12:00:00+00:00",
    fileCount: 1,
};

/** That project's file tree. */
const TREE: FileNode = {
    kind: "directory",
    name: "thesis",
    path: "C:/root/thesis",
    children: [{ kind: "file", name: "thesis.tex", path: "C:/root/thesis/thesis.tex" }],
};

/**
 * Opens a menu on the hot bar and clicks one of its items.
 *
 * @param menu - The menu's name.
 * @param item - The item's label.
 */
function selectMenuItem(menu: string, item: string): void {
    fireEvent.click(screen.getByText(menu));
    fireEvent.click(findMenuItem(item));
}

/**
 * Finds an open menu's item by label.
 *
 * Some labels also appear on the project toolbar, so this picks the
 * list item rather than whichever matched first.
 *
 * @param label - The item's label.
 * @returns The menu item element.
 */
function findMenuItem(label: string): HTMLElement {
    const item = screen
        .getAllByText(label)
        .find((element) => element.tagName === "LI");

    expect(item, `menu item ${label}`).toBeDefined();
    return item!;
}

describe("App", () => {
    beforeEach(() => {
        resetInvokeMock();
        mockCommands({
            list_projects: () => [PROJECT],
            list_project_files: () => TREE,
            read_file: () => "\\documentclass{article}",
            list_references: () => [],
        });
    });

    it("opens a project from the browser", async () => {
        render(<App />);

        fireEvent.doubleClick(await screen.findByText("thesis"));

        expect(await screen.findByTestId("mock-editor")).toBeInTheDocument();
    });

    describe("opening settings", () => {
        it("keeps the project page mounted underneath", async () => {
            // Unmounting it would discard the open document, its
            // unsaved edits and its undo history, then silently reload
            // from disk on the way back.
            render(<App />);
            fireEvent.doubleClick(await screen.findByText("thesis"));
            await screen.findByTestId("mock-editor");

            selectMenuItem("Settings", "Open Settings");

            expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
            expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
        });

        it("hides the page it covers", async () => {
            render(<App />);
            fireEvent.doubleClick(await screen.findByText("thesis"));
            await screen.findByTestId("mock-editor");

            selectMenuItem("Settings", "Open Settings");

            expect(screen.getByTestId("mock-editor").closest(".app-page")).toHaveAttribute(
                "hidden",
            );
        });

        it("returns to the project it was opened from", async () => {
            render(<App />);
            fireEvent.doubleClick(await screen.findByText("thesis"));
            await screen.findByTestId("mock-editor");

            selectMenuItem("Settings", "Open Settings");
            fireEvent.click(screen.getByRole("button", { name: /Back to thesis/ }));

            await waitFor(() => {
                expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
            });
            expect(screen.getByTestId("mock-editor").closest(".app-page")).not.toHaveAttribute(
                "hidden",
            );
        });

        it("returns to the browser when opened from the browser", async () => {
            render(<App />);
            await screen.findByText("thesis");

            selectMenuItem("Settings", "Open Settings");
            fireEvent.click(screen.getByRole("button", { name: /Back to projects/ }));

            await waitFor(() => {
                expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
            });
            expect(screen.getByText("Projects")).toBeInTheDocument();
        });
    });

    it("stops driving the hot bar's editor actions while covered", async () => {
        // The editor is hidden, so Save and the snippet inserters must
        // not act on it.
        render(<App />);
        fireEvent.doubleClick(await screen.findByText("thesis"));
        await screen.findByTestId("mock-editor");

        fireEvent.click(screen.getByText("Edit"));
        expect(findMenuItem("Undo").className).not.toMatch(/Disabled/);
        fireEvent.click(findMenuItem("Undo"));

        selectMenuItem("Settings", "Open Settings");

        fireEvent.click(screen.getByText("Edit"));
        expect(findMenuItem("Undo").className).toMatch(/Disabled/);
    });
});
