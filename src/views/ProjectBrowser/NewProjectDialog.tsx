/**
 * Modal dialog for creating a project: a name plus the template the
 * project starts from.
 *
 * It does not reuse `NameDialog` because the template choice is the
 * larger half of the dialog — the shared modal stays a single-input
 * prompt rather than growing a second job.
 */

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { validateEntryName } from "../../shared/nameValidation";
import { createProject, listTemplates } from "../../shared/tauri";
import { assertNever } from "../../shared/types";
import type { LoadState, ProjectInfo, TemplateInfo } from "../../shared/types";

/** Props for {@link NewProjectDialog}. */
export interface NewProjectDialogProps {
    /** Called with the created project's metadata on success. */
    readonly onCreated: (project: ProjectInfo) => void;
    /** Called when the user dismisses the dialog. */
    readonly onCancel: () => void;
}

/**
 * Describes how many files a template lays down.
 *
 * @param fileCount - Number of files the template creates.
 * @returns A short label such as "3 files".
 */
function describeFileCount(fileCount: number): string {
    return fileCount === 1 ? "1 file" : `${fileCount} files`;
}

/**
 * Renders the new-project modal: name field, template picker, and
 * inline errors from validation or the backend.
 *
 * @param props - Success and cancel callbacks.
 * @returns The dialog element.
 */
export function NewProjectDialog({ onCreated, onCancel }: NewProjectDialogProps) {
    const [templates, setTemplates] = useState<LoadState<readonly TemplateInfo[]>>({
        status: "loading",
    });
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Templates are fixed for the life of the app, so this runs once
    // per dialog and needs no refresh path.
    useEffect(() => {
        void (async () => {
            const result = await listTemplates();

            if (!result.ok) {
                setTemplates({ status: "error", message: result.error });
                return;
            }

            setTemplates({ status: "ready", data: result.data });
            // Selecting the first template up front means Create is
            // always a valid action once a name is typed.
            setSelectedTemplateId(result.data[0]?.id ?? null);
        })();
    }, []);

    /**
     * Validates the name and asks the backend to create the project.
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

        if (!selectedTemplateId) {
            setErrorMessage("Pick a template to start from");
            return;
        }

        setIsSubmitting(true);
        const result = await createProject(trimmed, selectedTemplateId);
        setIsSubmitting(false);

        if (!result.ok) {
            setErrorMessage(result.error);
            return;
        }

        onCreated(result.data);
    }

    /**
     * Renders the template picker for the current load state.
     *
     * @returns The picker, or a loading/error placeholder.
     */
    function renderTemplates() {
        switch (templates.status) {
            case "loading":
                return <p className="dialog-hint">Loading templates…</p>;

            case "error":
                return <p className="dialog-error">{templates.message}</p>;

            case "ready":
                return (
                    <div className="template-list" role="radiogroup" aria-label="Template">
                        {templates.data.map((template) => (
                            <button
                                key={template.id}
                                type="button"
                                role="radio"
                                aria-checked={template.id === selectedTemplateId}
                                className={
                                    template.id === selectedTemplateId
                                        ? "template-option template-option-selected"
                                        : "template-option"
                                }
                                onClick={() => setSelectedTemplateId(template.id)}
                            >
                                <span className="template-option-header">
                                    <span className="template-option-name">{template.name}</span>
                                    <span className="template-option-count">
                                        {describeFileCount(template.fileCount)}
                                    </span>
                                </span>
                                <span className="template-option-description">
                                    {template.description}
                                </span>
                            </button>
                        ))}
                    </div>
                );

            default:
                return assertNever(templates);
        }
    }

    // Creating needs a template, so the button stays disabled until one
    // is selectable rather than failing on submit.
    const canSubmit =
        templates.status === "ready" && selectedTemplateId !== null && !isSubmitting;

    return (
        <div className="dialog-overlay" onClick={onCancel}>
            {/* Stop clicks inside the panel from dismissing the dialog. */}
            <form
                className="dialog-panel dialog-panel-wide"
                onClick={(event) => event.stopPropagation()}
                onSubmit={handleSubmit}
            >
                <h2 className="dialog-title">New Project</h2>

                <input
                    className="dialog-input"
                    type="text"
                    placeholder="Project name"
                    value={name}
                    autoFocus
                    onChange={(event) => {
                        setName(event.target.value);
                        setErrorMessage(null);
                    }}
                />

                <span className="dialog-field-label">Start from</span>
                {renderTemplates()}

                {errorMessage && <p className="dialog-error">{errorMessage}</p>}

                <div className="dialog-buttons">
                    <button type="button" className="dialog-button" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="dialog-button dialog-button-primary"
                        disabled={!canSubmit}
                    >
                        {isSubmitting ? "Working…" : "Create"}
                    </button>
                </div>
            </form>
        </div>
    );
}
