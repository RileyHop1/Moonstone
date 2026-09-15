# Releasing

How a version of Moonstone becomes downloadable installers.

Workflows: `.github/workflows/release.yml`, `frontend.yml`, `rust.yml`
Tests: `src/test/version.test.ts`, `src/test/workflows.test.ts`

## Cutting a release

```bash
npm run version:set -- 0.2.0
git commit -am "Release 0.2.0"
# merge to main
```

That is the whole ritual. There is no tag to push and no button to
press: the workflow reads `package.json`, sees that `v0.2.0` has no tag
yet, and releases it.

## Why the version, not a tag

A tag-driven release needs someone to push the right tag at the right
commit, and the failure mode is a release that silently never happens —
or one built from a commit nobody expected. Driving it from the version
already in the repository means the thing you edit _is_ the trigger,
and the tag is created as a consequence rather than as an instruction.

A commit that does not touch the version costs one short job that looks
up a tag and stops.

## Pipeline

```
version ─┬─► checks (reuses frontend.yml) ─┐
         └─► rust (cargo test) ────────────┴─► draft ─► build ×4 ─► publish
```

- **version** — reads `package.json`, checks whether `v<version>` is
  already tagged, and decides. Everything downstream is gated on it, so
  an ordinary commit spins up nothing.
- **checks** — _calls_ `frontend.yml` rather than repeating it, so a
  release is gated on exactly the checks a pull request gets. That is
  why `frontend.yml` declares `workflow_call`.
- **rust** — `cargo test`, which the Tauri build itself would not run.
- **draft** — creates the GitHub release as a **draft**, so a
  half-finished set of installers is never visible as a release. It
  reuses an existing draft when one is there, which is what makes a
  re-run safe.
- **build** — a matrix of four: Windows, macOS on Apple Silicon, macOS
  on Intel, and Linux. `fail-fast` is off so one platform's failure does
  not throw away three finished builds.
- **publish** — un-drafts, and only after every build succeeded.

## Three files carry the version

`package.json` drives the release, `tauri.conf.json` is what the
installer and about box show, and `Cargo.toml` is what the compiled
binary reports. They must agree, or a release ships tagged one thing
and installing as another — which is only ever noticed afterwards.

`npm run version:set` writes all three, and `version.test.ts` fails if
they ever drift, so the mistake is caught by `npm test` rather than in
a published artefact.

## Re-running a failed release

If one platform failed on a transient runner error, the tag already
exists and a push will not re-trigger. Use **Run workflow** on the
Release workflow with **force** checked: it reuses the existing draft
and re-attaches the missing installers.

## Not done yet

- **Nothing is code-signed.** Windows will show SmartScreen warnings
  and macOS will refuse to open the app without right-click → Open.
  Signing needs certificates in repository secrets
  (`WINDOWS_CERTIFICATE`, `APPLE_CERTIFICATE`, `APPLE_ID`, and so on)
  and, on macOS, notarisation. Until then these are unsigned builds and
  should be described that way to anyone installing them.
- **No auto-update.** Tauri's updater needs a signing key pair and a
  published `latest.json`; the release currently ships installers only.
- **Release notes are a fixed template.** Generating them from commits
  would need a commit convention the project does not have yet.
