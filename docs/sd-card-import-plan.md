# SD Card Import + Google Drive Backup — Implementation Plan

**Target workflow:** Nikon SD card → local archive folder (Lightroom working set) → mirrored to Google Drive (archive backup). Only new (never-before-imported) photos are copied, even after the local folder has been cleaned out.

**Core enabler:** a persistent **import catalog** (SQLite) that remembers every file ever ingested, so deduplication no longer depends on files still existing at the destination.

---

## Design overview

```
SD card (DCIM)
   │  scan → hash → catalog lookup (skip known files)
   ▼
Local archive  (YYYY/YYYY-MM-DD/…)          ← copy + verify (full SHA-256)
   │  recorded in catalog: backup_status = pending
   ▼
Google Drive folder (~/Library/CloudStorage/GoogleDrive-…/My Drive/…)
      ← catalog-driven backup pass, same YYYY/YYYY-MM-DD layout
      ← Drive desktop client handles the actual cloud upload
```

Key decisions:

1. **Google Drive = second local destination.** We copy into the Drive desktop mount and let the Drive client upload. No OAuth, no API, reuses existing copy machinery. "Backed up" in the catalog means "verified copy handed to the Drive client".
2. **Backup is a catalog-driven second pass**, not inline fan-out during import. It is auto-triggered after each ingest and manually via "Backup Now". This makes it resumable by construction (offline Drive mount, cancelled runs) — anything `pending` gets picked up next time.
3. **Tiered dedup safety policy:**
   - *Skip decisions (copy mode):* quick-hash (existing first-64KB SHA-256 + size) match against catalog is sufficient. Camera files differ within the first 64KB (EXIF timestamps), so false positives are effectively impossible; nothing is destroyed on a skip.
   - *Delete decisions (move mode / dedup-delete):* require **full-file SHA-256 equality** before any `fs::remove_file`. This also fixes the existing unsafe quick-hash-only delete in `unified_ingest`.
4. **Every new import is verified**: streaming copy computes the source hash on the fly, then the destination file is re-read and hashed; only on match is the file recorded in the catalog. Verify failure ⇒ delete the bad copy, count as error, never touch the source.

---

## 1. Import catalog (`src-tauri/src/catalog.rs`)

### Dependency

```toml
# src-tauri/Cargo.toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

(`bundled` compiles SQLite in — no system dependency, works on all targets.)

### Location

`{app_data_dir}/catalog.sqlite` via `app_handle.path().app_data_dir()`. Open with `journal_mode=WAL` and `busy_timeout=5000`. Connections are opened per command (cheap; WAL handles concurrent readers), so no shared connection needs to live in `AppState`.

### Schema (v1)

```sql
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS import_sessions (
  id                TEXT PRIMARY KEY,          -- operation_id from frontend
  started_at        TEXT NOT NULL,             -- ISO-8601
  finished_at       TEXT,
  source_path       TEXT NOT NULL,
  source_label      TEXT,                      -- e.g. volume name "NIKON Z6"
  dest_path         TEXT NOT NULL,
  backup_path       TEXT,
  total_files       INTEGER NOT NULL DEFAULT 0,
  imported          INTEGER NOT NULL DEFAULT 0,
  skipped_duplicates INTEGER NOT NULL DEFAULT 0,
  skipped_no_date   INTEGER NOT NULL DEFAULT 0,
  errors            INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'running'  -- running|complete|cancelled|error
);

CREATE TABLE IF NOT EXISTS imported_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT REFERENCES import_sessions(id),
  quick_hash    TEXT NOT NULL,        -- existing 64KB+size SHA-256
  full_hash     TEXT,                 -- full-file SHA-256 (set at verify time)
  file_size     INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  source_path   TEXT,                 -- where it came from (card path)
  local_path    TEXT NOT NULL,        -- where it lives in the archive
  date_taken    TEXT,                 -- YYYY-MM-DD
  camera_model  TEXT,
  imported_at   TEXT NOT NULL,
  backup_status TEXT NOT NULL DEFAULT 'pending',  -- pending|done|failed|skipped
  backup_path   TEXT,
  backed_up_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_files_quick  ON imported_files(quick_hash, file_size);
CREATE INDEX IF NOT EXISTS idx_files_full   ON imported_files(full_hash);
CREATE INDEX IF NOT EXISTS idx_files_backup ON imported_files(backup_status);
```

### Module API

```rust
pub struct Catalog { conn: rusqlite::Connection }

