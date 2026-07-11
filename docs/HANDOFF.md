# Tasaveer — Session Handoff & Resume Notes

**Purpose of this doc:** Everything another AI agent needs to resume work on the SD-card-import / Google-Drive-backup initiative for Tasaveer. Covers what has shipped, the exact state of the repo, the next capability that was designed but **not yet built** (Backup Reconciliation), and the remaining roadmap.

Last updated: 2026-07-11. Working tree was **clean** at handoff (all session work committed).

---

## 1. Project overview

Tasaveer is a **Tauri v2 desktop app** (Rust backend + React 19 / TypeScript / TailwindCSS v4 frontend, zustand for state) for managing a local photo/video archive. Original 3-step workflow: **Ingest** (import + organize by date + tag) → **Clean & Dedup** (czkawka) → **Sync** (to Immich; currently a stub UI).

The user (Jehangir, a Nikon shooter) is extending it into a full pipeline:
**SD card → local folder (Lightroom working set) → Google Drive (archive backup) → Immich/Google Photos (sharing).**

### Key files
| Area | Path |
|---|---|
| Rust commands registry | `src-tauri/src/lib.rs` (`invoke_handler!`) |
| Import catalog (SQLite) | `src-tauri/src/catalog.rs` |
| Organize/ingest engine | `src-tauri/src/organize.rs` |
| EXIF metadata | `src-tauri/src/metadata.rs` |
| ExifTool daemon | `src-tauri/src/exiftool_daemon.rs` |
| Dedup (czkawka) | `src-tauri/src/dedup.rs` |
| Cancellation tokens | `src-tauri/src/state.rs` |
| Binary discovery | `src-tauri/src/binaries.rs` |
| Ingest page | `src/pages/Ingest.tsx` |
| Settings page | `src/pages/Settings.tsx` |
| Ingest store (persistent op state) | `src/store/ingestStore.ts` |
| Sidebar | `src/components/layout/Sidebar.tsx` |
| Original detailed plan | `docs/sd-card-import-plan.md` |

### Test / build commands
```bash
# Frontend (from repo root)
npx vitest run --reporter=dot        # 63 tests currently pass
npx tsc --noEmit                     # type check, must be clean

# Rust (from repo root OR src-tauri/)
cd src-tauri && cargo test --lib     # 101 tests currently pass
cargo check --lib                    # fast compile check

# Run the app
npm run tauri dev
```
Both suites are green as of handoff: **101 Rust + 63 frontend**.

---

## 2. What shipped this session (committed)

Commits after session-start `682efb1`: `a5a52a0`, `8892f35`. All the below is committed and tracked.

### PR1 — Import catalog (`src-tauri/src/catalog.rs`, new, ~740 lines)
SQLite DB (via `rusqlite = { version = "0.32", features = ["bundled"] }`) at `{app_data_dir}/catalog.sqlite` (WAL mode). Tracks every file ever imported by content hash, so dedup no longer depends on files still existing at the destination.

- Tables: `schema_version`, `import_sessions`, `imported_files` (with indexes on `quick_hash+file_size`, `full_hash`, `backup_status`). Full schema is in the file's `migrate()`.
- `Catalog::open(&app_handle)` (real) and `Catalog::open_at(&path)` (tests point at tempdir).
- API: `find_by_quick_hash`, `create_session`, `finish_session`, `record_import`, `pending_backups`, `mark_backup`, `stats`, `recent_sessions`, `mark_interrupted_sessions`.
- Tauri commands: `get_catalog_path`, `get_catalog_stats`, `get_recent_sessions` (registered in `lib.rs`).
- **Design principle: catalog is always best-effort.** If it fails to open, ingest still proceeds without cross-session dedup. Never block the user's import on the catalog.

