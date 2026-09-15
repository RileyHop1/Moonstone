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
import type { EditorProfile } from "./editorProfile";
import { languageCompartment, languageExtensionForProfile } from "./language";
import { lineNumbersCompartment, lineNumbersExtensionForMode } from "./LineNumbers";
import type { ImageSourceResolver, LinkOpener } from "./LivePreview";
import { modalCompartment, modalExtensionForMode } from "./modalMode";
import { moonstoneThemeForMode, themeCompartment } from "./moonstoneTheme";
import { referencesCompartment, referencesExtension } from "./References";
import { spellCheckCompartment, spellCheckExtensionForEnabled } from "./SpellCheck";
import {
    frozenCompartment,
    frozenExtension,
    previewCompartment,
    previewExtensionForMode,
} from "./viewMode";
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
     * What the editor should do with this file, decided by its
     * extension. Unlike the rest of this object it is per-*file* rather
     * than per-preference, so two panes showing different file types
     * run under different configurations even though the user's
     * settings are the same.
     */
    readonly profile: EditorProfile;
    /**
     * True for a pane the user is not working in: its preview holds
     * the look it last produced instead of re-rendering as the cursor
     * moves. Per-*pane* rather than per-file or per-preference — two
     * panes on the same file differ here.
     */
    readonly isFrozen: boolean;
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
    /**
     * True for a row that must sit *after* the editor's base setup in
     * precedence order (see {@link editorExtensions}).
     *
     * Precedence is part of the mapping, not an accident of where the
     * caller happened to concatenate things: the language's
     * `autoCloseTags` input handler has to see input *after*
     * basicSetup's `closeBrackets`, which is where it sat before it
     * moved into a compartment.
     */
    readonly afterBase?: boolean;
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
        // The profile has a veto here: the user's view mode says what
        // they want to see, the profile says what this file can
        // support, and a `.csv` renders no maths in any mode.
        compartment: previewCompartment,
        build: (configuration) =>
            previewExtensionForMode(configuration.viewMode, {
                resolveImageSource: configuration.resolveImageSource,
                openLink: configuration.openLink,
                renderPreview: configuration.profile.usesPreview,
            }),
        hasChanged: (previous, next) =>
            previous.viewMode !== next.viewMode ||
            previous.resolveImageSource !== next.resolveImageSource ||
            previous.openLink !== next.openLink ||
            previous.profile.usesPreview !== next.profile.usesPreview,
    },
    {
        // Its own row, not folded into the preview's, because this is
        // the one that changes every time the user clicks a different
        // pane. See `frozenCompartment`.
        compartment: frozenCompartment,
        build: (configuration) => frozenExtension(configuration.isFrozen),
        hasChanged: (previous, next) => previous.isFrozen !== next.isFrozen,
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
    {
        // Compared by identity: profiles are module singletons, so two
        // `.tex` files share one object and changing file type is the
        // only thing that reconfigures the parser.
        compartment: languageCompartment,
        build: (configuration) => languageExtensionForProfile(configuration.profile),
        hasChanged: (previous, next) => previous.profile !== next.profile,
        afterBase: true,
    },
];

/**
 * Builds the compartment-wrapped extensions an editor mounts with,
 * around the editor's base setup.
 *
 * Ordering is the whole reason `base` is threaded through here rather
 * than concatenated by the caller. The modal keymap comes first because
 * Vim and Helix register high-precedence keymaps that must see keys
 * before the default bindings do; the language comes last for the
 * mirror-image reason (see {@link SyncedCompartment.afterBase}). Both
 * facts belong with the table that knows about them.
 *
 * @param configuration - The settings to start under.
 * @param base - The editor's foundational extensions, typically
 *   `basicSetup`.
 * @returns The extensions, in precedence order, ready to hand to an
 *   `EditorView`.
 */
export function editorExtensions(
    configuration: EditorConfiguration,
    base: Extension,
): Extension[] {
    const modal = SYNCED.find((synced) => synced.compartment === modalCompartment);

    // `modal` is a member of SYNCED by construction; the guard keeps
    // the types honest rather than describing a reachable state.
    if (!modal) throw new Error("The modal compartment is missing from SYNCED");

    const before = SYNCED.filter((synced) => synced !== modal && synced.afterBase !== true);
    const after = SYNCED.filter((synced) => synced.afterBase === true);

    const wrap = (synced: SyncedCompartment): Extension =>
        synced.compartment.of(synced.build(configuration));

    return [...[modal, ...before].map(wrap), base, ...after.map(wrap)];
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
