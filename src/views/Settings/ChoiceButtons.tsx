/**
 * A small set of mutually exclusive options, rendered as a row of
 * buttons — the shape most settings on this page take.
 */

/** One selectable option. */
export interface Choice<T extends string> {
    /** The value this option sets. */
    readonly value: T;
    /** Text shown on the button. */
    readonly label: string;
}

/** Props for {@link ChoiceButtons}. */
export interface ChoiceButtonsProps<T extends string> {
    /** Accessible name for the group. */
    readonly label: string;
    /** The options, in display order. */
    readonly choices: readonly Choice<T>[];
    /** The currently selected value. */
    readonly value: T;
    /** Called with the newly chosen value. */
    readonly onChange: (value: T) => void;
    /**
     * Greys the group out and refuses input, for a setting that does
     * nothing until some other setting is changed first.
     */
    readonly disabled?: boolean;
}

/**
 * Renders the options as a radio group.
 *
 * @param props - Options, current value, and the change handler.
 * @returns The group element.
 */
export function ChoiceButtons<T extends string>({
    label,
    choices,
    value,
    onChange,
    disabled = false,
}: ChoiceButtonsProps<T>) {
    return (
        <div className="settings-choices" role="radiogroup" aria-label={label}>
            {choices.map((choice) => (
                <button
                    key={choice.value}
                    type="button"
                    role="radio"
                    aria-checked={choice.value === value}
                    disabled={disabled}
                    className={`settings-choice${
                        choice.value === value ? " settings-choice-active" : ""
                    }`}
                    onClick={() => onChange(choice.value)}
                >
                    {choice.label}
                </button>
            ))}
        </div>
    );
}
