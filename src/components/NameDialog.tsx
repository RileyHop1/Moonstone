/**
 * Reusable modal for prompting a single name (new project, new file,
 * new folder, rename) with inline validation.
 */

import { useState } from "react";
import type { FormEvent } from "react";
import { DEFAULT_FILE_EXTENSION, FILE_TYPES } from "../shared/fileTypes";
import { validateEntryName } from "../shared/nameValidation";

/** What the dialog submits. */
export interface NameDialogResult {
    /** The validated name, trimmed. */
    readonly name: string;
    /**
     * Chosen extension without the dot, or null when the dialog is
     * not offering a file type (projects, folders, renames).
     */
    readonly extension: string | null;
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
     * Show a file-type picker beside the name. The user then types
     * only the name — the extension is chosen, never typed, so it
     * cannot be misspelled or omitted.
     */
    readonly withFileType?: boolean;
    /**
     * Called with the validated result; resolve with an error message
     * to show it inline, or null on success (the caller closes the
     * dialog).
     */
    readonly onSubmit: (result: NameDialogResult) => Promise<string | null>;
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
    withFileType = false,
    onSubmit,
    onCancel,
}: NameDialogProps) {
    const [name, setName] = useState(initialValue);
    const [extension, setExtension] = useState(DEFAULT_FILE_EXTENSION);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    /**
     * Validates the name and hands it to the caller.
     *
     * @param event - The form submission event.
     */
    async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();

        const trimmed = name.trim();

        const validationError = validateEntryName(trimmed);
        if (validationError) {
            setErrorMessage(validationError);
            return;
        }

        setIsSubmitting(true);
        const submitError = await onSubmit({
            name: trimmed,
            extension: withFileType ? extension : null,
        });
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

                {withFileType && (
                    <label className="dialog-field">
                        <span className="dialog-field-label">File type</span>
                        <select
                            className="dialog-select"
                            value={extension}
                            onChange={(event) => setExtension(event.target.value)}
                        >
                            {FILE_TYPES.map((type) => (
                                <option key={type.extension} value={type.extension}>
                                    {type.label}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                {withFileType && name.trim() && !validateEntryName(name.trim()) && (
                    // Show the resulting filename, so the extension is
                    // never a surprise after the fact.
                    <p className="dialog-preview">
                        Creates <code>{`${name.trim()}.${extension}`}</code>
                    </p>
                )}

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
