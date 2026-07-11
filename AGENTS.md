# AGENTS.md — Guide for AI Agents working on Tasaveer

Canonical instructions for any AI agent (Claude, Gemini, Cursor, etc.) working in this repo. Keep this file and `docs/HANDOFF.md` accurate.

## What Tasaveer is

A **Tauri v2 desktop app** (Rust backend + React 19 / TypeScript / Tailwind v4 frontend) for managing a local photo/video archive. Pipeline being built: **SD card → local folder (Lightroom working set) → Google Drive (archive backup) → Immich / Google Photos (sharing).** Today the shipped workflow is Ingest → Clean & Dedup → (Sync stub).

## Read this first

- **`docs/HANDOFF.md`** — current state, what shipped, and the detailed spec for the next feature (Backup Reconciliation). **Always read it before starting significant work, and UPDATE it when you finish a significant feature** (mark shipped in §2/§6, keep the "next steps" accurate). This is a hard expectation, not optional.
- **`docs/sd-card-import-plan.md`** — the original multi-PR plan (PR1/PR2 done; PR3–PR5 pending).

## Core philosophy

- **Filesystem is the source of truth** for media files and their embedded metadata (EXIF is read from / written to the files themselves).
- **The catalog (`src-tauri/src/catalog.rs`, SQLite at `{app_data_dir}/catalog.sqlite`) is an auxiliary, rebuildable index** for cross-session dedup and backup tracking — it is **not** authoritative and can be deleted and rebuilt. Never treat it as the source of truth for media.
- **Native capabilities**: heavy file work, hashing, EXIF, and process orchestration live in Rust. React handles UI + state.

## Architecture & conventions

### Backend (Rust / Tauri v2)
- `src-tauri/src/lib.rs` is the orchestration layer (`invoke_handler!`). Delegate logic to modules: `binaries`, `metadata`, `organize`, `dedup`, `catalog`, `state`, `exiftool_daemon`.
- **External binaries** (`exiftool`, `immich-go`, `czkawka`) are resolved via `binaries.rs` (`Prerequisite::discover`), preferring bundled sidecars, then PATH.
- **Long-running ops must be cancellable**: register a token via `AppState` (`state.rs`), poll it in the loop, and emit progress with `app_handle.emit("<x>-progress", …)`. See `organize.rs::run_unified_ingest` as the reference pattern.
- **Batch EXIF** goes through the persistent `SharedExifToolDaemon` (`-stay_open`) — never spawn exiftool per file in a loop.
- **Hashing / copy safety** (see `organize.rs`):
  - `compute_file_hash` = first 64 KB + size ("quick hash"), used only to decide whether to *skip* a copy.
  - `compute_full_file_hash` = whole file, **required before any operation that deletes a source** (move-mode dedup).
  - New file copies that could later justify a delete must go through `copy_and_verify` (streams, hashes, re-reads dst to confirm) or otherwise record a full hash.
- **The catalog is best-effort**: wrap `Catalog::open` in a match and continue on failure — never block an import because the catalog didn't open.
- **macOS**: `fix_path_env()` runs in the Tauri setup to keep `$PATH` sane for spawned processes.
- **Deletions of user media go to Trash** (`trash` crate; see `dedup::delete_to_trash`), never `fs::remove_file`.

### Frontend (React / TS / Tailwind v4)
- **State**: raw `invoke` calls + **zustand** stores. (There is NO TanStack Query in this project — do not add it or assume it.) Operation/session state that must survive tab navigation lives in a module-level zustand store with **app-lifetime Tauri event listeners** — see `src/store/ingestStore.ts` and its `ensureIngestListeners()`. Persistent user **settings** use `tauri-plugin-store` (`settings.json`), not the catalog DB.
- **Design ("Tahoe"/liquid-glass)**: use semantic Tailwind tokens / CSS vars from `src/index.css` (e.g. `text-text-main`, `bg-surface-secondary`, `.glass-card`) — no ad-hoc hex. Support dark mode via `dark:` variants. Icons from `lucide-react`. Navigation in `Sidebar.tsx`; content shell in `layouts/AppLayout.tsx`.
- File/code references in prose should use clickable relative markdown links.

### Testing (required)
- **Run all tests after any change and fix failures**, even unrelated ones. Add tests for new logic.
  - Frontend: `npx vitest run` (tests in `__tests__/` beside the component); type check with `npx tsc --noEmit`.
  - Backend: `cd src-tauri && cargo test --lib` (in-file `#[cfg(test)]` modules; use `tempfile` for FS tests; `Catalog::open_at` for catalog tests).
- Both suites must be green before committing. Current baseline: **93 Rust + 59 frontend**.

## Commands
```bash
npm run tauri dev            # run the app
npx vitest run               # frontend tests
npx tsc --noEmit             # type check
cd src-tauri && cargo test --lib   # rust tests
```

## Gotchas
- **Never read/hash Google Drive placeholder files** — they're online-only (`blocks=0`); reading forces a full download. Use `fs::metadata` for size. (See `docs/HANDOFF.md` §3.3.)
- Keep npm and Rust Tauri package versions on the same minor (a mismatch breaks `tauri dev`); prefer aligning npm to the pinned Rust crates over bumping the Rust crate.
- App identifier: `dev.kazi.tasaveer`. Media extensions: `organize.rs::MEDIA_EXTENSIONS`.
