/**
 * The list of problems the last compile reported, under the editor.
 * Clicking one jumps to its line.
 */

import type { CompileDiagnostic } from "../../shared/types";
import { summarizeDiagnostics } from "./compileLoop";

/** Props for {@link ProblemsPanel}. */
export interface ProblemsPanelProps {
    readonly diagnostics: readonly CompileDiagnostic[];
    /** Called when the user picks a problem with a location. */
    readonly onSelect: (diagnostic: CompileDiagnostic) => void;
    readonly onClose: () => void;
}

/**
 * Renders the problems panel.
 *
 * @param props - The problems and what to do with them.
 * @returns The panel element.
 */
export function ProblemsPanel({ diagnostics, onSelect, onClose }: ProblemsPanelProps) {
    return (
        <section className="problems-panel" aria-label="Compile problems">
            <header className="problems-header">
                <span>{summarizeDiagnostics(diagnostics)}</span>
                <button
                    type="button"
                    className="problems-close"
                    aria-label="Hide problems"
                    title="Hide problems"
                    onClick={onClose}
                >
                    ✕
                </button>
            </header>
            <ul className="problems-list">
                {diagnostics.map((diagnostic, index) => (
                    // Diagnostics are deduplicated, but two can still share
                    // a message; the index is stable for one compile's list.
                    <li key={index}>
                        <button
                            type="button"
                            className={`problem problem-${diagnostic.severity}`}
                            disabled={diagnostic.file === ""}
                            onClick={() => onSelect(diagnostic)}
                        >
                            <span
                                className="problem-severity"
                                aria-label={diagnostic.severity}
                            />
                            <span className="problem-message">{diagnostic.message}</span>
                            <span className="problem-location">
                                {diagnostic.line === null
                                    ? diagnostic.file
                                    : `${diagnostic.file}:${diagnostic.line}`}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