impl Catalog {
    pub fn open(app: &tauri::AppHandle) -> Result<Self, String>;
    pub fn open_at(path: &Path) -> Result<Self, String>;   // for tests

    pub fn find_by_quick_hash(&self, quick_hash: &str, size: u64)
        -> Result<Option<ImportedFile>, String>;

    pub fn create_session(&self, s: &NewSession) -> Result<(), String>;
    pub fn finish_session(&self, id: &str, counts: &SessionCounts, status: &str)
        -> Result<(), String>;

    pub fn record_import(&self, rec: &NewImport) -> Result<i64, String>;

    pub fn pending_backups(&self, limit: usize) -> Result<Vec<ImportedFile>, String>;
    pub fn mark_backup(&self, file_id: i64, status: &str, backup_path: Option<&str>)
        -> Result<(), String>;

    pub fn stats(&self) -> Result<CatalogStats, String>;         // totals, pending count, last import
    pub fn recent_sessions(&self, limit: usize) -> Result<Vec<ImportSession>, String>;
}
```

Corruption/missing DB is non-fatal: recreate empty and continue (dest-path collision dedup still catches same-path duplicates); user can re-run "Index existing archive".

---

## 2. Organizer integration (`src-tauri/src/organize.rs`)

### `IngestOptions` struct

Parameter creep is already bad (`unified_ingest` takes 6 args). Introduce:

```rust
pub struct IngestOptions<'a> {
    pub move_files: bool,
    pub enable_tagging: bool,
    pub rules: &'a [TagRule],
    pub verify_after_copy: bool,       // default true
    pub catalog: Option<&'a Catalog>,
    pub session_id: String,
    pub source_label: Option<String>,
}
```

### Processing-loop changes (order matters for speed)

Today: date extraction (exiftool) → hash → dedup. For a mostly-already-imported card, that wastes an exiftool round-trip per known file. New order per file:

1. Quick hash (already precomputed in the parallel phase).
2. **Catalog lookup** (`find_by_quick_hash`) → hit ⇒ count as `skipped_duplicates`, next file. No exiftool call.
3. In-run `seen_hashes` check (unchanged).
4. Date extraction → dest path → collision check (unchanged, except full-hash before any delete).
5. **Streaming copy + verify**:
   - `copy_with_hash(src, dst) -> full_hash` — read source in chunks, update SHA-256, write dest (one source read, one dest write).
   - Re-read dest, hash, compare. Mismatch ⇒ remove dest, `errors += 1`, source untouched.
   - Move mode: only `remove_file(src)` after verification passes.
6. `catalog.record_import(...)` with `backup_status = 'pending'` (or `'skipped'` when no backup path configured).

### Full-hash-before-delete fix (safety, applies even without catalog)

In both duplicate branches of `unified_ingest`/`run` where move mode currently deletes the source on a quick-hash match, confirm with full-file hashes of both files first. Quick-hash mismatch on full compare ⇒ treat as collision, import under a resolved name.

### Video date fallback (needed for Nikon .MOV/.MP4)

`get_file_date` only reads `DateTimeOriginal`, which QuickTime videos usually lack — camera videos would all be "skipped (no date)". Extend the daemon JSON lookup to a fallback chain: `DateTimeOriginal` → `CreateDate` → `MediaCreateDate`, then filename. Small change in `get_file_date` + `read_exif_metadata_internal`.

### Preview

`preview_organize` gains `check_catalog: bool`; per-file status adds `"already_imported"`. Preview response adds `already_imported` count so the UI can show "New: N · Already imported: M · In-batch dups: K · No date: J" before the user commits.

---

## 3. Google Drive backup (`src-tauri/src/backup.rs`)

```rust
#[tauri::command]
pub async fn run_backup_sync(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    backup_root: String,          // from settings, passed by frontend
    operation_id: String,
) -> Result<BackupResult, String>
```

Logic:

1. Validate `backup_root` exists and is writable (catches signed-out / offline Drive mount) — abort early with a clear message, everything stays `pending`.
2. `catalog.pending_backups(...)` in batches.
3. For each file: dest = `backup_root` + same `YYYY/YYYY-MM-DD/name` relative layout (derive from `local_path` relative to archive root; store the relative path at import time to make this trivial). Copy, hash the written copy, compare against stored `full_hash`, then `mark_backup(id, "done", path)`.
4. Missing source file (user deleted from local archive before backup ran) ⇒ `mark_backup(id, "failed")` with message; surfaced in UI.
5. Emits `backup-progress` events (same shape as `organize-progress`); supports the existing cancellation-token pattern.
6. Skips files whose backup target already exists with matching hash (idempotent re-runs).

Triggering: automatically invoked by the frontend after a successful ingest when `backupPath` is set, and manually from the Dashboard ("Backup Now"). Cancellation leaves remaining rows `pending` — safe.

Documentation note in UI copy: "done" = verified copy placed in the Drive folder; the Drive desktop client performs the actual cloud upload.

---

## 4. SD card detection (`src-tauri/src/volumes.rs`)

```rust
#[derive(Serialize)]
pub struct VolumeInfo {
    pub name: String,          // "NIKON Z6"
    pub mount_point: String,   // "/Volumes/NIKON Z6"
    pub dcim_path: Option<String>,  // Some(...) if DCIM/ exists
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
}

