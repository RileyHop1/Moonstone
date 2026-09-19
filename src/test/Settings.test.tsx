/**
 * Test suite for the settings page: section tabs, theme switching,
 * font-size clamping, persistence, and navigation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { act, renderHook, screen, fireEvent, waitFor } from "@testing-library/react";
import { Settings } from "../views/Settings";
import { useSettings } from "../shared/settings";
import { SettingsProvider } from "../shared/SettingsProvider";
import { THEMES } from "../shared/themes";
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
            expect(screen.getByRole("combobox", { name: "Theme" })).toBeInTheDocument();
        });

        it("shows only the selected section's controls", () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            // Font size belongs to Editor, so it is not on screen yet.
            expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole("tab", { name: "Editor" }));

            expect(screen.getByRole("spinbutton")).toBeInTheDocument();
            expect(screen.queryByRole("combobox", { name: "Theme" })).not.toBeInTheDocument();
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

    describe("PDF preview", () => {
        it("persists opening the PDF after compiling being turned off", async () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            fireEvent.click(screen.getByRole("switch", { name: "Open PDF after compiling" }));

            await waitFor(() => {
                expect(invokeMock).toHaveBeenCalledWith(
                    "save_settings",
                    expect.objectContaining({
                        settings: expect.objectContaining({ openPdfAfterCompile: false }),
                    }),
                );
            });
        });

        it("persists compile-on-save being turned off", async () => {
            renderWithProviders(<Settings />, { kind: "settings" });

            fireEvent.click(screen.getByRole("switch", { name: "Compile on save" }));

            await waitFor(() => {
                expect(invokeMock).toHaveBeenCalledWith(
                    "save_settings",
                    expect.objectContaining({
                        settings: expect.objectContaining({ compileOnSave: false }),
                    }),
                );
            });
        });

        it("leaves the preview on when the stored value is malformed", async () => {
            // Only an explicit `false` turns it off: a hand-edited or
            // older settings file must not silently hide the PDF.
            mockCommands({
                get_settings: () => ({ theme: "light", openPdfAfterCompile: "no" }),
                save_settings: () => null,
            });
            renderWithProviders(<Settings />, { kind: "settings" });

            // The default is also "on", so first wait for the stored
            // settings to have loaded — signalled by the non-default
            // theme — or this passes before the value is ever read.
            await waitFor(() => {
                expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("light");
            });
            expect(
                screen.getByRole("switch", { name: "Open PDF after compiling" }),
            ).toBeChecked();
        });
    });

    it("switches the theme, applies it to the DOM, and persists it", async () => {
        renderWithProviders(<Settings />, { kind: "settings" });

        fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), {
            target: { value: "light" },
        });

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
                openPdfAfterCompile: true,

                compileOnSave: true,
            },
        });
    });

    it("offers every registered theme", () => {
        renderWithProviders(<Settings />, { kind: "settings" });

        const themes = screen.getByRole("combobox", { name: "Theme" });

        // A dropdown, not a row of buttons: six themes overflowed the
        // settings card, and the list is expected to keep growing.
        expect(themes.tagName).toBe("SELECT");
        expect([...themes.querySelectorAll("option")].map((option) => option.value)).toEqual(
            THEMES.map((theme) => theme.id),
        );
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
                    openPdfAfterCompile: true,

                    compileOnSave: true,
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
                        openPdfAfterCompile: true,

                        compileOnSave: true,
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
                        openPdfAfterCompile: true,

                        compileOnSave: true,
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
                        openPdfAfterCompile: true,

                        compileOnSave: true,
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
                        openPdfAfterCompile: true,

                        compileOnSave: true,
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

describe("settings persistence", () => {
    beforeEach(() => {
        resetInvokeMock();
        mockCommands({ save_settings: () => null });
    });

    /** Every `save_settings` invocation so far. */
    function saveCalls(): unknown[][] {
        return invokeMock.mock.calls.filter((call) => call[0] === "save_settings");
    }

    /**
     * Mounts the settings provider under StrictMode and hands back its
     * value.
     *
     * StrictMode has to wrap the **provider**, not the page inside it:
     * what is under test is whether React double-invoking an updater
     * causes a second write, and an updater outside StrictMode is only
     * ever called once.
     */
    function mountProvider() {
        return renderHook(() => useSettings(), {
            wrapper: ({ children }) => (
                <StrictMode>
                    <SettingsProvider>{children}</SettingsProvider>
                </StrictMode>
            ),
        });
    }

    it("writes to disk once per change", async () => {
        // The save used to live inside a `setState` updater. React may
        // invoke an updater more than once — it does under StrictMode —
        // so every settings change fired two `save_settings` calls
        // (finding F-1). Updaters have to be pure.
        const { result } = mountProvider();

        await act(async () => {
            result.current.updateSettings({ theme: "light" });
            await Promise.resolve();
        });

        expect(saveCalls()).toHaveLength(1);
    });

    it("writes once per change when several are made", async () => {
        const { result } = mountProvider();

        await act(async () => {
            result.current.updateSettings({ theme: "light" });
            await Promise.resolve();
        });
        await act(async () => {
            result.current.updateSettings({ editorFontSize: 18 });
            await Promise.resolve();
        });

        expect(saveCalls()).toHaveLength(2);
    });
});
