/**
 * Settings context: loads persisted preferences on startup, applies
 * them to the DOM (theme attribute + editor font-size variable), and
 * saves changes back through the backend.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getSettings, saveSettings } from "./tauri";
import type { StoredSettings } from "./tauri";
import type { AppSettings, LineNumberMode, ModalMode, Theme } from "./types";

/** The modal modes a stored value is allowed to name. */
const MODAL_MODES: readonly ModalMode[] = ["none", "vim", "helix"];

/** The line-numbering modes a stored value is allowed to name. */
const LINE_NUMBER_MODES: readonly LineNumberMode[] = ["absolute", "relative", "mixed"];

/** The settings a fresh install starts with (mirrors the backend). */
export const DEFAULT_SETTINGS: AppSettings = {
    theme: "dark",
    editorFontSize: 14,
    modalMode: "none",
    spellCheckEnabled: true,
    lineNumberMode: "absolute",
};

/** Allowed editor font-size bounds in pixels. */
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;

/** Value provided by the settings context. */
export interface SettingsValue {
    /** The current settings. */
    readonly settings: AppSettings;
    /** Merges a partial update, applies it, and persists it. */
    readonly updateSettings: (partial: Partial<AppSettings>) => void;
}

/** Context carrying the current settings and their updater. */
export const SettingsContext = createContext<SettingsValue | null>(null);

/**
 * Accesses the settings context.
 *
 * @returns The current settings and update function.
 * @throws If called outside of a SettingsProvider.
 */
export function useSettings(): SettingsValue {
    const value = useContext(SettingsContext);

    if (!value) {
        throw new Error("useSettings must be used inside a SettingsProvider");
    }

    return value;
}

/**
 * Narrows and clamps raw stored settings into a valid AppSettings.
 *
 * The stored value crosses the IPC boundary, so nothing about its
 * shape is trusted; anything malformed falls back to the defaults.
 *
 * @param stored - Settings as loaded from disk.
 * @returns Sanitized settings safe to apply.
 */
export function normalizeSettings(stored: StoredSettings | null | undefined): AppSettings {
    if (!stored) return DEFAULT_SETTINGS;

    const theme: Theme = stored.theme === "light" ? "light" : "dark";

    const rawFontSize = Number(stored.editorFontSize);
    const editorFontSize = Number.isFinite(rawFontSize)
        ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(rawFontSize)))
        : DEFAULT_SETTINGS.editorFontSize;

    const modalMode: ModalMode = MODAL_MODES.includes(stored.modalMode as ModalMode)
        ? (stored.modalMode as ModalMode)
        : DEFAULT_SETTINGS.modalMode;

    // Anything that is not an explicit `false` leaves checking on: a
    // missing or malformed value should not silently disable it.
    const spellCheckEnabled = stored.spellCheckEnabled !== false;

    const lineNumberMode: LineNumberMode = LINE_NUMBER_MODES.includes(
        stored.lineNumberMode as LineNumberMode,
    )
        ? (stored.lineNumberMode as LineNumberMode)
        : DEFAULT_SETTINGS.lineNumberMode;

    return { theme, editorFontSize, modalMode, spellCheckEnabled, lineNumberMode };
}

/**
 * Applies settings to the document root: the theme drives the CSS
 * variable palette, the font size drives the editor.
 *
 * @param settings - The settings to apply.
 */
function applySettingsToDom(settings: AppSettings): void {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty(
        "--editor-font-size",
        `${settings.editorFontSize}px`,
    );
}

/**
 * Hosts the settings state: loads once on mount, applies on every
 * change, and persists updates.
 *
 * @param props - The provider's children.
 * @returns The context provider element.
 */
export function SettingsProvider({ children }: { readonly children: ReactNode }) {
    const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

    // Load persisted settings once; a failed load keeps the defaults.
    useEffect(() => {
        let cancelled = false;

        void (async () => {
            const result = await getSettings();
            if (cancelled || !result.ok) return;

            setSettings(normalizeSettings(result.data));
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        applySettingsToDom(settings);
    }, [settings]);

    const updateSettings = useCallback((partial: Partial<AppSettings>) => {
        setSettings((previous) => {
            const next = normalizeSettings({ ...previous, ...partial });

            // Persist in the background; a failed save should not
            // block the UI change.
            void saveSettings(next).then((result) => {
                if (!result.ok) console.error("Failed to save settings:", result.error);
            });

            return next;
        });
    }, []);

    const value = useMemo<SettingsValue>(
        () => ({ settings, updateSettings }),
        [settings, updateSettings],
    );

    return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
