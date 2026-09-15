/**
 * An on/off setting, rendered as a switch.
 *
 * Built on a checkbox with `role="switch"` so it is keyboard operable
 * and announced correctly without reimplementing either.
 */

/** Props for {@link ToggleSwitch}. */
export interface ToggleSwitchProps {
    /** Accessible name for the switch. */
    readonly label: string;
    /** Whether the setting is on. */
    readonly checked: boolean;
    /** Called with the new state. */
    readonly onChange: (checked: boolean) => void;
}

/**
 * Renders the switch.
 *
 * @param props - Label, state, and the change handler.
 * @returns The switch element.
 */
export function ToggleSwitch({ label, checked, onChange }: ToggleSwitchProps) {
    return (
        <label className="settings-switch">
            <input
                type="checkbox"
                role="switch"
                aria-label={label}
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
            />
            <span className="settings-switch-track" aria-hidden="true" />
        </label>
    );
}
