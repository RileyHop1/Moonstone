# PDF compilation

Turning a project into a PDF, using [Tectonic](https://tectonic-typesetting.github.io/)
as the TeX engine.

> **Status:** the compile loop is complete. Compiling builds the
> project's root document, on demand or on every save; problems
> (undefined references and citations included) are listed under the
> editor and jump to their line; SyncTeX jumps both ways between source
> and PDF; and **Export PDF…** saves a copy anywhere.

## Why Tectonic

A self-contained TeX engine written in Rust, forked from XeTeX. It
fetches the support files a document actually needs from a TeXLive
bundle and caches them, so a user installs Moonstone and compiles —
there is no separate multi-gigabyte TeX distribution to install first.
That is the whole reason it was chosen over shelling out to a system
`pdflatex`.

## The decision: sidecar, not the crate

Tectonic publishes both a Rust library and a CLI. The spike was run to
choose between them, because the choice lands on the release pipeline
rather than on the app code.

**Ship the CLI as a Tauri sidecar (`externalBin`).** The crate is not
viable without rebuilding the release matrix around it.

### The evidence

**The `tectonic` crate needs five system C libraries.** It pulls in
seven bridge crates:

| Bridge crate                 | Native dependency                              |
| ---------------------------- | ---------------------------------------------- |
| `tectonic_bridge_harfbuzz`   | **vendored** (`external-harfbuzz` is opt-_in_) |
| `tectonic_bridge_flate`      | pure Rust (`zlib-rs`)                          |
| `tectonic_bridge_png`        | system `libpng`, via `pkg-config`              |
| `tectonic_bridge_freetype2`  | system, via `pkg-config`                       |
| `tectonic_bridge_graphite2`  | system, via `pkg-config`                       |
| `tectonic_bridge_icu`        | system, via `pkg-config`                       |
| `tectonic_bridge_fontconfig` | system, via `pkg-config`                       |

Only harfbuzz has a vendoring toggle. The other five expose **no cargo
features at all**, so there is no source-build fallback to turn on.

Building `tectonic = "0.17"` on this Windows machine fails in
`tectonic_bridge_png`'s build script:

```
called `Result::unwrap()` on an `Err` value: Could not run
`pkg-config --libs --cflags libpng`
The pkg-config command could not be found.
```

Windows alone would be solvable — vcpkg, a static triplet, and a long
CI step, which is what upstream does for its own builds.

**The macOS Intel target is what settles it.** `release.yml` builds four
targets, and one of them cross-compiles `x86_64-apple-darwin` from an
`macos-latest` (Apple Silicon) runner. Homebrew installs libraries for
the host architecture; it cannot have arm64 and x86_64 versions of
libpng, freetype, graphite2 and icu present at once. Cross-compiling
vendored-C dependencies from an arm64 host is exactly the case the
crate has no answer for.

> Honest scope: the Windows failure above was reproduced locally. The
> macOS cross-compile was **not** tested — there is no Apple hardware
> here. It is an argument from how Homebrew and `pkg-config` work, not
> a measurement. If someone later finds a way to make it build, the
> trade-off is worth revisiting; the parsing layer in D2 is the only
> thing that would be thrown away.

**The sidecar has prebuilt binaries for every target we ship.** From
the `tectonic@0.17.0` release:

| Release target        | Asset                                             | Size    |
| --------------------- | ------------------------------------------------- | ------- |
| Windows               | `tectonic-0.17.0-x86_64-pc-windows-msvc.zip`      | 20.1 MB |
| macOS (Apple Silicon) | `tectonic-0.17.0-aarch64-apple-darwin.tar.gz`     | 20.7 MB |
| macOS (Intel)         | `tectonic-0.17.0-x86_64-apple-darwin.tar.gz`      | 20.8 MB |
| Linux                 | `tectonic-0.17.0-x86_64-unknown-linux-gnu.tar.gz` | 21.7 MB |

`cargo build` is untouched, so the release matrix keeps working exactly
as it does today. The cost is the download size — roughly **20 MB
compressed per installer**, 51 MB on disk for the Windows executable —
and parsing CLI output instead of calling an API. That second cost is
much smaller than it looks; see "Errors" below.

## What the spike established

### All ten bundled templates compile

Every template in `src-tauri/templates/` builds a PDF, with SyncTeX:

| Template     | Warm compile | Template      | Warm compile |
| ------------ | ------------ | ------------- | ------------ |
| article      | ~1 s         | homework      | ~2 s         |
| blank        | ~1 s         | lecture-notes | ~1 s         |
| book         | ~3 s         | presentation  | ~1.4 s       |
| cover-letter | ~1 s         | report        | ~1 s         |
| cv           | ~2 s         | thesis        | ~0.7 s       |

No template needed changing. The `inputenc`/`fontenc` calls that looked
like a risk — they are pdfTeX-era and redundant under XeTeX — are
accepted without complaint.

### First compile needs the network; after that it does not

Tectonic downloads support files on demand and caches them:

| Platform | Cache location                                  |
| -------- | ----------------------------------------------- |
| Windows  | `%LOCALAPPDATA%\TectonicProject\Tectonic\cache` |
| macOS    | `~/Library/Caches/Tectonic`                     |
| Linux    | `$XDG_CACHE_HOME/Tectonic`                      |

The numbers that matter for first-run experience:

- **First compile ever: 79 s**, almost all of it downloading.
- **`presentation` (beamer): 29 s** the first time, 1.4 s after — beamer
  pulls a large package set of its own.
- Cache after all ten templates: **47 MB**.
- `--only-cached` (`-C`) forces offline. A previously-compiled document
  builds fine offline; one needing an unfetched package fails with a
  TeX "file not found" rather than a network error.

**This is a first-run problem D3 has to design for, not ignore.** A
79-second wait with no explanation on the first save would read as a
hang. Warming the cache during onboarding, or at minimum a progress
message naming what is being fetched, belongs in that stage.

### SyncTeX works

`--synctex` produced `main.synctex.gz` for all ten templates, so
error-to-source mapping is available.

### Errors come out already normalised

This is what makes the sidecar's "you have to parse text" cost small.
Tectonic emits a one-line diagnostic per problem on **stderr**, ahead
of the raw XeTeX log, in a fixed shape:

```
error: <file>:<line>: <message>
```

A document with three planted faults produced exactly three, with
correct line numbers:

```
error: broken.tex:11: LaTeX Error: \begin{itemize} on input line 8 ended by \end{enumerate}.
error: broken.tex:13: Undefined control sequence
error: broken.tex:16: Missing $ inserted
```

Four details D2 must handle:

1. **`-Z continue-on-errors` is required to get more than the first
   one.** By default the engine halts at the first error, which would
   make the diagnostics panel a one-item list.
2. **With that flag, a PDF is still written.** The user gets a
   best-effort render _and_ the error list, which is a far better
   failure mode than a blank pane.
3. **With that flag the exit code is 0 even when errors were issued**,
   so the exit code is not the success signal — the parsed diagnostics
   are. (Without it, a failed compile exits 1.)
4. **Diagnostics repeat when TeX reruns** (a changed `.aux` triggers a
   second pass), so they must be deduplicated on file + line + message.

On Windows, stderr also carries a harmless
`Fontconfig error: Cannot load default config file` on every run. It is
not a compile failure — all ten templates emit it and all ten
succeed — and the parser must not report it.

### Artifacts can be contained

`-o <dir>` puts every output in that directory and leaves the source
tree untouched. Combined with `build_directory_node` already skipping
dot-prefixed entries ([file_manager.rs:690](../src-tauri/src/file_manager.rs#L690)),
compiling into `.moonstone-build/` keeps `.aux`, `.log` and the rest out
of the file browser with no filtering rules to maintain.

Two other flags worth knowing:

- `--untrusted` disables `\write18` and other known-insecure features.
  Projects are files on the user's disk that may have come from
  anywhere, so this is the default D2 should take, with shell-escape an
  explicit opt-in if it is ever wanted.
- `-Z search-path` is how multi-directory projects (`book`, `thesis`)
  would resolve includes if the working directory is not enough.

## How it is wired

Source: `src-tauri/src/compiler.rs`, `scripts/fetchTectonic.mjs`
Tests: the `compiler_tests` module, `src/test/parseBackend.test.ts`

**The engine is fetched, not committed.** `npm run tectonic:fetch`
downloads the binary for the host target into `src-tauri/binaries/`,
where Tauri's `externalBin` expects it; the directory is gitignored.
Pass `--target` to fetch a different platform's build for a cross
compile. Two portability details are baked into that script and both
were found the hard way: on Windows it calls **System32's bsdtar by
absolute path**, because a Git Bash shell shadows it with GNU tar which
cannot read a zip at all; and it names the archive relative to a `cwd`,
because GNU tar reads `C:\…` as a remote `host:path` and tries to open
a network connection.

**The webview cannot run anything.** `tauri-plugin-shell` is registered
so Rust can start the sidecar, but no shell permission is granted in
`capabilities/default.json`, so the ability to start a process stays on
the backend side of the IPC boundary.

**`compile_project` takes the project path and a main file relative to
it**, validates both against the Moonstone root, and runs the engine
with the flags in `engine_arguments` — every one of which is
load-bearing and tested, because each is easy to drop by accident.
Output lands in `.moonstone-build/`; the PDF is copied out beside the
source, because it is the product rather than the noise, and because
the file browser hides dot-directories.

A document that fails to typeset is **not** a command failure. It comes
back as `Ok` with diagnostics, usually alongside a best-effort PDF. The
`Err` case is reserved for not being able to compile at all: a missing
file, an engine that would not start, or a compile that exceeded the
180-second timeout — which exists because a runaway macro makes TeX
spin forever, and compile-on-save would leave it burning a core.

### One path, spelled one way

Compiling was the first thing to ask "is this open file inside this
open project?", and the answer came back **no** for a file that plainly
was. `list_project_files` canonicalizes through `ensure_within_root`,
which on Windows yields `\\?\C:\…`; `list_projects` joins onto the
plain root and does not. The same directory reached the frontend under
two names.

Every path that crosses the boundary now goes through
`paths::to_display_string`, which drops the extended-length prefix.
Nothing is lost — the prefix only raises the 260-character limit, and
every command canonicalizes again on the way in — and the paths stay
readable, which matters because they are shown in tooltips.

`publish_pdf` had been missed, and returned the `\\?\` form. That went
unnoticed until the preview had to find "the pane already showing this
PDF" by comparing paths; it is now converted too, and a Rust test
pins it.

## Viewing the PDF

`PaneDocument` is a union — `{kind: "text", …}` or `{kind: "pdf", …}`
(`EditorPane.tsx`). A PDF pane renders `PdfViewer`, which draws the
document with **pdf.js** (`pdfjs-dist`, pinned) from the asset-protocol
URL. `openFileInPane` skips `read_file` for a `.pdf` (that command
refuses non-text files — the old "can't open a PDF" error), so
double-clicking a PDF in the file browser, dropping it on a pane and
dropping it on a pane edge all go through that one branch.

### Why pdf.js, on every platform

The first version was an `<iframe>` leaning on the webview's built-in
viewer. That works in WebView2 and WKWebView, but **WebKitGTK has no
PDF viewer**, so on Linux the pane was blank. pdf.js fixes that, and
using it everywhere rather than only on Linux buys three more things:
one code path to test; drops onto the PDF work (an iframe swallowed the
drag events, so the pane's handlers never saw them); and a recompile
can swap the document in place, keeping zoom and scroll position.

Details that are load-bearing:

- **Loading order.** `pdf_viewer.mjs` reads the core library from
  `globalThis.pdfjsLib` as it is evaluated, so `loadPdfJs` imports the
  core, publishes it, then imports the viewer. Both are dynamic imports:
  pdf.js (~0.7 MB of JS plus a 1.3 MB worker) never touches startup.
- **The worker** is imported with Vite's `?url`, so it ships in
  `dist/assets` and works offline.
- **Annotations are disabled.** A link in the PDF would otherwise
  navigate the whole app window away from Moonstone.
- **The vertical scrollbar is always reserved** (`overflow-y: scroll`).
  Found in the real app: a page that only just overflowed at fit-width
  made the scrollbar appear, which narrowed the pane, which re-fit the
  page smaller, which removed the scrollbar — forever, snapping the zoom
  back under the reader. Headless Chromium hides scrollbars, so the spec
  that guards this runs in a `chromium-scrollbars` Playwright project.

Zoom is three buttons (−, +, Fit width) above the pages; the default is
fit-width, re-applied when the pane's width changes.

After a compile, if **Open PDF after compiling** is on, the PDF is
shown to the right of the source: a pane already showing it is
reloaded, otherwise one is split off. Focus goes back to the source.

**Reloading.** A recompile rewrites the same file, so the pane's
`version` is bumped and goes into the URL as `?v=` (the asset protocol
resolves by path and ignores the query). A new URL makes `PdfViewer`
load the new document into the **same** viewer, remember the zoom and
scroll offset, and restore both on pdf.js's `pagesinit`. The component
is not remounted, which is what makes keeping the reader's place
possible.

**Testing.** jsdom has no canvas or workers, so the jsdom suites stub
`PdfViewer`. The real viewer runs in `pdfViewer.browser.spec.ts` against
committed fixtures (`src/test/browser/fixtures/`), in Chromium **and
WebKit** — the closest engine to Linux's WebKitGTK that Playwright
offers. CI installs both. Linux itself has still not been run by hand.

## Exporting

**Export PDF…** copies the PDF out of the project. `export_pdf` takes
only the _source_, checks it is an existing `.pdf` inside the root
(`validate_export_source`), and then opens the save dialog **from
Rust** with `tauri-plugin-dialog`. The destination therefore only ever
comes from a native dialog the user answered. A command that took the
destination as an argument would let the webview overwrite any file
the user can write to. The webview has no dialog permission at all.

The dialog's callback is bridged through a `oneshot` channel rather
than using the blocking API, which would park an async worker for as
long as the dialog is open. Cancelling returns `exportedTo: null`,
which the page treats as "say nothing".

From a document, the PDF exported is `compiledPdfPath` — the stem at
the project root, mirroring `publish_pdf`, which puts even a
subdirectory document's PDF there.

## The compile loop

Source: `src/views/ProjectPage/compileLoop.ts` (pure),
`useCompileLoop.ts`, `ProblemsPanel.tsx`, `src-tauri/src/synctex.rs`,
`project_settings.rs`. Tests: `compileLoop.test.ts`,
`useCompileLoop.test.tsx`, the "compile loop" block of
`ProjectPage.test.tsx`, the SyncTeX specs in `pdfViewer.browser.spec.ts`,
and the Rust `compiler_tests` / `synctex_tests`.

### The root document

Compiling builds one file, whatever pane is active. `resolveRootDocument`
picks, in order: the active file's `% !TEX root = …` comment (relative to
that file); the main document stored with the project; the active file
if it has `\documentclass`; `<project>.tex`; `main.tex`; and finally the
active file anyway, so a chapter with no way home still reports why it
failed.

The stored choice lives in `<project>/.moonstone.json` (dot-prefixed, so
the file browser hides it). **Set as Main Document** in a `.tex` file's
context menu writes it; the browser badges the effective main file; a
rename or move of it is followed. A stored file that has since been
deleted is simply skipped. The PDF, Export and the problem list all
follow the root.

### Problems

Every compile's diagnostics go to a panel under the editor, summed up
("2 errors, 1 warning") in the toolbar status. Clicking one opens its
file — never over a PDF pane — and puts the cursor on the line.
`resolveDiagnosticFile` handles TeX's spelling: names are relative to the
root document's folder and may lack `.tex`.

**Undefined references and citations** come from the `.log`, not stderr.
The warning names a line but not a file, so `parse_log_warnings` tracks
TeX's `(file … )` nesting to find it, after rejoining lines TeX wrapped
at 79 columns. Tectonic writes included names as `\input` spelled them
(`(chapters/one`), the same as stderr.

### SyncTeX

`synctex.rs` reads `.moonstone-build/<stem>.synctex.gz` (gzip, via
`flate2`). The trap worth knowing: **a line box is tagged with where TeX
broke the paragraph**, often the next file, so only the points inside it
(glue, kerns) carry trustworthy lines. PDF → source finds the printed
line clicked from the boxes, then the nearest point on it; source → PDF
takes the first point from the nearest line at or after the cursor that
produced output. Units: scaled points, origin at the page's top-left,
65781.76 sp per PDF point.

In the viewer, a **double-click** jumps to the source; **Show in PDF**
(toolbar, File menu, `Ctrl+Alt+J`) scrolls the PDF to the cursor's line
and flashes a band across it. Getting the click right uncovered a real
bug: the app's `box-sizing: border-box` reset pulled pdf.js's page border
inside the page, squashing every PDF by 18px.

### Compile on save

On by default (Settings → General). `useCompileLoop` guarantees one
compile at a time: a request mid-compile queues exactly one catch-up
compile, and saves within 500 ms collapse into one. A save-triggered
compile only reloads a PDF pane already open; only a Compile click opens
one. A Compile click saves every dirty pane first, since the edits may be
in any file the root pulls in.

**The first compile** is answered with progress: the backend streams the
engine's `note: downloading <file>` lines as `compile-progress` events,
and the toolbar names each file ("Downloading LaTeX packages (first
compile only): latex.ltx"). A cold cache produced 247 of them.

### The preview is no longer more permissive than LaTeX

A math-only command in running text (`\alpha` outside math) compiles to
"Missing $ inserted". `findTextModeMath` finds them — outside `$…$`,
`\(…\)`, `\[…\]` and math environments, in the body only, since the
preamble's macro definitions are full of maths. The preview draws their
glyphs in the error colour with a wavy underline, and a CodeMirror linter
explains the fix. Symbols LaTeX accepts in text (`\ldots`, `\S`, …) are
exempt.

## Still to do

- **A smoke test on real Linux.** The WebKit spec is a stand-in for
  WebKitGTK, not a replacement.
- **Verifying the sidecar on the real matrix.** It runs in dev on
  Windows. No release has been built with `externalBin` wired in, so
  `release.yml` still needs a `npm run tectonic:fetch --target …` step
  per matrix entry, and that has not been exercised.
