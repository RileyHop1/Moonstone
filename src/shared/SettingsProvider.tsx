/**
 * Hosts the settings state: loads persisted preferences on startup,
 * applies them to the DOM (theme attribute + editor font-size
 * variable), and saves changes back through the backend.
 *
 * The only component in the settings module, kept in its own file so
 * `settings.ts` — the context, hook and normalisation every consumer
 * imports — exports no components and Fast Refresh stays reliable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_SETTINGS, normalizeSettings, SettingsContext } from "./settings";
import type { SettingsValue } from "./settings";
import { getSettings, saveSettings } from "./tauri";
import type { AppSettings } from "./types";

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
