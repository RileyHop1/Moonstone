import { useEffect, useState, useRef } from "react";
import styles from "../styles/DropDown.module.css";

/** One entry in a dropdown menu. */
export interface DropDownOption {
    /** Text shown for (and reported by) this entry. */
    readonly label: string;
    /** True renders the entry greyed out and unclickable. */
    readonly disabled: boolean;
    /** True renders a leading checkmark (e.g. the active choice). */
    readonly checked?: boolean;
}

/** Props for {@link DropDown}. */
interface DropDownProps {
    /** Label shown on the dropdown button. */
    readonly name: string;
    /** Options listed in the menu when it's open. */
    readonly options: readonly DropDownOption[];
    /** Called with the chosen option's label when the user clicks an item. */
    readonly onSelect: (label: string) => void;
}

/**
 * A simple menu dropdown: a labelled button that reveals a list of
 * options and reports the user's choice through onSelect. Disabled
 * options are shown greyed out and cannot be selected.
 *
 * @param props - The menu label, its options, and the select callback.
 * @returns The dropdown element.
 */
export default function DropDown({ name, options, onSelect }: DropDownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropDownRef = useRef<HTMLDivElement>(null);

    // Close when the user clicks anywhere outside the menu.
    useEffect(() => {
        if (!isOpen) return;

        function handleClick(event: MouseEvent) {
            if (dropDownRef.current && !dropDownRef.current.contains(event.target as Node))
                setIsOpen(false);
        }

        document.addEventListener("mousedown", handleClick);

        return () => {
            document.removeEventListener("mousedown", handleClick);
        };
    }, [isOpen]);

    /**
     * Reports an option choice and closes the menu.
     *
     * @param option - The clicked option.
     */
    function handleOptionClick(option: DropDownOption): void {
        if (option.disabled) return;

        onSelect(option.label);
        setIsOpen(false);
    }

    return (
        <div className={styles.dropdownContainer} ref={dropDownRef}>
            <button className={styles.dropdownTrigger} onClick={() => setIsOpen(!isOpen)}>
                {name}
            </button>
            {isOpen && (
                <ul className={styles.dropdownMenu}>
                    {options.map((option) => (
                        <li
                            className={`${styles.dropdownItem}${option.disabled ? ` ${styles.dropdownItemDisabled}` : ""}`}
                            key={option.label}
                            onClick={() => handleOptionClick(option)}
                        >
                            <span className={styles.dropdownCheck} aria-hidden="true">
                                {option.checked ? "✓" : ""}
                            </span>
                            {option.label}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
