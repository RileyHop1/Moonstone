# Moonstone — Design Document

> A modern, open-source LaTeX editor with real-time expression rendering.

**Status:** Early Prototyping  
**Platform:** Standalone Desktop App  
**License:** Open Source  

---

## Table of Contents

1. [Vision & Goals](#1-vision--goals)
2. [Target Users](#2-target-users)
3. [Core Features](#3-core-features)
4. [Architecture Overview](#4-architecture-overview)
5. [Editor Design](#5-editor-design)
6. [Real-Time Rendering Engine](#6-real-time-rendering-engine)
7. [UI/UX Principles](#7-uiux-principles)
8. [Tech Stack](#8-tech-stack)
9. [Roadmap](#9-roadmap)
10. [Contributing](#10-contributing)
11. [Out of Scope](#11-out-of-scope)

---

## 1. Vision & Goals

Moonstone aims to make LaTeX editing feel modern and intuitive — removing the friction that has historically made LaTeX inaccessible to new users while preserving the power that experts rely on.

The core inspiration is Obsidian's inline math preview, where expressions like `$$E = mc^2$$` are seamlessly replaced with their rendered output as you type. Moonstone extends this idea into a full-featured LaTeX editor built from the ground up for desktop.

**Primary Goals:**
- Real-time, inline rendering of LaTeX expressions without requiring a separate compile step
- A clean, distraction-free writing experience
- First-class support for full LaTeX documents (not just math snippets)
- Low barrier to entry for users new to LaTeX
- An extensible, contributor-friendly codebase

---

## 2. Target Users

**Students & Academics** writing papers, theses, or problem sets who want faster feedback than a traditional compile cycle offers.

**LaTeX Beginners** who are intimidated by the traditional workflow (write → compile → debug → repeat) and want to see results as they type.

**Power Users** who know LaTeX well but want a faster, more modern editing environment with better ergonomics.

---

## 3. Core Features

### 3.1 Inline Live Preview (MVP)
The defining feature of Moonstone. As the user types a LaTeX expression, it is rendered inline in real time. Clicking on a rendered expression reveals the raw source for editing, then snaps back to rendered form when focus moves away — mirroring Obsidian's behavior.

Supported expression types at launch:
- Inline math: `$...$`
- Display math: `$$...$$` and `\[ ... \]`
- Common environments: `equation`, `align`, `figure`, `table`

### 3.2 Full Document Support
Moonstone is not just a math snippet tool. It handles full `.tex` files, including preambles, custom commands, `\include`/`\input`, and multi-file projects.

### 3.3 Source / Preview Toggle
Users can switch between a raw source view and a full document preview at any time. The live preview mode is a hybrid: source text with inline-rendered expressions, not a completely compiled PDF view.

### 3.4 Error Highlighting
Syntax errors and undefined commands are highlighted in the editor in real time, with human-readable explanations rather than raw TeX error logs.

### 3.5 Command Autocomplete
An autocomplete system for LaTeX commands (`\frac`, `\begin{...}`, etc.) with documentation previews on hover.

### 3.6 Snippet Library
A built-in library of commonly used LaTeX snippets (matrices, equations, figure templates) that users can insert and customize.

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Moonstone App                             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     Frontend (TypeScript + Vite)          │   │
│  │                                                           │   │
│  │  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐  │   │
│  │  │   Editor     │──▶│ Parse Engine │──▶│   Renderer   │  │   │
│  │  │ (CodeMirror) │◀──│ (LaTeX AST)  │   │   (KaTeX /   │  │   │
│  │  └─────────────┘   └──────────────┘   │   MathJax)   │  │   │
│  │         │                             └──────────────┘  │   │
│  │         │  Tauri Commands                     │          │   │
│  └─────────┼─────────────────────────────────────┼──────────┘   │
│            ▼                                     ▼               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                      Backend (Rust)                       │   │
│  │                                                           │   │
│  │  ┌─────────────────┐       ┌──────────────────────────┐  │   │
│  │  │  file_manager   │◀──────│    project_manager        │  │   │
│  │  │  create_file()  │       │    Project { name, path,  │  │   │
│  │  │  create_dir()   │       │    files, dates }         │  │   │
│  │  └─────────────────┘       └──────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Editor Layer** — handles raw text input, cursor management, and syntax highlighting. Built on CodeMirror 6 for its extensibility and performance.

**Parse Engine** — listens to document changes and parses LaTeX incrementally, producing an AST (abstract syntax tree). Responsible for identifying expression boundaries, detecting errors, and passing renderable nodes to the renderer.

**Renderer** — takes parsed math nodes and renders them using KaTeX (primary, for performance) with MathJax as a fallback for complex expressions KaTeX doesn't support.

**Rust Backend** — all file system operations are handled in Rust and exposed to the frontend via Tauri's command API. The backend is split into two modules:

- `file_manager` — low-level file and directory operations. Creates `.tex` files and subdirectories, validates inputs, and emits Tauri events (`file-created`, `directory-created`) so the frontend can react to changes.
- `project_manager` — manages the concept of a project, which is a named root directory containing one or more `.tex` files. On creation, a project initialises its directory and seeds it with an initial file via `file_manager`. The `Project` struct tracks metadata including name, path, creation date, last modified date, and file count.

**Document Preview Panel** — an optional side panel showing a full rendered preview of the document, updated on save or on a configurable debounce interval.

---

## 5. Editor Design

### 5.1 Editing Modes

Moonstone uses a single-buffer model. There is one canonical document (the `.tex` source). The live preview is an overlay rendered on top of the source — not a separate representation.

- **Source Mode:** Plain LaTeX text with syntax highlighting. No inline rendering.
- **Live Preview Mode (default):** Rendered expressions appear in place of source text. Clicking any expression enters an inline edit state showing the source, exiting on blur or `Escape`.
- **Full Preview Mode:** A read-only rendered view of the complete document.

### 5.2 Inline Edit Interaction

When a user clicks a rendered expression in Live Preview Mode:
1. The rendered output is replaced with the raw source, highlighted and focused.
2. The cursor is placed at the nearest character to the click position.
3. The expression re-renders live as edits are made.
4. On blur (clicking elsewhere), or pressing `Escape`, the expression snaps back to rendered form.

### 5.3 Error States

If an expression contains an error and cannot be rendered, it is displayed with an error indicator (red underline or icon). Hovering shows a plain-language description of the error. The user can still edit the source freely.

---

## 6. Real-Time Rendering Engine

### 6.1 Incremental Parsing

Rather than re-parsing the entire document on each keystroke, the parse engine uses an incremental strategy: only the changed region and its surrounding context are re-evaluated. This keeps rendering latency low even for large documents.

### 6.2 Rendering Library

**KaTeX** is the primary rendering library due to its speed and self-contained nature (no server required). It covers the vast majority of mathematical expressions used in practice.

For expressions outside KaTeX's scope, Moonstone will attempt a fallback to **MathJax**, which has broader LaTeX coverage at the cost of some performance.

### 6.3 Debounce Strategy

Rendering is triggered on a short debounce (configurable, default ~150ms) after the user stops typing within an expression. This prevents excessive re-renders mid-keystroke while keeping feedback near-instant.

---

## 7. UI/UX Principles

- **Source of truth is always the `.tex` file.** Moonstone is an editor, not a format converter.
- **Minimal chrome.** The editor surface should dominate the screen. Toolbars and panels are collapsible.
- **Keyboard-first.** All core actions should be accessible without a mouse.
- **Progressive disclosure.** Advanced features (custom preambles, project settings, snippet editor) are accessible but not surfaced until needed.
- **Sensible defaults.** A new user should be able to open the app and start typing LaTeX with real-time preview working immediately, with zero configuration.

---

## 8. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Desktop Shell | Tauri | Lightweight alternative to Electron; native OS integration via Rust backend |
| Backend | Rust | Handles file I/O, parse-heavy operations, and performance-critical processing |
| Editor Component | CodeMirror 6 | Highly extensible, performant, good LaTeX language support |
| Math Rendering | KaTeX + MathJax fallback | KaTeX for speed; MathJax for coverage |
| Frontend | Vanilla TypeScript | No framework overhead; direct DOM control |
| Build Tool | Vite + Node | Fast HMR during development; Node for frontend tooling |

> **Note:** The tech stack is provisional during the prototyping phase. Decisions will be revisited before the first public release.

---

## 9. Roadmap

### Phase 1 — Prototype (Current)
- [ ] Basic Tauri app shell with a working text editor
- [ ] Inline rendering of `$...$` and `$$...$$` math expressions using KaTeX
- [ ] Click-to-edit interaction for rendered expressions
- [ ] Basic error display for invalid expressions

### Phase 2 — Alpha
- [ ] Full document parsing (preamble, environments, custom commands)
- [ ] Incremental parse engine
- [ ] Syntax highlighting and command autocomplete
- [ ] File open/save, recent files
- [ ] Full Preview Mode (side panel)
- [ ] Configurable theme (light/dark)

### Phase 3 — Beta
- [ ] Multi-file project support (`\input`, `\include`)
- [ ] Snippet library
- [ ] MathJax fallback rendering
- [ ] Export to PDF (via a bundled LaTeX engine or external tool)
- [ ] Settings UI
- [ ] Performance profiling and optimization pass

### Phase 4 — v1.0
- [ ] Plugin/extension API
- [ ] Cross-platform installers (macOS, Windows, Linux)
- [ ] Comprehensive documentation site
- [ ] Community snippet sharing

---

## 10. Contributing

Moonstone is open source and welcomes contributions. The project is in early prototyping, so the best ways to contribute right now are:

- **Share feedback** on the vision and feature priorities by opening a GitHub Issue
- **Prototype explorations** — if you want to spike on a specific component (e.g., the parse engine or a CodeMirror extension), open a draft PR and describe your approach
- **Documentation** — help flesh out this design doc or write user-facing docs

A formal `CONTRIBUTING.md` with code style guidelines, PR workflow, and a development setup guide will be added before the Alpha phase.

---

## 11. Out of Scope

The following are explicitly not goals for Moonstone, at least through v1.0:

- **Being a full TeX distribution.** Moonstone is an editor. It may integrate with a locally installed TeX distribution for PDF export, but it will not bundle one.
- **Cloud sync or collaboration.** Moonstone is a local desktop tool. Real-time multiplayer editing is not planned.
- **Supporting non-LaTeX markup.** Moonstone focuses exclusively on LaTeX/TeX. Markdown support is not planned.
- **A mobile app.** Desktop only for the foreseeable future.

---

*Last updated: February 2026*