### PR2 — Catalog-aware, verified ingest (`src-tauri/src/organize.rs`)
- **`IngestOptions<'a>` struct** replaced the long arg list on `unified_ingest`. Fields: `rules`, `enable_tagging`, `catalog: Option<&Catalog>`, `session_id`, `source_label`, `backup_path`.
- **Cross-session dedup:** processing loop checks `catalog.find_by_quick_hash(hash, size)` *before* the EXIF/date work; a hit counts as duplicate and skips. This is the core "re-importing a cleared card doesn't re-copy" behavior (tested: `test_unified_ingest_catalog_survives_cleared_destination`).
- **`copy_and_verify(src, dst)`** — streams a copy while hashing the source, then re-reads dst and confirms the hash matches before success; removes dst on any failure; never touches src. All new copies go through this.
- **`compute_full_file_hash`** (whole file) vs the existing **`compute_file_hash`** (first 64KB + size = "quick hash"). **Safety rule: quick-hash may decide to *skip* a copy, but any *delete* of a source (move mode / dup) now requires a full-hash match** (`full_hash_matches`). This fixed a real pre-existing bug where a 64KB-prefix collision could delete a distinct file. Tested with `quick_hash_colliding_pair()` fixtures.
- **Video date fallback:** `get_file_date` now tries `DateTimeOriginal` → `CreateDate` (via `date_from_exif_json`). Nikon MOV/MP4 lack `DateTimeOriginal` and were previously all skipped.
- **Preview** (`Organizer::preview`) takes `Option<&Catalog>` and adds an `already_imported` count + per-file `"already_imported"` status. `OrganizePreview` gained `already_imported: usize`.
- Tauri `run_unified_ingest` gained optional params `source_label`, `backup_path`; opens the catalog and records a session + each imported file (backup_status `pending` if `backup_path` set, else `skipped`). `preview_organize` opens catalog too.
- Startup sweep in `lib.rs` `.setup()`: `mark_interrupted_sessions()` flips any stale `running` sessions to `interrupted` (crash recovery).

### Catalog visibility (Settings)
`Settings.tsx` has a collapsed-by-default **"Advanced: Import Catalog"** panel (lazy-loads on expand): shows DB file path with **Reveal in Finder** (`revealItemInDir`), stats tiles (files cataloged / pending backups / last import), and last 10 sessions. Uses `get_catalog_path/stats/recent_sessions`.

