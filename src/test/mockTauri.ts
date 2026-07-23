/**
 * Shared mock for the Tauri `invoke` bridge.
 *
 * Suites route commands through {@link mockCommands}; each suite still
 * declares the module mock itself (vi.mock is file-scoped):
 *
 * ```ts
 * vi.mock("@tauri-apps/api/core", async () => {
 *     const { invokeMock } = await import("./mockTauri");
 *     return { invoke: invokeMock, isTauri: () => true };
 * });
 * ```
 */

import { vi } from "vitest";

/** Handler for one mocked backend command. */
export type CommandHandler = (
    args: Record<string, unknown> | undefined,
) => unknown | Promise<unknown>;

/** The mock standing in for Tauri's `invoke`. */
export const invokeMock = vi.fn<
    (command: string, args?: Record<string, unknown>) => Promise<unknown>
>();

/**
 * Routes mocked invoke calls to per-command handlers.
 *
 * The settings commands get working defaults (every render tree
 * includes the SettingsProvider); pass your own handler to override.
 * Unknown commands reject with a string, mirroring how real Tauri
 * commands reject with their Rust `Err(String)`.
 *
 * @param handlers - Handlers keyed by command name.
 */
export function mockCommands(handlers: Record<string, CommandHandler>): void {
    const routed: Record<string, CommandHandler> = {
        get_settings: () => ({ theme: "dark", editorFontSize: 14 }),
        save_settings: () => null,
        ...handlers,
    };

    invokeMock.mockImplementation(async (command, args) => {
        const handler = routed[command];

        if (!handler) {
            throw `No mock registered for command ${command}`;
        }

        return handler(args);
    });
}

/**
 * Clears the invoke mock's calls and implementation between tests.
 */
export function resetInvokeMock(): void {
    invokeMock.mockReset();
}
