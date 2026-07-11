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
npx vitest run --reporter=dot        # 59 tests currently pass
npx tsc --noEmit                     # type check, must be clean

# Rust (from repo root OR src-tauri/)
cd src-tauri && cargo test --lib     # 93 tests currently pass
cargo check --lib                    # fast compile check

# Run the app
npm run tauri dev
```
Both suites are green as of handoff: **93 Rust + 59 frontend**.

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

---

## 3. NEXT UP (designed, decision locked, NOT built): Backup Reconciliation & Safe-to-Delete Audit

This is the capability to build next. It solves the user's **immediate acute problem** (see §3.1). The design decision has been made (see §3.4). No code written yet.

### 3.1 The user's problem
- `~/Pictures/Nikon Imports` (**85 GB**, flat `YYYY-MM-DD` folders) is filling the laptop.
- They backed up *most* imports to Google Drive at `/Users/jehangir/Library/CloudStorage/GoogleDrive-kazi.jehangir@gmail.com/My Drive/Nikon Photos/Nikon Imports/` (same `YYYY-MM-DD` structure) — but it's **not a full copy**.
- They can't tell which local files are safely on Drive (so can't reclaim space safely).
- They can't clear/reformat the SD card (primary source of truth), AND the SD card is already **incomplete**: they deleted a few specific days from it after manually copying those days to the laptop. So no location is a superset of the others.

### 3.2 Concrete measured state (as of handoff)
Folder **sets** are identical (21 date folders each) but contents diverge:
- `2026-04-25`: laptop **1135** vs Drive **1124** → 11 files only on laptop (need backup).
- `2026-05-22`: laptop **31** vs Drive **62** → 31 files only on Drive (asymmetry; informational).
- Other 19 folders: media file counts match.
- SD card was **not mounted** at inspection time.

### 3.3 CRITICAL technical findings about Google Drive streaming mode
These are load-bearing — do not re-derive naively.
- Drive files are **online-only placeholders**: `stat` shows `blocks=0` (zero bytes on local disk). **Reading/hashing them forces a download** of the whole 85 GB — must be avoided.
- BUT `stat` reports each placeholder's **true logical size** for free (`st_size`), verified to exactly match the local original's size.
- Each placeholder carries an xattr **`com.google.drivefs.item-id`** = the Drive item id (a clean local-path→Drive-record join key, no download).
- Drive keeps a local metadata SQLite DB at:
  `~/Library/Application Support/Google/DriveFS/<account_id>/metadata_sqlite_db` (WAL mode; account id observed: `113333853939889054282`).
  - Table `items(stable_id, id, file_size, local_title, is_folder, modified_date, mime_type, ...)` where `items.id` == the xattr item-id.
  - Table `item_properties(item_stable_id, key, value BLOB, value_type)`; table `stable_parents` for the folder tree.
  - **The real MD5 is NOT recoverable offline.** The `content-entry` property is a protobuf containing `[file_size, drive_item_id, opaque 38-byte content pointer]`; the opaque pointer is **not** the md5 (verified: decoded bytes ≠ the file's actual md5). Getting true Drive-side md5 would need the Drive API (OAuth) or `rclone` — **`rclone` is NOT installed** on this machine.
- **Therefore the reliable zero-download match key is: relative path (date-folder) + filename + exact byte size.** For camera originals (never re-encoded), a different photo sharing the same camera filename AND identical byte count is effectively impossible; a truncated upload would show a different size (caught, not falsely cleared).
- Simplest robust Drive-side scan = **walk the Drive folder and `stat` each file** (path, name, size). No need to depend on the undocumented metadata DB, though the DB/xattr are available if item-id is ever wanted.

### 3.4 DECISION LOCKED (via user)
**Default confidence bar for "safe to delete" = name + size** (date-folder + filename + exact byte size). Zero downloads. Plus:
- **Opt-in per-folder "deep verify"**: for a specific day the user is nervous about, download just that folder's Drive files and do a true content-hash comparison before deleting. Not the default; per-folder.
- **All deletions go to Trash** (recoverable), never permanent. Reuse `trash` crate (already a dep, used in `dedup::delete_to_trash`).

### 3.5 DETAILED IMPLEMENTATION SPEC (build this)

> This section is deliberately prescriptive. Follow it closely. The two things most likely to be done wrong are (a) the **two different match strategies** for Drive vs SD (§3.5.3) and (b) **accidentally reading Drive placeholder bytes** (§3.5.7). Re-read those before coding.

#### 3.5.0 Prerequisite refactor (do first)
`compute_full_file_hash` and `copy_and_verify` are currently **private** in `organize.rs`. Reconcile needs both. Change their visibility to `pub(crate)` (do NOT move them; moving is unnecessary churn). Also reuse `organize.rs::MEDIA_EXTENSIONS` and the `Organizer::compute_file_hash` quick-hash logic — extract the quick-hash into a free `pub(crate) fn compute_quick_hash(path) -> io::Result<String>` if convenient, or just replicate the tiny logic. Keep the existing `Organizer` untouched otherwise.

#### 3.5.1 New module `src-tauri/src/reconcile.rs` — data model
```rust
#[derive(Clone)]
struct ScannedFile {
    rel_path: String,      // path relative to that location's scan root, forward-slashed, e.g. "2026-04-25/_DSC5912.JPG"
    file_name: String,     // "_dsc5912.jpg"  <-- LOWERCASED for matching (APFS is case-insensitive)
    size: u64,             // bytes. For Drive placeholders this comes from fs::metadata().len() (st_size) — NO file read.
}

