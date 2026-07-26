/**
 * Test suite for the project browser page: load states, navigation on
 * double-click, and the new-project dialog flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectBrowser } from "../views/ProjectBrowser";
import type { ProjectInfo } from "../shared/types";
import { invokeMock, mockCommands, resetInvokeMock } from "./mockTauri";
import { renderWithProviders } from "./testUtils";

vi.mock("@tauri-apps/api/core", async () => {
    const { invokeMock: mock } = await import("./mockTauri");
    return { invoke: mock, isTauri: () => true };
});

/** Two-project fixture matching the backend's ProjectInfo shape. */
const PROJECTS: readonly ProjectInfo[] = [
    {
        name: "thesis",
        path: "C:/root/thesis",
        lastModified: "2026-07-01T12:00:00+00:00",
        fileCount: 3,
    },
    {
        name: "notes",
        path: "C:/root/notes",
        lastModified: "2026-07-02T12:00:00+00:00",
        fileCount: 1,
    },
];

describe("ProjectBrowser", () => {
    beforeEach(() => {
        resetInvokeMock();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("shows a loading state while the list is pending", () => {
        mockCommands({ list_projects: () => new Promise(() => {}) });

        renderWithProviders(<ProjectBrowser />);

        expect(screen.getByText("Loading projects…")).toBeInTheDocument();
    });

    it("renders one card per project", async () => {
        mockCommands({ list_projects: () => PROJECTS });

        renderWithProviders(<ProjectBrowser />);

        expect(await screen.findByText("thesis")).toBeInTheDocument();
        expect(screen.getByText("notes")).toBeInTheDocument();
    });

    it("navigates to the project page on double-click", async () => {
        mockCommands({ list_projects: () => PROJECTS });

        const { navigateCalls } = renderWithProviders(<ProjectBrowser />);

        fireEvent.doubleClick(await screen.findByText("thesis"));

        expect(navigateCalls).toEqual([{ kind: "project", project: PROJECTS[0] }]);
    });

    it("shows the backend error and retries on request", async () => {
        mockCommands({ list_projects: () => Promise.reject("disk exploded") });
        renderWithProviders(<ProjectBrowser />);

        expect(await screen.findByText("disk exploded")).toBeInTheDocument();

        mockCommands({ list_projects: () => PROJECTS });
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));

        expect(await screen.findByText("thesis")).toBeInTheDocument();
    });

    it("shows the empty state when there are no projects", async () => {
        mockCommands({ list_projects: () => [] });

        renderWithProviders(<ProjectBrowser />);

        expect(await screen.findByText("No projects yet.")).toBeInTheDocument();
    });

    it("rejects invalid names in the new-project dialog", async () => {
        mockCommands({ list_projects: () => [] });
        renderWithProviders(<ProjectBrowser />);

        fireEvent.click(await screen.findByRole("button", { name: "Create your first project" }));
        fireEvent.change(screen.getByPlaceholderText("Project name"), {
            target: { value: "bad/name" },
        });
        fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);

        expect(await screen.findByText(/can't contain/)).toBeInTheDocument();
        // The backend must never be asked to create an invalid project.
        expect(invokeMock).not.toHaveBeenCalledWith("create_project", expect.anything());
    });

    it("deletes a project via the context menu after confirmation", async () => {
        vi.spyOn(window, "confirm").mockReturnValue(true);
        mockCommands({
            list_projects: () => PROJECTS,
            delete_project: () => null,
        });

        renderWithProviders(<ProjectBrowser />);

        fireEvent.contextMenu(await screen.findByText("thesis"));
        fireEvent.click(screen.getByText("Delete"));

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("delete_project", {
                projectPath: "C:/root/thesis",
            });
        });
    });

    it("renames a project via the context menu", async () => {
        mockCommands({
            list_projects: () => PROJECTS,
            rename_project: () => "C:/root/dissertation",
        });

        renderWithProviders(<ProjectBrowser />);

        fireEvent.contextMenu(await screen.findByText("thesis"));
        fireEvent.click(screen.getByText("Rename"));

        // The dialog opens seeded with the current name.
        const input = screen.getByPlaceholderText("Project name");
        expect(input).toHaveValue("thesis");

        fireEvent.change(input, { target: { value: "dissertation" } });
        fireEvent.submit(screen.getByRole("button", { name: "Rename" }).closest("form")!);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("rename_project", {
                projectPath: "C:/root/thesis",
                newName: "dissertation",
            });
        });
    });

    it("rejects an invalid project rename before calling the backend", async () => {
        mockCommands({ list_projects: () => PROJECTS });

        renderWithProviders(<ProjectBrowser />);

        fireEvent.contextMenu(await screen.findByText("thesis"));
        fireEvent.click(screen.getByText("Rename"));
        fireEvent.change(screen.getByPlaceholderText("Project name"), {
            target: { value: "a/b" },
        });
        fireEvent.submit(screen.getByRole("button", { name: "Rename" }).closest("form")!);

        expect(await screen.findByText(/can't contain/)).toBeInTheDocument();
        expect(invokeMock).not.toHaveBeenCalledWith("rename_project", expect.anything());
    });

    it("does not delete when the confirmation is declined", async () => {
        vi.spyOn(window, "confirm").mockReturnValue(false);
        mockCommands({ list_projects: () => PROJECTS });

        renderWithProviders(<ProjectBrowser />);

        fireEvent.contextMenu(await screen.findByText("thesis"));
        fireEvent.click(screen.getByText("Delete"));

        await waitFor(() => {
            expect(invokeMock).not.toHaveBeenCalledWith("delete_project", expect.anything());
        });
    });

    it("creates a project and navigates straight into it", async () => {
        const created: ProjectInfo = {
            name: "fresh",
            path: "C:/root/fresh",
            lastModified: "2026-07-03T12:00:00+00:00",
            fileCount: 1,
        };
        mockCommands({
            list_projects: () => [],
            create_project: () => created,
        });

        const { navigateCalls } = renderWithProviders(<ProjectBrowser />);

        fireEvent.click(await screen.findByRole("button", { name: "Create your first project" }));
        fireEvent.change(screen.getByPlaceholderText("Project name"), {
            target: { value: "fresh" },
        });
        fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);

        await waitFor(() =>
            expect(navigateCalls).toEqual([{ kind: "project", project: created }]),
        );
    });
});
