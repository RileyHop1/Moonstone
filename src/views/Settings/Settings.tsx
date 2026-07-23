/**
 * Settings page: theme and editor preferences, applied live and
 * persisted through the backend.
 */

import { useNavigation } from "../../shared/navigation";
import { useSettings, FONT_SIZE_MAX, FONT_SIZE_MIN } from "../../shared/settings";
import type { Theme } from "../../shared/types";
import "./Settings.css";

/** The selectable themes, in display order. */
const THEME_OPTIONS: readonly { readonly value: Theme; readonly label: string }[] = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
];

/**
 * Renders the settings page. Every control applies immediately and is
 * persisted by the settings provider.
 *
 * @returns The settings page element.
 */
export function Settings() {
    const { navigate } = useNavigation();
    const { settings, updateSettings } = useSettings();

    return (
        <div className="settings-page">
            <h1 className="settings-title">Settings</h1>

            <section className="settings-section">
                <h2 className="settings-section-title">Appearance</h2>

                <div className="settings-row">
                    <span className="settings-label">Theme</span>
                    <div className="settings-theme-options">
                        {THEME_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                className={`settings-theme-button${
                                    settings.theme === option.value
                                        ? " settings-theme-button-active"
                                        : ""
                                }`}
                                onClick={() => updateSettings({ theme: option.value })}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>

                <label className="settings-row">
                    <span className="settings-label">Editor font size</span>
                    <input
                        className="settings-number-input"
                        type="number"
                        min={FONT_SIZE_MIN}
                        max={FONT_SIZE_MAX}
                        value={settings.editorFontSize}
                        onChange={(event) => {
                            const parsed = Number(event.target.value);
                            if (Number.isNaN(parsed)) return;

                            updateSettings({ editorFontSize: parsed });
                        }}
                    />
                </label>
            </section>

            <button
                type="button"
                className="settings-back-button"
                onClick={() => navigate({ kind: "browser" })}
            >
                Back to projects
            </button>
        </div>
    );
}
