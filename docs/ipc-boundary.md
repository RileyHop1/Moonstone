# The IPC boundary

How responses from the Rust backend become values the frontend trusts.

Source: `src/shared/parseBackend.ts`, `src/shared/tauri.ts`
Tests: `src/test/parseBackend.test.ts`

## The problem

```ts
const data = await invoke<T>(command, args);
return { ok: true, data };
```

`invoke<T>` is an **unchecked cast**. Writing a type parameter at the
call site tells TypeScript what to expect and tells the runtime
nothing. Every response — file trees, project lists, bibliographies —
was trusted to match its declaration because someone had typed it out.

The failure mode is what makes this worth fixing rather than noting. A
malformed or version-skewed response does not fail at the boundary it
crossed; it fails later, as `undefined.children` deep inside a React
render, with a stack trace pointing at a component that did nothing
wrong.

## The shape now

`invokeCommand` takes a parser alongside the command name:

```ts
export function listProjectFiles(projectPath: string): Promise<Result<FileNode>> {
  return invokeCommand("list_project_files", parseFileNode, { projectPath });
}
```

Each parser returns `null` for anything it does not recognise, and
`invokeCommand` turns that into an ordinary `Result` failure with a
message naming the command. The page shows it the same way it shows any
other backend error — no new error path, no crash.

These are hand-written predicates rather than a schema library. The
shapes are few and small, and `Result` already existed to carry the
failure, so a dependency would have bought nothing.

## Decisions worth knowing

- **One bad entry fails the whole list.** `parseArrayOf` rejects rather
  than skipping. A silently shortened file tree or project list is
  harder to notice — and much harder to explain — than an error.

- **Unknown fields are dropped, not rejected.** A newer backend adding
  a field must not break an older frontend.

- **`parseNothing` is the one parser whose `null` means success.**
  Tauri sends `null` for a command returning `()`, so there is nothing
  to validate; `invokeCommand` special-cases it.

- **`StoredSettings` is deliberately permissive.** Every field is
  `unknown` and the parser checks only that the response is an object.
  Narrowing is `normalizeSettings`'s job, and a settings file written by
  an older build should load with the fields it does have rather than
  be rejected wholesale. This is also why `StoredSettings` declares
  `unknown` rather than `string`/`boolean`: typing it optimistically is
  what made an autofix delete a real guard once.