#[tauri::command] pub fn list_removable_volumes() -> Result<Vec<VolumeInfo>, String>;
#[tauri::command] pub fn eject_volume(mount_point: String) -> Result<(), String>;
```

- macOS: enumerate `/Volumes`, exclude the boot volume (the entry whose canonical path is `/`), check for a `DCIM` directory one level down. `eject_volume` shells out to `diskutil eject <mount>` and returns stderr on failure.
- Windows/Linux: return `Ok(vec![])` for now with a `#[cfg]` split so the command shape is stable; implement later (Phase 1 is macOS-first, matching the user's machine).
- Ingest uses `dcim_path` as the source when present, else `mount_point`.

---

## 5. Command surface summary

| Command | New/changed | Purpose |
|---|---|---|
| `run_unified_ingest` | changed | + `backupPath: Option<String>`, `sourceLabel: Option<String>`, `verifyAfterCopy: bool`; records session + files in catalog |
| `preview_organize` | changed | + `checkCatalog: bool`; returns `already_imported` count |
| `run_backup_sync` | new | catalog-driven mirror to Drive folder |
| `list_removable_volumes` | new | SD card discovery |
| `eject_volume` | new | post-import eject |
| `get_catalog_stats` | new | Dashboard tiles |
| `get_recent_sessions` | new | Dashboard "Recent Activity" |
| `index_existing_archive` | new | backfill catalog from current archive (see §8) |

All registered in `lib.rs` `invoke_handler`.

---

## 6. Settings changes (`src/pages/Settings.tsx`)

New `SettingsData` keys (persisted in the existing `settings.json` store):

- `backupPath: string` — "Google Drive Backup Folder" picker in the Paths section. Helper text: "Pick a folder inside your Google Drive (e.g. ~/Library/CloudStorage/GoogleDrive-…/My Drive/Photo Archive). Files copied here are uploaded by the Google Drive desktop app." Show an inline warning badge when the saved path doesn't currently exist (Drive signed out / not installed).
- `verifyImports: string ("true"/"false", default true)` — under Advanced; toggles post-copy hash verification.

No Rust-side settings reads: the frontend passes paths into commands, consistent with the existing pattern.

---

## 7. Ingest UI changes (`src/pages/Ingest.tsx`)

1. **Fourth source type**: `IngestType = 'local' | 'sd-card' | 'google-photos' | 'icloud'`; grid becomes 4 columns; `Camera` icon.
2. **SD-card panel** (replaces the folder-browse button when `sd-card` selected):
   - On select, invoke `list_removable_volumes`; render a card per volume: name, free/total space, green "DCIM found" badge. Refresh button. Empty state: "No SD card detected — insert a card or use Local source."
   - Choosing a volume sets `sourcePath` (DCIM path) and `sourceLabel` (volume name).
3. **Destination panel** shows both targets: existing Archive Destination + a read-only "Backup: Google Drive" row populated from `backupPath` (link to Settings when unset; importing without it is allowed — files just stay `pending`).
4. **Preview summary** gains an "Already imported" tile (from the extended preview response).
5. **Step visualizer** becomes: 1 Scan → 2 Import & Verify → 3 Backup. Backup step listens to `backup-progress` events; after `run_unified_ingest` resolves, the page auto-invokes `run_backup_sync` when `backupPath` is set.
6. **Post-success actions**: when the source was a volume, show an **Eject Card** button (`eject_volume`), plus summary line "N imported, M already on file, K backed up to Drive".
7. Strategy default stays **Copy**; nothing on the card is ever deleted by this flow.

