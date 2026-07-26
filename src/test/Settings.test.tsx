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

    it("navigates back to the project browser", () => {
        const { navigateCalls } = renderWithProviders(<Settings />, { kind: "settings" });

        fireEvent.click(screen.getByRole("button", { name: /Back to projects/ }));

        expect(navigateCalls).toEqual([{ kind: "browser" }]);
    });
});