### Operation persistence (the "state vanishes on tab switch" fix)
**Problem was UI amnesia, not zombie processes** — the Rust command keeps running; operation state just lived in `useState` and died on unmount.
- New `src/store/ingestStore.ts` (zustand): holds all operation + session state (status, logs, progress, paths, strategy, scan results, preview). `ensureIngestListeners()` registers the `organize-progress` and `tag-progress` Tauri listeners **once for the app lifetime** (module-level, guarded), so progress updates the store even while the Ingest page is unmounted.
- `Ingest.tsx` is now a view over the store. Each run gets a **unique operation id** (`ingest_${Date.now()}`) so Cancel targets the right op; Start Import stays disabled across remounts while running.
- Added a **live progress bar** (the backend's `organize-progress` events were previously never consumed) and a **pulsing dot on the Sidebar Ingest item** visible from any tab.
- Log timestamps now baked in at append time (fixed a bug where every line showed the current clock time).

### Incidental fix — Tauri version mismatch
`npm run tauri dev` was failing on npm(2.11)/Rust-crate(2.9) drift. Resolved by aligning **npm down** (`@tauri-apps/api@2.9.1`, `@tauri-apps/plugin-dialog@2.4.2`) to match the pinned Rust crates — deliberately NOT bumping the Rust `tauri` crate forward (that pulls a large risky transitive upgrade: reqwest 0.12→0.13, wry, webkit2gtk, tao).

### Backup Reconciliation & Safe-to-Delete Audit (shipped)
Fully implemented local staging, cloud backup, and SD card reconciliation pipeline:
- **Disk Safety (`src-tauri/src/disk.rs`)**: Cross-platform disk capacity checks ensuring 5 GB minimum space on the target path before running write operations (unified ingest, backup sync, deep verification downloads).
- **Matching & Core Engine (`src-tauri/src/reconcile.rs`)**: Walks directory structures using metadata (size/name) without downloading Drive placeholders. Matches laptop ↔ Drive on `(rel_path, size)` and laptop ↔ SD on `(file_name, size)`. Classifies files as `SafeToFree`, `AtRisk` (missing from Drive), `DriveOnly`, or `SdOnly`.
- **Tauri Commands**: Registers `run_reconcile`, `backup_at_risk` (copies to Drive and updates catalog), `free_local_space` (re-verifies, moves to Trash, updates catalog), `deep_verify_folder` (downloads Drive files to match full hashes), and `seed_catalog_from_reconcile`.
- **UI page & Zustand Store (`src/pages/Reconcile.tsx`, `src/store/reconcileStore.ts`)**: Built page view with metrics, warning banner, expandable folder breakdowns, interactive modals, and persistent progress listeners. Added route to `App.tsx` and sidebar link with `Scale` icon.

### Release 1.0.0 Preparation (shipped)
- Renamed project package name from default template `tauri-app` to `tasaveer` in `package.json` and `src-tauri/Cargo.toml`.
- Renamed library crate from `tauri_app_lib` to `tasaveer_lib` in `src-tauri/Cargo.toml` and updated reference in `src-tauri/src/main.rs`.
- Bumped app version from `0.1.0` to `1.0.0` across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Updated all lockfiles (`package-lock.json` and `src-tauri/Cargo.lock`) and verified all tests pass (101 Rust + 63 frontend).

---

## 3. NEXT UP: Google Drive Backup Sync (PR3)

Now that the Backup Reconciliation capability is fully implemented and catalog seeding is available, the next feature to build is the Google Drive Backup Sync agent:

### 3.1 The Goal
Create a background backup sync process that automatically mirrors `pending` files from local staging (`~/Pictures/Nikon Imports`) to the Google Drive folder (`.../My Drive/Nikon Photos/Nikon Imports/`) using the catalog as the scheduler:
- Query the catalog for files with `backup_status = 'pending'` (using `Catalog::pending_backups`).
- Copy files to their corresponding relative path in the Google Drive backup root using the streaming `copy_and_verify(src, dst)` function.
- Update catalog rows to `backup_status = 'done'` with their `backup_path` upon verified copies.
- Keep the operation fully cancellable and update progress via `AppState` token tracking.

### 3.2 Concrete Measured State
The staging directory matches between laptop and Drive have been reconciled:
- **Laptop ↔ Drive** scans match on relative paths and sizes to prevent re-downloads.
- **Laptop ↔ SD** scans match on filenames and sizes to handle camera organization paths.
- Free storage checks are enforced natively at a 5 GB limit.
- Per-folder "Deep verify" provides opt-in download validation of content hash matches.

---

## 4. Remaining roadmap (from `docs/sd-card-import-plan.md`)

The original plan defined 5 PRs. **PR1, PR2, and Backup Reconciliation are DONE** (§2). Still pending:
- **PR3 — Google Drive backup sync** (`backup.rs`, `run_backup_sync`): catalog-driven pass that mirrors `pending` files into the Drive folder in the same `YYYY/YYYY-MM-DD` layout, verifies, marks `done`. Resumable by construction (offline mount / cancel leaves rows `pending`). Auto-trigger after ingest + manual "Backup Now". Treats Drive as a local mirror target (desktop client uploads) — no OAuth.
- **PR4 — SD card UX** (`volumes.rs`): `list_removable_volumes` (scan `/Volumes` for `DCIM`), `eject_volume` (`diskutil eject`). Fourth "SD Card" source type in Ingest with a volume picker + eject-after-import. macOS-first; Windows/Linux return empty for now.
- **PR5 — Dashboard & backfill leftovers**: Dashboard tiles + Recent Activity (via `get_catalog_stats`/`get_recent_sessions`).

**Recommended next order:** implement PR3 (backup sync) next, followed by PR4 (SD Card UX), then final PR5 Dashboard additions.

---

## 5. Repo conventions & gotchas
- **Catalog is best-effort**: wrap `Catalog::open` in a match, log + continue on failure. Never block ingest.
- **Verified copies**: any new file copy that could later justify deleting a source must go through `copy_and_verify` (or record a `full_hash`). Only full-hash matches justify deletes.
- **Quick hash vs full hash**: `compute_file_hash` = first 64KB + size (fast, for skip decisions); `compute_full_file_hash` = whole file (for delete decisions).
- **Progress/cancellation pattern**: `state.register_token(&operation_id)` → poll `token.load(Relaxed)` in the loop → `app_handle.emit("<x>-progress", ...)` → `state.remove_token`. Frontend listens via `ensureReconcileListeners` / `ensureIngestListeners`-style module-level listeners and filters by `operationId`.
- **Frontend op state** belongs in zustand stores (survives navigation), not `useState`. Reset stores in test `beforeEach`.
- **Settings** live in `settings.json` via `tauri-plugin-store` (NOT the catalog SQLite) — intentional: hand-editable, no IPC per read, decoupled lifecycle from the catalog. Live operation state stays in memory; only durable outcomes go in the catalog.
- **Media extensions** list is `organize.rs::MEDIA_EXTENSIONS`.
- App identifier: `dev.kazi.tasaveer`. Local import root: `~/Pictures/Nikon Imports`. Drive backup root: `/Users/jehangir/Library/CloudStorage/GoogleDrive-kazi.jehangir@gmail.com/My Drive/Nikon Photos/Nikon Imports`.
- Don't hash Drive placeholder files (forces downloads). Use `stat` for size.

---

## 6. State at handoff
- Working tree clean; 101 Rust + 63 frontend tests green; `tsc` clean.
- Last changes: Added **Backup Reconciliation** page, cross-platform disk capacity guards, catalog seeding on delete, and verified file trashing support.
- Immediate next action when resuming: implement PR3 (Google Drive Backup Sync) to automate background mirroring of catalog pending imports.
