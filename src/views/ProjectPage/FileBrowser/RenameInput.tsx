/**
 * Inline rename field shown in place of a file-tree row's name.
 *
 * Owns the edit text and any validation error surfaced by the commit
 * callback; Enter commits, Escape or blur cancels.
 */

import { useEffect, useRef, useState } from "react";
import { validateEntryName } from "../../../shared/nameValidation";

/** Props for {@link RenameInput}. */
export interface RenameInputProps {
    /** The entry's current name, pre-filled and selected. */
    readonly initialValue: string;
    /** Commits the new name; resolves to an error message or null. */
    readonly onCommit: (newName: string) => Promise<string | null>;
    /** Leaves edit mode without committing. */
    readonly onExit: () => void;
}

/**
 * Renders the inline rename input.
 *
 * @param props - Initial value and commit/exit callbacks.
 * @returns The input element (with an error tooltip when invalid).
 */
export function RenameInput({ initialValue, onCommit, onExit }: RenameInputProps) {
    const [value, setValue] = useState(initialValue);
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    // Focus on mount and select the base name (before the extension) so
    // typing replaces the name but keeps the extension by default.
    useEffect(() => {
        const input = inputRef.current;
        if (!input) return;

        input.focus();
        const dot = initialValue.lastIndexOf(".");
        input.setSelectionRange(0, dot > 0 ? dot : initialValue.length);
    }, [initialValue]);

    /**
     * Commits the rename, keeping the field open on failure.
     */
    async function commit(): Promise<void> {
        if (isSubmitting) return;

        if (value.trim() === "" || value === initialValue) {
            onExit();
            return;
        }

        // Checked here as well as in the dialog so every place a name
        // is typed reports the same rule, without a round trip.
        const validationError = validateEntryName(value.trim());
        if (validationError) {
            setError(validationError);
            return;
        }

        setIsSubmitting(true);
        const message = await onCommit(value.trim());
        setIsSubmitting(false);

        if (message === null) {
            onExit();
            return;
        }

        setError(message);
    }

    return (
        <input
            ref={inputRef}
            className={`file-tree-rename-input${error ? " file-tree-rename-input-error" : ""}`}
            value={value}
            title={error ?? undefined}
            spellCheck={false}
            onChange={(event) => {
                setValue(event.target.value);
                if (error) setError(null);
            }}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    void commit();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    onExit();
                }
            }}
            onBlur={onExit}
        />
    );
}
