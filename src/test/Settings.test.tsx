/**
 * Test suite for the settings page: theme switching, font-size
 * clamping, persistence, and navigation.
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

    it("renders the appearance controls", () => {
        renderWithProviders(<Settings />, { kind: "settings" });

        expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
    });

    it("switches the theme, applies it to the DOM, and persists it", async () => {
        renderWithProviders(<Settings />, { kind: "settings" });

        fireEvent.click(screen.getByRole("button", { name: "Light" }));

        await waitFor(() => {
            expect(document.documentElement.dataset.theme).toBe("light");
        });
        expect(invokeMock).toHaveBeenCalledWith("save_settings", {
            settings: { theme: "light", editorFontSize: 14 },
        });
    });

    it("clamps the editor font size into its allowed range", async () => {
        renderWithProviders(<Settings />, { kind: "settings" });

        fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "99" } });

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith("save_settings", {
                settings: { theme: "dark", editorFontSize: 24 },
            });
        });
    });

    it("navigates back to the project browser", () => {
        const { navigateCalls } = renderWithProviders(<Settings />, { kind: "settings" });

        fireEvent.click(screen.getByRole("button", { name: "Back to projects" }));

        expect(navigateCalls).toEqual([{ kind: "browser" }]);
    });
});
