/**
 * Editor settings: preferences that change how the document is edited
 * and displayed.
 */

import { FONT_SIZE_MAX, FONT_SIZE_MIN, useSettings } from "../../shared/settings";
import type { LineNumberMode, ModalMode } from "../../shared/types";
import { ChoiceButtons } from "./ChoiceButtons";
import { SettingsRow } from "./SettingsRow";
import { ToggleSwitch } from "./ToggleSwitch";

/** The modal editing styles, in display order. */
const MODAL_MODE_CHOICES: readonly { readonly value: ModalMode; readonly label: string }[] = [
    { value: "none", label: "None" },
    { value: "vim", label: "Vim" },
    { value: "helix", label: "Helix" },
];

/** The line-numbering modes, in display order. */
const LINE_NUMBER_CHOICES: readonly {
    readonly value: LineNumberMode;
    readonly label: string;
}[] = [
    { value: "absolute", label: "Absolute" },
    { value: "relative", label: "Relative" },
    { value: "mixed", label: "Mixed" },
];

/**
 * Renders the editor settings panel.
 *
 * @returns The panel element.
 */
export function EditorTab() {
    const { settings, updateSettings } = useSettings();

    // Line numbering that counts from the cursor only earns its place
    // under modal editing, so the control follows the edit mode.
    const isModalEditing = settings.modalMode !== "none";

    return (
        <>
            <SettingsRow
                label="Font size"
                description={`Between ${FONT_SIZE_MIN} and ${FONT_SIZE_MAX} pixels.`}
            >
                <input
                    className="settings-number-input"
                    type="number"
                    aria-label="Font size"
                    min={FONT_SIZE_MIN}
                    max={FONT_SIZE_MAX}
                    value={settings.editorFontSize}
                    onChange={(event) => {
                        const parsed = Number(event.target.value);
                        if (Number.isNaN(parsed)) return;

                        updateSettings({ editorFontSize: parsed });
                    }}
                />
            </SettingsRow>

            <SettingsRow
                label="Edit mode"
                description="Modal keybindings applied to every editor."
            >
                <ChoiceButtons
                    label="Edit mode"
                    choices={MODAL_MODE_CHOICES}
                    value={settings.modalMode}
                    onChange={(modalMode) => updateSettings({ modalMode })}
                />
            </SettingsRow>

            <SettingsRow
                label="Line numbers"
                description={
                    isModalEditing
                        ? "Relative counts from the cursor; mixed goes absolute while inserting."
                        : "Needs Vim or Helix — counting from the cursor is for modal motions."
                }
            >
                <ChoiceButtons
                    label="Line numbers"
                    choices={LINE_NUMBER_CHOICES}
                    value={settings.lineNumberMode}
                    onChange={(lineNumberMode) => updateSettings({ lineNumberMode })}
                    disabled={!isModalEditing}
                />
            </SettingsRow>

            <SettingsRow
                label="Spell check"
                description="Underlines misspelled prose, skipping commands and math."
            >
                <ToggleSwitch
                    label="Spell check"
                    checked={settings.spellCheckEnabled}
                    onChange={(spellCheckEnabled) => updateSettings({ spellCheckEnabled })}
                />
            </SettingsRow>
        </>
    );
}
