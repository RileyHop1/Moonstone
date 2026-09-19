/**
 * Settings context: the defaults, the hook every consumer reads
 * settings through, and the normalisation that turns untrusted stored
 * values into usable ones. The provider that loads, applies and saves
 * them lives in `SettingsProvider.tsx`.
 */

import { createContext, useContext } from "react";
import type { StoredSettings } from "./tauri";
import { DEFAULT_THEME, normalizeTheme } from "./themes";
import type { AppSettings, LineNumberMode, ModalMode } from "./types";

/** The modal modes a stored value is allowed to name. */
const MODAL_MODES: readonly ModalMode[] = ["none", "vim", "helix"];

/** The line-numbering modes a stored value is allowed to name. */
const LINE_NUMBER_MODES: readonly LineNumberMode[] = ["absolute", "relative", "mixed"];

/** The settings a fresh install starts with (mirrors the backend). */
export const DEFAULT_SETTINGS: AppSettings = {
    theme: DEFAULT_THEME,
    editorFontSize: 14,
    modalMode: "none",
    spellCheckEnabled: true,
    lineNumberMode: "absolute",
    showDiagnostics: false,
    openPdfAfterCompile: true,
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
 * Narrows an unknown value to one of a fixed set of strings.
 *
 * The cast is contained here, once, instead of appearing twice at each
 * call site — where a reader has to check for themselves that the value
 * being asserted is the one that was just tested. `normalizeTheme` in
 * `themes.ts` already works this way.
 *
 * @param allowed - The values this setting may take.
 * @param value - The stored value, straight off disk.
 * @param fallback - Used when the value is not one of `allowed`.
 * @returns One of `allowed`.
 */
function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
    return allowed.find((candidate) => candidate === value) ?? fallback;
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

    // Anything unrecognised falls back to the default, so a settings
    // file naming a theme this build does not have cannot leave the app
    // with a `data-theme` no stylesheet answers to.
    const theme = normalizeTheme(stored.theme);

    const rawFontSize = Number(stored.editorFontSize);
    const editorFontSize = Number.isFinite(rawFontSize)
        ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(rawFontSize)))
        : DEFAULT_SETTINGS.editorFontSize;

    const modalMode = oneOf(MODAL_MODES, stored.modalMode, DEFAULT_SETTINGS.modalMode);

    // Anything that is not an explicit `false` leaves checking on: a
    // missing or malformed value should not silently disable it.
    const spellCheckEnabled = stored.spellCheckEnabled !== false;

    const lineNumberMode = oneOf(
        LINE_NUMBER_MODES,
        stored.lineNumberMode,
        DEFAULT_SETTINGS.lineNumberMode,
    );

    // Developer-facing and off unless explicitly asked for.
    const showDiagnostics = stored.showDiagnostics === true;

    // On unless explicitly turned off, like spell checking.
    const openPdfAfterCompile = stored.openPdfAfterCompile !== false;

    return {
        theme,
        editorFontSize,
        modalMode,
        spellCheckEnabled,
        lineNumberMode,
        showDiagnostics,
        openPdfAfterCompile,
    };
}
