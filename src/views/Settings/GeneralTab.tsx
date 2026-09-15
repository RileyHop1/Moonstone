/**
 * General settings: preferences that apply to the whole application
 * rather than to the editor.
 */

import { useSettings } from "../../shared/settings";
import { THEMES } from "../../shared/themes";
import type { Theme } from "../../shared/types";
import { SettingsRow } from "./SettingsRow";
import { SettingsSelect } from "./SettingsSelect";

/**
 * The selectable themes, in display order.
 *
 * Derived from the registry rather than restated, so a new palette
 * appears here by existing.
 */
const THEME_CHOICES: readonly { readonly value: Theme; readonly label: string }[] = THEMES.map(
    ({ id, label }) => ({ value: id, label }),
);

/**
 * Renders the general settings panel.
 *
 * @returns The panel element.
 */
export function GeneralTab() {
    const { settings, updateSettings } = useSettings();

    return (
        <SettingsRow label="Theme" description="Applies immediately across the app.">
            <SettingsSelect
                label="Theme"
                options={THEME_CHOICES}
                value={settings.theme}
                onChange={(theme) => updateSettings({ theme })}
            />
        </SettingsRow>
    );
}
