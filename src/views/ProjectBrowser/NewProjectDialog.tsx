/**
 * Modal dialog for naming and creating a new project, built on the
 * shared NameDialog.
 */

import { NameDialog } from "../../components/NameDialog";
import type { NameDialogResult } from "../../components/NameDialog";
import { createProject } from "../../shared/tauri";
import type { ProjectInfo } from "../../shared/types";

/** Props for {@link NewProjectDialog}. */
export interface NewProjectDialogProps {
    /** Called with the created project's metadata on success. */
    readonly onCreated: (project: ProjectInfo) => void;
    /** Called when the user dismisses the dialog. */
    readonly onCancel: () => void;
}

/**
 * Renders the new-project modal; creation errors from the backend are
 * shown inline by the underlying NameDialog.
 *
 * @param props - Success and cancel callbacks.
 * @returns The dialog element.
 */
export function NewProjectDialog({ onCreated, onCancel }: NewProjectDialogProps) {
    /**
     * Asks the backend to create the project.
     *
     * @param result - The validated name from the dialog.
     * @returns An inline error message, or null on success.
     */
    async function handleSubmit({ name }: NameDialogResult): Promise<string | null> {
        const result = await createProject(name);

        if (!result.ok) return result.error;

        onCreated(result.data);
        return null;
    }

    return (
        <NameDialog
            title="New Project"
            placeholder="Project name"
            submitLabel="Create"
            onSubmit={handleSubmit}
            onCancel={onCancel}
        />
    );
}