---

## 8. Archive backfill (one-time migration)

The user already has an organized archive; without backfill, the first SD import would re-import photos that predate the catalog (they'd only be caught by dest-path collision, which stops working once the working folder is cleaned).

`index_existing_archive(path, markBackedUp: bool, operation_id)`:

- Walk `path`, quick-hash every media file, insert rows (`session_id = "backfill-<ts>"`, `source_path = NULL`, `full_hash = NULL` — computed lazily if ever needed for a delete decision).
- `markBackedUp` decides `backup_status`: `'skipped'` (default — pre-existing files aren't mirrored) vs `'pending'` (user wants the whole archive mirrored to Drive; warns about volume).
- Exposed as a button in Settings ("Index existing archive into catalog") with progress + cancel, reusing the operation-token pattern.

---

## 9. Edge cases & failure modes

| Case | Behavior |
|---|---|
| Drive mount offline / signed out | `run_backup_sync` aborts with clear error; files stay `pending`; Dashboard shows pending count |
| Card yanked mid-import | per-file errors; session `status = 'error'`; only verified files are in catalog ⇒ re-run is idempotent |
| Catalog missing/corrupt | recreate empty, warn, suggest re-index; ingest still works |
| RAW+JPEG pairs (NEF+JPG) | distinct hashes ⇒ both import (intended) |
| Nikon filename rollover (DSC_9999→0001) | same-name different-content handled by existing collision + hash logic |
| Same name, same date, different content | `resolve_collision` rename (existing) |
| Videos without `DateTimeOriginal` | fixed by CreateDate fallback (§2) |
| Import cancelled mid-run | session marked `cancelled`; catalog rows exist only for completed+verified files |
| Backup cancelled mid-run | remaining rows stay `pending`; next run resumes |
| Local file deleted before backup ran | backup row marked `failed` with message |

---

## 10. Testing

**Rust** (pattern: tempdir + `Catalog::open_at`):
- Catalog: open/migrate, record + `find_by_quick_hash`, session lifecycle, `pending_backups`/`mark_backup`, stats.
- Ingest+catalog integration: ingest a source into dest A; wipe dest A; ingest same source into dest B ⇒ 0 imported, all `skipped_duplicates`. Quick-hash collision with different full hash ⇒ imported, not deleted.
- Verify: corrupt-copy simulation via a dest pre-seeded read-only file ⇒ error counted, source intact.
- Backup sync: pending rows → mirrored tree in temp "drive" dir → `done`; nonexistent backup root ⇒ clean abort; re-run idempotent.
- Volumes: smoke test (no panic, boot volume excluded) — macOS-gated.
- Video date fallback — gated on exiftool presence like existing tests.

**Frontend** (Vitest + Testing Library, existing mock style in `setupTests.ts`):
- SD source type renders volume list from mocked `list_removable_volumes`; selection sets source display.
- Preview shows "Already imported" tile.
- Post-ingest auto-triggers `run_backup_sync` when backupPath set; Eject button invokes `eject_volume`.
- Settings: backupPath save/load + missing-path warning.
- Dashboard: stats tiles + Backup Now.

---

## 11. Implementation order (PR-sized steps)

1. **PR 1 — Catalog core**: `rusqlite` dep, `catalog.rs` (schema, API, tests). No behavior change.
2. **PR 2 — Safe verified ingest**: `IngestOptions`, reordered dedup loop with catalog lookup, streaming copy+verify, full-hash-before-delete fix, video date fallback, extended preview, session recording.
3. **PR 3 — Backup sync**: `backup.rs`, `run_backup_sync`, `backupPath` setting + UI, auto-trigger after ingest.
4. **PR 4 — SD card UX**: `volumes.rs`, Ingest source type + volume picker + eject + new preview/summary tiles + backup step in visualizer.
5. **PR 5 — Dashboard & backfill**: `get_catalog_stats`, `get_recent_sessions`, Dashboard tiles + Recent Activity, `index_existing_archive` + Settings button.
6. **Docs**: README workflow section + ROADMAP updates.

Rough size: ~1,000 lines Rust + ~450 lines TS/TSX including tests.

## Out of scope (deliberately)

- Deleting/formatting anything on the SD card.
- Google Drive API / rclone upload (revisit only if the desktop-mount approach falls short).
- Google Photos & Immich upload (Phase 3 — Sync page).
- Windows/Linux volume detection (command shape is ready; implementation deferred).
