/**
 * Reusable modal for prompting a single name (new project, new file,
 * new folder, rename) with inline validation.
 */

import { useState } from "react";
import type { FormEvent } from "react";

/** Characters rejected in names (path separators / Windows-reserved). */
const FORBIDDEN_NAME_CHARS = /[/\\:*?"<>|]/;

/**
 * Validates a candidate name.
 *
 * Mirrors the backend's `validate_name` so most mistakes are caught
 * before a round trip; the backend remains the authority.
 *
 * @param name - The candidate name.
 * @returns An error message, or null when the name is acceptable.
 */
export function validateEntryName(name: string): string | null {
    if (name.trim().length === 0) return "Name can't be empty";

    if (FORBIDDEN_NAME_CHARS.test(name)) {
        return 'Name can\'t contain / \\ : * ? " < > |';
    }

    if (name.startsWith(".")) return "Name can't start with a dot";

    return null;
}

/** Props for {@link NameDialog}. */
export interface NameDialogProps {
    /** Dialog heading, e.g. "New Project". */
    readonly title: string;
    /** Input placeholder text. */
    readonly placeholder: string;
    /** Label of the submit button, e.g. "Create". */
    readonly submitLabel: string;
    /** Value the input starts with (e.g. the current name on rename). */
    readonly initialValue?: string;
    /**
     * Called with the validated name; resolve with an error message to
     * show it inline, or null on success (the caller closes the dialog).
     */
    readonly onSubmit: (name: string) => Promise<string | null>;
    /** Called when the user dismisses the dialog. */
    readonly onCancel: () => void;
}

/**
 * Renders a single-input modal with validation and async submission.
 *
 * @param props - Labels, initial value, and submit/cancel callbacks.
 * @returns The dialog element.
 */
export function NameDialog({
    title,
    placeholder,
    submitLabel,
    initialValue = "",
    onSubmit,
    onCancel,
}: NameDialogProps) {
    const [name, setName] = useState(initialValue);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    /**
     * Validates the name and hands it to the caller.
     *
     * @param event - The form submission event.
     */
    async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();

        const validationError = validateEntryName(name);
        if (validationError) {
            setErrorMessage(validationError);
            return;
        }

        setIsSubmitting(true);
        const submitError = await onSubmit(name.trim());
        setIsSubmitting(false);

        if (submitError) setErrorMessage(submitError);
    }

    return (
        <div className="dialog-overlay" onClick={onCancel}>
            {/* Stop clicks inside the panel from dismissing the dialog. */}
            <form
                className="dialog-panel"
                onClick={(event) => event.stopPropagation()}
                onSubmit={handleSubmit}
            >
                <h2 className="dialog-title">{title}</h2>

                <input
                    className="dialog-input"
                    type="text"
                    placeholder={placeholder}
                    value={name}
                    autoFocus
                    onChange={(event) => {
                        setName(event.target.value);
                        setErrorMessage(null);
                    }}
                />

                {errorMessage && <p className="dialog-error">{errorMessage}</p>}

                <div className="dialog-buttons">
                    <button type="button" className="dialog-button" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="dialog-button dialog-button-primary"
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? "Working…" : submitLabel}
                    </button>
                </div>
            </form>
        </div>
    );
}