#[derive(Serialize)] enum Classification { SafeToFree, AtRisk, DriveOnly, SdOnly }

#[derive(Serialize)]
struct FileStatus {
    rel_path: String, file_name: String, size: u64,
    on_laptop: bool, on_drive: bool, on_sd: bool,
    classification: Classification,
}

#[derive(Serialize)]
struct FolderSummary {           // grouped by the top-level laptop date folder
    folder: String,              // "2026-04-25"
    laptop_count: usize, drive_count: usize, sd_count: usize,
    safe_to_free_count: usize, safe_to_free_bytes: u64,
    at_risk_count: usize,        at_risk_bytes: u64,
}

#[derive(Serialize)]
struct ReconcileReport {
    folders: Vec<FolderSummary>,
    files: Vec<FileStatus>,      // full detail; UI paginates/groups
    total_reclaimable_bytes: u64, // sum of SafeToFree laptop files
    total_at_risk_bytes: u64,     // sum of AtRisk laptop files
    laptop_root: String, drive_root: Option<String>, sd_root: Option<String>,
}
```

#### 3.5.2 Scanning
- `scan_tree(root, compute_hash: bool)` → `Vec<ScannedFile>` using `walkdir`, filtered to `MEDIA_EXTENSIONS` (skip `.DS_Store`, `NKSC_PARAM`, dirs). `rel_path` = `path.strip_prefix(root)`, forward-slashed; `file_name` = lowercased final component; `size` = `fs::metadata(path).len()`.
- Laptop: call with `compute_hash: false` for the report (size is enough for name+size verdict). Hashing all 85 GB is unnecessary for classification; only compute hashes in **deep verify** (§3.5.6) or when **seeding the catalog** (§3.5.5).
- Drive: `compute_hash: false` ALWAYS. **Never pass true for a Drive root.** Only `fs::metadata` is touched (safe; does not materialize placeholders).
- SD: `compute_hash: false`.

#### 3.5.3 Matching — TWO strategies (critical)
Laptop and Drive are **date-organized** (`2026-04-25/_DSC5912.JPG`) but the **SD card is camera-organized** (`DCIM/100NIKON/_DSC5912.JPG`). Therefore:
- **Laptop ↔ Drive:** match on **(rel_path, size)** — precise, because both share the date-folder layout. Build a `HashSet<(String /*rel_path*/, u64 /*size*/)>` of Drive files; a laptop file is "on_drive" if that pair is present.
- **Laptop ↔ SD:** match on **(file_name, size)** ONLY (ignore path), because the SD path won't match the date path. Build a `HashSet<(String /*file_name*/, u64)>` of SD files; a laptop file is "on_sd" if that pair is present.
- Both keys use the **lowercased** file_name / rel_path (macOS case-insensitivity).
- Rationale: Drive is the strong signal (path+size). SD is a secondary safety-net signal (name+size); slightly weaker but only used to spare deletion of files that are still on the card.

#### 3.5.4 Classification (per laptop-rooted file, plus non-laptop extras)
For every distinct file across all three locations:
- `SafeToFree` ⟺ `on_laptop && (on_drive || on_sd)` → the laptop copy is deletable.
- `AtRisk`     ⟺ `on_laptop && !on_drive && !on_sd` → ONLY copy is on the laptop; MUST be backed up before any deletion.
- `DriveOnly`  ⟺ `!on_laptop && on_drive` → informational (e.g. `2026-05-22`).
- `SdOnly`     ⟺ `!on_laptop && on_sd && !on_drive` → informational.
Group `FolderSummary` by the laptop file's top-level folder (first path segment of `rel_path`). `total_reclaimable_bytes` = Σ SafeToFree sizes; `total_at_risk_bytes` = Σ AtRisk sizes.

#### 3.5.5 Tauri commands (register in `lib.rs`)
All use the progress+cancellation pattern from `organize.rs::run_unified_ingest`: `state.register_token(&operation_id)`, poll `token.load(Relaxed)`, `app_handle.emit("reconcile-progress", ...)`, `state.remove_token`.
- `run_reconcile(laptop_root, drive_root: Option<String>, sd_root: Option<String>, operation_id) -> ReconcileReport`
  - Emits progress for phases: "Scanning laptop", "Scanning Drive", "Scanning SD", "Matching".
  - If `drive_root` is `None` or its path doesn't exist → run anyway but **nothing can be SafeToFree via Drive**; still detect SD. Make the report honest (all laptop files with no drive/sd match are AtRisk). Surface a clear "Drive not configured/offline" note in the report (add a `warnings: Vec<String>` field).
- `seed_catalog_from_reconcile(report or laptop_root+drive_root, operation_id) -> usize` (OPTIONAL, explicit button — reconcile itself is read-only). For each laptop file: compute quick_hash + size, `catalog.record_import(...)` with `backup_status = "done"` if on_drive else `"pending"`. Skips files already present (`find_by_quick_hash`). This bootstraps PR5 backfill + future dedup. Wrap in a "backfill-<ts>" session.
- `deep_verify_folder(laptop_root, drive_root, folder, operation_id) -> Vec<{ rel_path, verified: bool, reason }>` (opt-in, per folder). For each laptop file in `folder` that is SafeToFree-via-Drive: full-hash the laptop file AND the Drive counterpart (this DOES read/materialize the Drive file → download). Compare `compute_full_file_hash` on both. **This is the only command allowed to read Drive bytes, and only for one user-chosen folder.** Emit a warning to the UI about download size before running.
- `backup_at_risk(laptop_root, drive_root, rel_paths: Vec<String>, operation_id) -> BackupResult` — for each rel_path, `copy_and_verify(laptop_root/rel_path, drive_root/rel_path)` creating parent dirs. On success, record/update the catalog row `backup_status = "done"`. Emits progress; cancellable; never deletes the source.
- `free_local_space(laptop_root, drive_root, sd_root, files: Vec<{rel_path, size}>, operation_id) -> DeleteResult` — for each file the UI marked SafeToFree:
  1. **RE-VERIFY at delete time** (state may have changed since scan): recompute whether a `(rel_path,size)` match exists on Drive OR a `(file_name,size)` match on SD. If NOT → **skip**, add to `DeleteResult.skipped` with reason. Never delete an unconfirmed file.
  2. Move the laptop file to **Trash** via the `trash` crate (see `dedup::delete_to_trash` for the exact call). NEVER `fs::remove_file` user media.
  3. Update the catalog row (local copy gone; canonical now Drive/SD).

#### 3.5.6 Frontend
- New route `reconcile` in `App.tsx` + a Sidebar item (e.g. label "Free Space", icon `HardDriveDownload` or `Scale`). New page `src/pages/Reconcile.tsx`.
- Config row: laptop root, Drive root, SD root (auto-filled from settings; SD auto-detected when a `/Volumes/*/DCIM` exists once §PR4 lands, else manual). "Scan" button → `run_reconcile`.
- Header stat tiles: **Reclaimable** (total_reclaimable GB, green), **At risk** (total_at_risk GB, red), Drive/SD status.
- Per-folder table: folder | laptop | drive | sd | Safe (count · GB) | At-risk (count · GB), color-coded; expandable to file lists.
- Actions (each behind a confirmation modal showing count + GB):
  - "Back up at-risk to Drive" → `backup_at_risk` on all AtRisk rel_paths, then auto re-scan.
  - "Free space" → `free_local_space` on SafeToFree files; modal must state "moves N files (X GB) to Trash".
  - Per-folder "Deep verify" → `deep_verify_folder`, with a "this downloads ~X GB" warning.
  - "Add to catalog" → `seed_catalog_from_reconcile`.
- If it runs long, persist operation state in a small `reconcileStore` mirroring `ingestStore.ts` (module-level listeners for `reconcile-progress`, survives tab nav). Reuse the pattern; don't reinvent.

#### 3.5.7 HARD CONSTRAINTS (do not violate)
1. **Never read/hash Drive placeholder bytes during scan.** Only `fs::metadata`. The sole exception is `deep_verify_folder`, invoked explicitly per folder.
2. **All deletions go to Trash** (`trash` crate), never `fs::remove_file`, for any user media.
3. **AtRisk files are never deletable** — they're the only copy.
4. **`free_local_space` re-verifies each file at delete time** — never trust the stale scan.
5. Match keys are **lowercased** (APFS case-insensitivity).
6. Default verdict = **name+size** (Drive: rel_path+size; SD: name+size). Deep hash is opt-in only.
7. Reconcile scan is **read-only**; catalog seeding and deletion are separate explicit actions.

#### 3.5.8 Rust tests (tempdir trees)
Simulate: `laptop/2026-04-25/_dsc1.jpg`, `drive/2026-04-25/_dsc1.jpg`, `sd/DCIM/100NIKON/_dsc2.jpg` etc.
- `safe_to_free_via_drive`: laptop+drive same rel_path+size → SafeToFree.
- `safe_to_free_via_sd`: laptop file + SD file same name+size (different paths) → SafeToFree.
- `at_risk_only_on_laptop`: laptop only → AtRisk; not in reclaimable bytes.
- `drive_only`: drive only → DriveOnly.
- `size_mismatch_not_matched`: same name, different size → NOT matched → AtRisk (guards against truncated uploads).
- `free_local_space_reverifies`: mark SafeToFree, then remove the Drive counterpart before calling `free_local_space` → file is skipped, NOT trashed.
- `backup_at_risk_verified`: copies to drive at same rel_path, dst hash == src hash, src still present.
- `drive_root_missing_marks_all_at_risk`: `drive_root=None` → laptop files with no SD match are AtRisk, report has a warning.

#### 3.5.9 Edge cases
- Drive offline/unconfigured → no SafeToFree-via-Drive; report warns (§3.5.5).
- SD not mounted → sd signal absent; fine.
- Sidecar/param files (`NKSC_PARAM`, `.NKSC`) → media-only for v1; ignore.
- Case differences → handled by lowercasing keys.
- Duplicate filenames within a laptop folder → shouldn't occur post-organize; rel_path keys keep laptop/drive precise.
- Nikon filename rollover (`_DSC9999`→`_DSC0001`) → for SD name+size matching, a same-name+same-size collision across shoots is possible but astronomically unlikely for JPEG/NEF; Drive rel_path+size is unaffected. Deep verify is the escape hatch when in doubt.

### 3.6 Concrete build order for this feature
1. §3.5.0 visibility refactor + `reconcile.rs` scaffolding with data model.
2. `scan_tree` + matching + classification (pure, testable) → write §3.5.8 tests, get green.
3. `run_reconcile` command + register in `lib.rs`.
4. `Reconcile.tsx` page + route + sidebar + scan/report UI (read-only first).
5. `backup_at_risk` + `free_local_space` (with re-verify guard) + confirmation modals.
6. `deep_verify_folder` + `seed_catalog_from_reconcile`.
7. Settings: add `backupPath` (Drive root) — shared with PR3.
8. Full suites green (`cargo test`, `vitest`, `tsc`). Update this HANDOFF's §2/§6 to mark it shipped.

### 3.7 Go-forward workflow this enables
1. SD → laptop (existing ingest, copy mode; catalog records).
2. Laptop → Drive mirror (backup pass, PR3 below); catalog marks `done` after verify.
3. Free local space: delete local copies confirmed on Drive (catalog knows canonical copy is on Drive + SD).
4. Keep SD as source of truth until the app confirms that card is fully on Drive; then safe to reformat.

---

## 4. Remaining roadmap (from `docs/sd-card-import-plan.md`)

The original plan defined 5 PRs. **PR1 and PR2 are DONE** (§2). Still pending:
- **PR3 — Google Drive backup sync** (`backup.rs`, `run_backup_sync`): catalog-driven pass that mirrors `pending` files into the Drive folder in the same `YYYY/YYYY-MM-DD` layout, verifies, marks `done`. Resumable by construction (offline mount / cancel leaves rows `pending`). Auto-trigger after ingest + manual "Backup Now". Treats Drive as a local mirror target (desktop client uploads) — no OAuth.
- **PR4 — SD card UX** (`volumes.rs`): `list_removable_volumes` (scan `/Volumes` for `DCIM`), `eject_volume` (`diskutil eject`). Fourth "SD Card" source type in Ingest with a volume picker + eject-after-import. macOS-first; Windows/Linux return empty for now.
- **PR5 — Dashboard & backfill**: Dashboard tiles + Recent Activity (via `get_catalog_stats`/`get_recent_sessions`), and `index_existing_archive` to backfill the catalog from the existing archive so the first SD import doesn't treat old photos as new. **Note:** the Reconciliation capability (§3) overlaps with backfill — reconciliation can seed the catalog, so consider building §3 in a way that also satisfies PR5's backfill need.

**Recommended next order:** build §3 (Backup Reconciliation) first — it solves the acute space problem AND seeds the catalog. Then PR3 (backup sync) reuses the Drive-folder infra. Then PR4 (SD UX), then PR5 leftovers.

Out of scope (deliberately): deleting/formatting the SD card from the app; Drive API/rclone; Immich/Google Photos upload (that's the later Sync stage); Windows/Linux volume detection.

---

## 5. Repo conventions & gotchas
- **Catalog is best-effort**: wrap `Catalog::open` in a match, log + continue on failure. Never block ingest.
- **Verified copies**: any new file copy that could later justify deleting a source must go through `copy_and_verify` (or record a `full_hash`). Only full-hash matches justify deletes.
- **Quick hash vs full hash**: `compute_file_hash` = first 64KB + size (fast, for skip decisions); `compute_full_file_hash` = whole file (for delete decisions).
- **Progress/cancellation pattern**: `state.register_token(&operation_id)` → poll `token.load(Relaxed)` in the loop → `app_handle.emit("<x>-progress", ...)` → `state.remove_token`. Frontend listens via `ensureIngestListeners`-style module-level listeners and filters by `operationId`.
- **Frontend op state** belongs in `ingestStore` (survives navigation), not `useState`. Reset the store in test `beforeEach` with `useIngestStore.setState(useIngestStore.getInitialState(), true)`.
- **Settings** live in `settings.json` via `tauri-plugin-store` (NOT the catalog SQLite) — intentional: hand-editable, no IPC per read, decoupled lifecycle from the catalog. Live operation state stays in memory (source of truth is the Rust process); only durable outcomes go in the catalog.
- **Media extensions** list is `organize.rs::MEDIA_EXTENSIONS`.
- App identifier: `dev.kazi.tasaveer`. Local import root: `~/Pictures/Nikon Imports`. Drive backup root: `/Users/jehangir/Library/CloudStorage/GoogleDrive-kazi.jehangir@gmail.com/My Drive/Nikon Photos/Nikon Imports`.
- Don't hash Drive placeholder files (forces downloads). Use `stat` for size.

---

## 6. State at handoff
- Working tree clean; 93 Rust + 59 frontend tests green; `tsc` clean.
- Last commits: `8892f35` (interruption handling + ingest persistence), `a5a52a0` (revealItemInDir mock).
- Immediate next action when resuming: implement §3 (Backup Reconciliation). Decision (name+size default, opt-in deep verify, delete-to-Trash) is already made — proceed to build unless the user redirects.
