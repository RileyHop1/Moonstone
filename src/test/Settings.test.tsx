/**
 * Test suite for the settings page: section tabs, theme switching,
 * font-size clamping, persistence, and navigation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Settings } from "../views/Settings";
import { invokeMock, mockCommands, resetInvokeMock } from "./mockTauri";
import { renderWithProviders } from "./testUtils";

vi.mock("@tauri-apps/api/core", async () => {
    const { invokeMock: mock } = await import("./mockTauri");
    return { invoke: mock, isTauri: () => true };
});

describe("Settings", () => {
    beforeEach(() => {
        resetInvokeMock();
        mockCommands({
            get_settings: () => ({ theme: "dark", editorFontSize: 14 }),
            save_settings: () => null,
        });
        document.documentElement.dataset.theme = "";
    });

    describe("sections", () => {
        it("opens on General", () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute(
                "aria-selected",
                "true",
            );
            expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
        });

        it("shows only the selected section's controls", () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            // Font size belongs to Editor, so it is not on screen yet.
            expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole("tab", { name: "Editor" }));

            expect(screen.getByRole("spinbutton")).toBeInTheDocument();
            expect(screen.queryByRole("radio", { name: "Dark" })).not.toBeInTheDocument();
        });

        it("moves the selection when another section is picked", () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            fireEvent.click(screen.getByRole("tab", { name: "Editor" }));

            expect(screen.getByRole("tab", { name: "Editor" })).toHaveAttribute(
                "aria-selected",
                "true",
            );
            expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute(
                "aria-selected",
                "false",
            );
        });
    });

    it("switches the theme, applies it to the DOM, and persists it", async () => {
        renderWithProviders(<Settings />, { kind: "settings" });

        fireEvent.click(screen.getByRole("radio", { name: "Light" }));

        await waitFor(() => {
            expect(document.documentElement.dataset.theme).toBe("light");
        });
        expect(invokeMock).toHaveBeenCalledWith("save_settings", {
            settings: {
                theme: "light",
                editorFontSize: 14,
                modalMode: "none",
                spellCheckEnabled: true,
            lineNumberMode: "absolute",
            showDiagnostics: false,
            },
        });
    });

    it("clamps the editor font size into its allowed range", async () => {
        renderWithProviders(<Settings />, { kind: "settings" });

        fireEvent.click(screen.getByRole("tab", { name: "Editor" }));
        fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "99" } });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("save_settings", {
                settings: {
                    theme: "dark",
                    editorFontSize: 24,
                    modalMode: "none",
                    spellCheckEnabled: true,
                lineNumberMode: "absolute",
                showDiagnostics: false,
                },
            });
        });
    });

    describe("editor preferences", () => {
        it("persists the chosen edit mode", async () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            fireEvent.click(screen.getByRole("tab", { name: "Editor" }));
            fireEvent.click(screen.getByRole("radio", { name: "Vim" }));

            await waitFor(() => {
                expect(invokeMock).toHaveBeenCalledWith("save_settings", {
                    settings: {
                        theme: "dark",
                        editorFontSize: 14,
                        modalMode: "vim",
                        spellCheckEnabled: true,
                    lineNumberMode: "absolute",
                    showDiagnostics: false,
                    },
                });
            });
        });

        it("persists spell check being turned off", async () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            fireEvent.click(screen.getByRole("tab", { name: "Editor" }));
            fireEvent.click(screen.getByRole("switch", { name: "Spell check" }));

            await waitFor(() => {
                expect(invokeMock).toHaveBeenCalledWith("save_settings", {
                    settings: {
                        theme: "dark",
                        editorFontSize: 14,
                        modalMode: "none",
                        spellCheckEnabled: false,
                    lineNumberMode: "absolute",
                    showDiagnostics: false,
                    },
                });
            });
        });

        it("gates line numbering on modal editing being on", async () => {
            // Counting from the cursor is for Vim/Helix motions, so the
            // control does nothing useful with edit mode set to None.
            renderWithProviders(<Settings />, { kind: "settings" });

            fireEvent.click(screen.getByRole("tab", { name: "Editor" }));

            expect(screen.getByRole("radio", { name: "Relative" })).toBeDisabled();
            expect(screen.getByText(/Needs Vim or Helix/)).toBeInTheDocument();

            fireEvent.click(screen.getByRole("radio", { name: "Vim" }));

            await waitFor(() => {
                expect(screen.getByRole("radio", { name: "Relative" })).toBeEnabled();
            });
        });

        it("persists the chosen line numbering", async () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            fireEvent.click(screen.getByRole("tab", { name: "Editor" }));
            // Line numbering is only offered under modal editing.
            fireEvent.click(screen.getByRole("radio", { name: "Vim" }));
            fireEvent.click(screen.getByRole("radio", { name: "Relative" }));

            await waitFor(() => {
                expect(invokeMock).toHaveBeenCalledWith("save_settings", {
                    settings: {
                        theme: "dark",
                        editorFontSize: 14,
                        modalMode: "vim",
                        spellCheckEnabled: true,
                        lineNumberMode: "relative",
                    showDiagnostics: false,
                    },
                });
            });
        });

        it("restores a stored edit mode as the active choice", async () => {
            mockCommands({
                get_settings: () => ({
                    theme: "dark",
                    editorFontSize: 14,
                    modalMode: "helix",
                    spellCheckEnabled: true,
                    lineNumberMode: "absolute",
                }),
                save_settings: () => null,
            });
            renderWithProviders(<Settings />, { kind: "settings" });

            fireEvent.click(screen.getByRole("tab", { name: "Editor" }));

            await waitFor(() => {
                expect(screen.getByRole("radio", { name: "Helix" })).toHaveAttribute(
                    "aria-checked",
                    "true",
                );
            });
        });
    });

    describe("advanced", () => {
        it("offers the diagnostics overlay behind its own section", () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            // Developer-facing, so it is not on the Editor tab with the
            // settings people actually use.
            fireEvent.click(screen.getByRole("tab", { name: "Editor" }));
            expect(
                screen.queryByRole("switch", { name: "Show editor diagnostics" }),
            ).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));

            expect(
                screen.getByRole("switch", { name: "Show editor diagnostics" }),
            ).toBeInTheDocument();
        });

        it("names the keyboard shortcut readably", () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));

            expect(screen.getByText(/Ctrl\+Shift\+D/)).toBeInTheDocument();
        });

        it("persists the overlay being turned on", async () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
            fireEvent.click(screen.getByRole("switch", { name: "Show editor diagnostics" }));

            await waitFor(() => {
                expect(invokeMock).toHaveBeenCalledWith("save_settings", {
                    settings: {
                        theme: "dark",
                        editorFontSize: 14,
                        modalMode: "none",
                        spellCheckEnabled: true,
                        lineNumberMode: "absolute",
                        showDiagnostics: true,
                    },
                });
            });
        });
    });

    describe("leaving", () => {
        it("returns to the project browser when opened from it", () => {
            const { navigateCalls } = renderWithProviders(<Settings />, { kind: "settings" });

            fireEvent.click(screen.getByRole("button", { name: /Back to projects/ }));

            expect(navigateCalls).toEqual([{ kind: "browser" }]);
        });

        it("returns to the project it was opened from", () => {
            // Otherwise changing a setting mid-edit costs the user a
            // trip out to the browser and back into their project.
            const project = {
                name: "thesis",
                path: "C:/root/thesis",
                lastModified: "2026-07-01T12:00:00+00:00",
                fileCount: 3,
            };

            const { navigateCalls } = renderWithProviders(
                <Settings />,
                { kind: "settings" },
                { kind: "project", project },
            );

            fireEvent.click(screen.getByRole("button", { name: /Back to thesis/ }));

            expect(navigateCalls).toEqual([{ kind: "project", project }]);
        });
    });
});
