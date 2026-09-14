/**
 * Everything an editor needs to know about the user's settings, and
 * the one place that knows how to apply them to a live `EditorView`.
 *
 * The page used to own this: it held an `EditorView` and ran seven
 * near-identical effects, one per compartment, each dispatching a
 * reconfigure when its own dependency changed. That works for exactly
 * one editor. With a second on screen the page has to fan every one of
 * those effects out over a collection of views, and forgetting one
 * leaves a pane silently stale — which is what the split-pane work ran
 * into.
 *
 * So the dependency is inverted here. Settings are data
 * ({@link EditorConfiguration}); the mapping from that data to
 * CodeMirror extensions lives in {@link SYNCED}, once; and each editor
 * applies its own configuration. Adding a setting means adding one row
 * to that table — not another effect in another component — and mount
 * and reconfigure read the same row, so they cannot drift apart.
 */

import type { Compartment, Extension, StateEffect } from "@codemirror/state";
import { diagnosticsVisibilityEffect } from "./Diagnostics";
import { lineNumbersCompartment, lineNumbersExtensionForMode } from "./LineNumbers";
import type { ImageSourceResolver, LinkOpener } from "./LivePreview";
import { modalCompartment, modalExtensionForMode } from "./modalMode";
import { moonstoneThemeForMode, themeCompartment } from "./moonstoneTheme";
import { referencesCompartment, referencesExtension } from "./References";
import { spellCheckCompartment, spellCheckExtensionForEnabled } from "./SpellCheck";
import { previewCompartment, previewExtensionForMode } from "./viewMode";
import type {
    LineNumberMode,
    ModalMode,
    Reference,
    Theme,
    ViewMode,
} from "../../../shared/types";

/**
 * The live settings one editor runs under.
 *
 * Every field is something the user can change while the editor stays
 * mounted; nothing here is "initial only". The two resolvers are
 * per-document rather than per-preference, but they reconfigure
 * through the same compartment as the view mode, so they belong in the
 * same object.
 */
export interface EditorConfiguration {
    readonly viewMode: ViewMode;
    readonly modalMode: ModalMode;
    readonly spellCheckEnabled: boolean;
    readonly theme: Theme;
    readonly lineNumberMode: LineNumberMode;
    readonly showDiagnostics: boolean;
    readonly references: readonly Reference[];
    /**
     * Resolves `\includegraphics` paths to loadable URLs. Omitted,
     * images render as placeholders.
     */
    readonly resolveImageSource?: ImageSourceResolver | undefined;
    /**
     * Opens `\url`/`\href` targets. Omitted, link chips render without
     * an open affordance.
     */
    readonly openLink?: LinkOpener | undefined;
}

/**
 * One compartment and the rule for keeping it in step with the
 * configuration.
 */
interface SyncedCompartment {
    /** The compartment this row owns. */
    readonly compartment: Compartment;
    /** Builds the extension this configuration calls for. */
    readonly build: (configuration: EditorConfiguration) => Extension;
    /**
     * Whether a change between two configurations affects this row.
     *
     * Kept explicit rather than deep-comparing the whole object: the
     * point of the table is that a theme change costs one dispatch,
     * not six.
     */
    readonly hasChanged: (previous: EditorConfiguration, next: EditorConfiguration) => boolean;
}

/**
 * Every compartment an editor keeps in step with its configuration.
 *
 * Order is not significant — each row reconfigures an independent
 * compartment — except that the extension list built from it at mount
 * puts the modal keymap first (see {@link editorExtensions}).
 */
const SYNCED: readonly SyncedCompartment[] = [
    {
        compartment: previewCompartment,
        build: (configuration) =>
            previewExtensionForMode(
                configuration.viewMode,
                configuration.resolveImageSource,
                configuration.openLink,
            ),
        hasChanged: (previous, next) =>
            previous.viewMode !== next.viewMode ||
            previous.resolveImageSource !== next.resolveImageSource ||
            previous.openLink !== next.openLink,
    },
    {
        compartment: modalCompartment,
        build: (configuration) => modalExtensionForMode(configuration.modalMode),
        hasChanged: (previous, next) => previous.modalMode !== next.modalMode,
    },
    {
        compartment: referencesCompartment,
        build: (configuration) => referencesExtension(configuration.references),
        hasChanged: (previous, next) => previous.references !== next.references,
    },
    {
        // Line numbering follows both its own setting and the modal
        // mode, since "mixed" is defined in terms of the modal editor's
        // insert state.
        compartment: lineNumbersCompartment,
        build: (configuration) =>
            lineNumbersExtensionForMode(configuration.lineNumberMode, configuration.modalMode),
        hasChanged: (previous, next) =>
            previous.lineNumberMode !== next.lineNumberMode ||
            previous.modalMode !== next.modalMode,
    },
    {
        // The CSS variables restyle themselves, but CodeMirror's `dark`
        // flag lives in the theme extension and decides which half of
        // every `&dark`/`&light` rule applies — so the palette has to be
        // reconfigured, not just repainted.
        compartment: themeCompartment,
        build: (configuration) => moonstoneThemeForMode(configuration.theme),
        hasChanged: (previous, next) => previous.theme !== next.theme,
    },
    {
        compartment: spellCheckCompartment,
        build: (configuration) =>
            spellCheckExtensionForEnabled(configuration.spellCheckEnabled),
        hasChanged: (previous, next) => previous.spellCheckEnabled !== next.spellCheckEnabled,
    },
];

/**
 * Builds the compartment-wrapped extensions an editor mounts with.
 *
 * The modal keymap comes first because Vim and Helix register
 * high-precedence keymaps that must see keys before the default
 * bindings do.
 *
 * @param configuration - The settings to start under.
 * @returns The extensions, ready to hand to an `EditorView`.
 */
export function editorExtensions(configuration: EditorConfiguration): Extension[] {
    const modal = SYNCED.find((synced) => synced.compartment === modalCompartment);
    const rest = SYNCED.filter((synced) => synced.compartment !== modalCompartment);

    // `modal` is a member of SYNCED by construction; the guard keeps
    // the types honest rather than describing a reachable state.
    if (!modal) throw new Error("The modal compartment is missing from SYNCED");

    return [modal, ...rest].map((synced) => synced.compartment.of(synced.build(configuration)));
}

/**
 * Works out what to dispatch to move an editor from one configuration
 * to another.
 *
 * Pure, so the mapping can be tested without mounting an editor.
 *
 * @param previous - The configuration currently applied.
 * @param next - The configuration to apply.
 * @returns The effects to dispatch; empty when nothing relevant
 *   changed, in which case the caller should not dispatch at all.
 */
export function reconfigurationEffects(
    previous: EditorConfiguration,
    next: EditorConfiguration,
): readonly StateEffect<unknown>[] {
    const effects: StateEffect<unknown>[] = SYNCED.filter((synced) =>
        synced.hasChanged(previous, next),
    ).map((synced) => synced.compartment.reconfigure(synced.build(next)));

    // Diagnostics visibility is a state field, not a compartment, so it
    // cannot be reconfigured — but it rides along in the same dispatch.
    if (previous.showDiagnostics !== next.showDiagnostics) {
        effects.push(diagnosticsVisibilityEffect(next.showDiagnostics));
    }

    return effects;
}
