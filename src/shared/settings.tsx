/**
 * Settings context: loads persisted preferences on startup, applies
 * them to the DOM (theme attribute + editor font-size variable), and
 * saves changes back through the backend.
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type { ReactNode } from "react";
import { getSettings, saveSettings } from "./tauri";
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
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the cleanup below assigns to this flag, which ESLint's flow analysis does not follow
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

    // Mirrors the applied settings so the updater below can compute the
    // next value without reading state through a React updater.
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    const updateSettings = useCallback((partial: Partial<AppSettings>) => {
        const next = normalizeSettings({ ...settingsRef.current, ...partial });

        // Computed and persisted outside the updater. React may invoke
        // an updater more than once — it does, under StrictMode — and an
        // updater that saved would then write the file twice per change.
        // Updaters have to be pure.
        setSettings(next);

        // Persisted in the background; a failed save should not block
        // the UI change.
        void saveSettings(next).then((result) => {
            if (!result.ok) console.error("Failed to save settings:", result.error);
        });
    }, []);

    const value = useMemo<SettingsValue>(
        () => ({ settings, updateSettings }),
        [settings, updateSettings],
    );

    return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
