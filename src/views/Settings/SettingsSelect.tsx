/**
 * A dropdown for settings whose option list is open-ended.
 *
 * `ChoiceButtons` is the right shape for two or three mutually
 * exclusive options and stays the default. It stops working once a
 * list grows — six themes overflowed the settings card and squeezed
 * the label column to nothing — and it would only get worse with the
 * seventh.
 *
 * Built on a native `<select>` deliberately. Keyboard navigation, type
 * to find, screen-reader semantics and scrolling for a long list all
 * come free and correct, where a hand-rolled listbox has to reproduce
 * every one of them. The popup is drawn by the OS, so it follows the
 * palette only as far as `color-scheme` allows — a neutral dark or
 * light menu rather than a tinted one. That is the price of not
 * shipping a bespoke widget, and it is only visible while the menu is
 * actually open.
 */

/** One selectable option. */
export interface SelectOption<T extends string> {
    /** The value this option sets. */
    readonly value: T;
    /** Text shown for the option. */
    readonly label: string;
}

/** Props for {@link SettingsSelect}. */
export interface SettingsSelectProps<T extends string> {
    /** Accessible name for the control. */
    readonly label: string;
    /** The options, in display order. */
    readonly options: readonly SelectOption<T>[];
    /** The currently selected value. */
    readonly value: T;
    /** Called with the newly chosen value. */
    readonly onChange: (value: T) => void;
    /** Greys the control out and refuses input. */
    readonly disabled?: boolean;
}

/**
 * Renders a settings dropdown.
 *
 * @param props - Options, current value, and the change handler.
 * @returns The select element.
 */
export function SettingsSelect<T extends string>({
    label,
    options,
    value,
    onChange,
    disabled = false,
}: SettingsSelectProps<T>) {
    return (
        <select
            className="settings-select"
            aria-label={label}
            value={value}
            disabled={disabled}
            // The cast is confined to this one line: a `<select>`
            // reports its value as a plain string, but every option it
            // can offer came from the typed list above.
            onChange={(event) => onChange(event.target.value as T)}
        >
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    );
}
