//! Persistent import catalog for cross-session deduplication and backup tracking.
//!
//! Dedup during ingest is normally done by checking whether a file already
//! exists at its computed destination path. That breaks once the local
//! working folder (e.g. a Lightroom staging area) gets cleaned out: the next
//! import of the same SD card would re-copy everything. This module records
//! every file ever imported (by content hash) in a SQLite database so that
//! "have I seen this before?" no longer depends on what's still on disk.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub struct Catalog {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NewSession {
    pub id: String,
    pub started_at: String,
    pub source_path: String,
    pub source_label: Option<String>,
    pub dest_path: String,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionCounts {
    pub total_files: usize,
    pub imported: usize,
    pub skipped_duplicates: usize,
    pub skipped_no_date: usize,
    pub errors: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSession {
    pub id: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub source_path: String,
    pub source_label: Option<String>,
    pub dest_path: String,
    pub backup_path: Option<String>,
    pub total_files: i64,
    pub imported: i64,
    pub skipped_duplicates: i64,
    pub skipped_no_date: i64,
    pub errors: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewImport {
    pub session_id: String,
    pub quick_hash: String,
    pub full_hash: Option<String>,
    pub file_size: u64,
    pub original_name: String,
    pub source_path: Option<String>,
    pub local_path: String,
    pub date_taken: Option<String>,
    pub camera_model: Option<String>,
    pub imported_at: String,
    /// "pending" if a backup destination is configured, "skipped" otherwise.
    pub backup_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedFile {
    pub id: i64,
    pub session_id: Option<String>,
    pub quick_hash: String,
    pub full_hash: Option<String>,
    pub file_size: i64,
    pub original_name: String,
    pub source_path: Option<String>,
    pub local_path: String,
    pub date_taken: Option<String>,
    pub camera_model: Option<String>,
    pub imported_at: String,
    pub backup_status: String,
    pub backup_path: Option<String>,
    pub backed_up_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CatalogStats {
    pub total_files: i64,
    pub pending_backups: i64,
    pub last_import_at: Option<String>,
}

const IMPORTED_FILE_COLUMNS: &str = "id, session_id, quick_hash, full_hash, file_size, original_name, \
     source_path, local_path, date_taken, camera_model, imported_at, backup_status, backup_path, backed_up_at";

impl Catalog {
    /// Open (creating if necessary) the catalog database in the app data directory.
    pub fn open(app_handle: &tauri::AppHandle) -> Result<Self, String> {
        use tauri::Manager;
        let dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;
        Self::open_at(&dir.join("catalog.sqlite"))
    }

    /// Open (creating if necessary) the catalog database at an explicit path.
    /// Exposed directly so tests can point at a tempdir instead of a real app data dir.
    pub fn open_at(path: &Path) -> Result<Self, String> {
        let conn =
            Connection::open(path).map_err(|e| format!("Failed to open catalog db: {}", e))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "busy_timeout", 5000i64)
            .map_err(|e| e.to_string())?;
        let catalog = Catalog { conn };
        catalog.migrate()?;
        Ok(catalog)
    }

    fn migrate(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
            CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

            CREATE TABLE IF NOT EXISTS import_sessions (
              id                  TEXT PRIMARY KEY,
              started_at          TEXT NOT NULL,
              finished_at         TEXT,
              source_path         TEXT NOT NULL,
              source_label        TEXT,
              dest_path           TEXT NOT NULL,
              backup_path         TEXT,
              total_files         INTEGER NOT NULL DEFAULT 0,
              imported            INTEGER NOT NULL DEFAULT 0,
              skipped_duplicates  INTEGER NOT NULL DEFAULT 0,
              skipped_no_date     INTEGER NOT NULL DEFAULT 0,
              errors              INTEGER NOT NULL DEFAULT 0,
              status              TEXT NOT NULL DEFAULT 'running'
            );

            CREATE TABLE IF NOT EXISTS imported_files (
              id            INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id    TEXT REFERENCES import_sessions(id),
              quick_hash    TEXT NOT NULL,
              full_hash     TEXT,
              file_size     INTEGER NOT NULL,
              original_name TEXT NOT NULL,
              source_path   TEXT,
              local_path    TEXT NOT NULL,
              date_taken    TEXT,
              camera_model  TEXT,
              imported_at   TEXT NOT NULL,
              backup_status TEXT NOT NULL DEFAULT 'pending',
              backup_path   TEXT,
              backed_up_at  TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_files_quick  ON imported_files(quick_hash, file_size);
            CREATE INDEX IF NOT EXISTS idx_files_full   ON imported_files(full_hash);
            CREATE INDEX IF NOT EXISTS idx_files_backup ON imported_files(backup_status);
            ",
            )
            .map_err(|e| format!("Failed to migrate catalog schema: {}", e))?;

        let version_rows: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version_rows == 0 {
            self.conn
                .execute(
                    "INSERT INTO schema_version (version) VALUES (?1)",
                    params![1i64],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn row_to_imported_file(row: &rusqlite::Row) -> rusqlite::Result<ImportedFile> {
        Ok(ImportedFile {
            id: row.get(0)?,
            session_id: row.get(1)?,
            quick_hash: row.get(2)?,
            full_hash: row.get(3)?,
            file_size: row.get(4)?,
            original_name: row.get(5)?,
            source_path: row.get(6)?,
            local_path: row.get(7)?,
            date_taken: row.get(8)?,
            camera_model: row.get(9)?,
            imported_at: row.get(10)?,
            backup_status: row.get(11)?,
            backup_path: row.get(12)?,
            backed_up_at: row.get(13)?,
        })
    }

    /// Look up a previously imported file by its quick hash + size.
    pub fn find_by_quick_hash(
        &self,
        quick_hash: &str,
        size: u64,
    ) -> Result<Option<ImportedFile>, String> {
        self.conn
            .query_row(
                &format!(
                    "SELECT {} FROM imported_files WHERE quick_hash = ?1 AND file_size = ?2 LIMIT 1",
                    IMPORTED_FILE_COLUMNS
                ),
                params![quick_hash, size as i64],
                Self::row_to_imported_file,
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn create_session(&self, s: &NewSession) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO import_sessions (id, started_at, source_path, source_label, dest_path, backup_path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![s.id, s.started_at, s.source_path, s.source_label, s.dest_path, s.backup_path],
            )
            .map_err(|e| format!("Failed to create session: {}", e))?;
        Ok(())
    }

    pub fn finish_session(
        &self,
        id: &str,
        counts: &SessionCounts,
        status: &str,
    ) -> Result<(), String> {
        let finished_at = chrono::Local::now().to_rfc3339();
        self.conn
            .execute(
                "UPDATE import_sessions SET finished_at = ?1, total_files = ?2, imported = ?3,
                    skipped_duplicates = ?4, skipped_no_date = ?5, errors = ?6, status = ?7
                 WHERE id = ?8",
                params![
                    finished_at,
                    counts.total_files as i64,
                    counts.imported as i64,
                    counts.skipped_duplicates as i64,
                    counts.skipped_no_date as i64,
                    counts.errors as i64,
                    status,
                    id,
                ],
            )
            .map_err(|e| format!("Failed to finish session: {}", e))?;
        Ok(())
    }

    pub fn record_import(&self, rec: &NewImport) -> Result<i64, String> {
        self.conn
            .execute(
                "INSERT INTO imported_files
                    (session_id, quick_hash, full_hash, file_size, original_name, source_path,
                     local_path, date_taken, camera_model, imported_at, backup_status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    rec.session_id,
                    rec.quick_hash,
                    rec.full_hash,
                    rec.file_size as i64,
                    rec.original_name,
                    rec.source_path,
                    rec.local_path,
                    rec.date_taken,
                    rec.camera_model,
                    rec.imported_at,
                    rec.backup_status,
                ],
            )
            .map_err(|e| format!("Failed to record import: {}", e))?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn pending_backups(&self, limit: usize) -> Result<Vec<ImportedFile>, String> {
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT {} FROM imported_files WHERE backup_status = 'pending' ORDER BY imported_at ASC LIMIT ?1",
                IMPORTED_FILE_COLUMNS
            ))
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![limit as i64], Self::row_to_imported_file)
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn mark_backup(
        &self,
        file_id: i64,
        status: &str,
        backup_path: Option<&str>,
    ) -> Result<(), String> {
        let backed_up_at = if status == "done" {
            Some(chrono::Local::now().to_rfc3339())
        } else {
            None
        };
        self.conn
            .execute(
                "UPDATE imported_files SET backup_status = ?1, backup_path = ?2, backed_up_at = ?3 WHERE id = ?4",
                params![status, backup_path, backed_up_at, file_id],
            )
            .map_err(|e| format!("Failed to update backup status: {}", e))?;
        Ok(())
    }

    pub fn stats(&self) -> Result<CatalogStats, String> {
        let total_files: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM imported_files", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let pending_backups: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM imported_files WHERE backup_status = 'pending'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let last_import_at: Option<String> = self
            .conn
            .query_row("SELECT MAX(imported_at) FROM imported_files", [], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;

        Ok(CatalogStats {
            total_files,
            pending_backups,
            last_import_at,
        })
    }

    pub fn recent_sessions(&self, limit: usize) -> Result<Vec<ImportSession>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, started_at, finished_at, source_path, source_label, dest_path, backup_path,
                        total_files, imported, skipped_duplicates, skipped_no_date, errors, status
                 FROM import_sessions ORDER BY started_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![limit as i64], |row| {
                Ok(ImportSession {
                    id: row.get(0)?,
                    started_at: row.get(1)?,
                    finished_at: row.get(2)?,
                    source_path: row.get(3)?,
                    source_label: row.get(4)?,
                    dest_path: row.get(5)?,
                    backup_path: row.get(6)?,
                    total_files: row.get(7)?,
                    imported: row.get(8)?,
                    skipped_duplicates: row.get(9)?,
                    skipped_no_date: row.get(10)?,
                    errors: row.get(11)?,
                    status: row.get(12)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }
}

/// Path to the catalog database file, so the UI can show the user where it
/// lives and offer to reveal it in the system file manager for inspection
/// with any SQLite browser.
#[tauri::command]
pub fn get_catalog_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(dir.join("catalog.sqlite").to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_catalog_stats(app_handle: tauri::AppHandle) -> Result<CatalogStats, String> {
    Catalog::open(&app_handle)?.stats()
}

#[tauri::command]
pub fn get_recent_sessions(
    app_handle: tauri::AppHandle,
    limit: usize,
) -> Result<Vec<ImportSession>, String> {
    Catalog::open(&app_handle)?.recent_sessions(limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn open_test_catalog() -> (tempfile::TempDir, Catalog) {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("catalog.sqlite");
        let catalog = Catalog::open_at(&db_path).unwrap();
        (dir, catalog)
    }

    fn sample_import(session_id: &str) -> NewImport {
        NewImport {
            session_id: session_id.to_string(),
            quick_hash: "abc123".to_string(),
            full_hash: None,
            file_size: 1024,
            original_name: "DSC_0001.NEF".to_string(),
            source_path: Some("/Volumes/NIKON/DCIM/100NIKON/DSC_0001.NEF".to_string()),
            local_path: "/archive/2024/2024-01-15/DSC_0001.NEF".to_string(),
            date_taken: Some("2024-01-15".to_string()),
            camera_model: Some("NIKON Z6".to_string()),
            imported_at: "2024-01-15T10:00:00Z".to_string(),
            backup_status: "pending".to_string(),
        }
    }

    #[test]
    fn test_open_creates_schema() {
        let (_dir, catalog) = open_test_catalog();
        let stats = catalog.stats().unwrap();
        assert_eq!(stats.total_files, 0);
        assert_eq!(stats.pending_backups, 0);
        assert_eq!(stats.last_import_at, None);
    }

    #[test]
    fn test_reopen_is_idempotent() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("catalog.sqlite");

        {
            let catalog = Catalog::open_at(&db_path).unwrap();
            catalog
                .create_session(&NewSession {
                    id: "session-1".to_string(),
                    started_at: "2024-01-15T10:00:00Z".to_string(),
                    source_path: "/Volumes/NIKON/DCIM".to_string(),
                    source_label: Some("NIKON Z6".to_string()),
                    dest_path: "/archive".to_string(),
                    backup_path: None,
                })
                .unwrap();
        }

        // Reopening the same file should not fail or wipe existing data.
        let catalog2 = Catalog::open_at(&db_path).unwrap();
        let sessions = catalog2.recent_sessions(10).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "session-1");
    }

    #[test]
    fn test_record_and_find_by_quick_hash() {
        let (_dir, catalog) = open_test_catalog();
        catalog
            .create_session(&NewSession {
                id: "session-1".to_string(),
                started_at: "2024-01-15T10:00:00Z".to_string(),
                source_path: "/Volumes/NIKON/DCIM".to_string(),
                source_label: None,
                dest_path: "/archive".to_string(),
                backup_path: None,
            })
            .unwrap();

        let rec = sample_import("session-1");
        let id = catalog.record_import(&rec).unwrap();
        assert!(id > 0);

        let found = catalog.find_by_quick_hash("abc123", 1024).unwrap();
        assert!(found.is_some());
        let found = found.unwrap();
        assert_eq!(found.original_name, "DSC_0001.NEF");
        assert_eq!(found.backup_status, "pending");

        // Different size should not match even with the same hash.
        let not_found = catalog.find_by_quick_hash("abc123", 2048).unwrap();
        assert!(not_found.is_none());

        // Unknown hash should not match.
        let not_found2 = catalog.find_by_quick_hash("zzz999", 1024).unwrap();
        assert!(not_found2.is_none());
    }

    #[test]
    fn test_session_lifecycle() {
        let (_dir, catalog) = open_test_catalog();
        catalog
            .create_session(&NewSession {
                id: "session-1".to_string(),
                started_at: "2024-01-15T10:00:00Z".to_string(),
                source_path: "/Volumes/NIKON/DCIM".to_string(),
                source_label: Some("NIKON Z6".to_string()),
                dest_path: "/archive".to_string(),
                backup_path: Some("/drive/archive".to_string()),
            })
            .unwrap();

        let counts = SessionCounts {
            total_files: 10,
            imported: 8,
            skipped_duplicates: 1,
            skipped_no_date: 1,
            errors: 0,
        };
        catalog.finish_session("session-1", &counts, "complete").unwrap();

        let sessions = catalog.recent_sessions(10).unwrap();
        assert_eq!(sessions.len(), 1);
        let s = &sessions[0];
        assert_eq!(s.status, "complete");
        assert_eq!(s.total_files, 10);
        assert_eq!(s.imported, 8);
        assert_eq!(s.skipped_duplicates, 1);
        assert_eq!(s.skipped_no_date, 1);
        assert!(s.finished_at.is_some());
    }

    #[test]
    fn test_pending_backups_and_mark_backup() {
        let (_dir, catalog) = open_test_catalog();
        catalog
            .create_session(&NewSession {
                id: "session-1".to_string(),
                started_at: "2024-01-15T10:00:00Z".to_string(),
                source_path: "/src".to_string(),
                source_label: None,
                dest_path: "/archive".to_string(),
                backup_path: Some("/drive".to_string()),
            })
            .unwrap();

        let mut rec1 = sample_import("session-1");
        rec1.quick_hash = "hash1".to_string();
        let id1 = catalog.record_import(&rec1).unwrap();

        let mut rec2 = sample_import("session-1");
        rec2.quick_hash = "hash2".to_string();
        rec2.backup_status = "skipped".to_string();
        catalog.record_import(&rec2).unwrap();

        let pending = catalog.pending_backups(10).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].quick_hash, "hash1");

        catalog
            .mark_backup(id1, "done", Some("/drive/2024/2024-01-15/DSC_0001.NEF"))
            .unwrap();

        let pending_after = catalog.pending_backups(10).unwrap();
        assert_eq!(pending_after.len(), 0);

        let stats = catalog.stats().unwrap();
        assert_eq!(stats.total_files, 2);
        assert_eq!(stats.pending_backups, 0);
    }

    #[test]
    fn test_mark_backup_failed_does_not_set_backed_up_at() {
        let (_dir, catalog) = open_test_catalog();
        catalog
            .create_session(&NewSession {
                id: "session-1".to_string(),
                started_at: "2024-01-15T10:00:00Z".to_string(),
                source_path: "/src".to_string(),
                source_label: None,
                dest_path: "/archive".to_string(),
                backup_path: Some("/drive".to_string()),
            })
            .unwrap();

        let id = catalog.record_import(&sample_import("session-1")).unwrap();
        catalog.mark_backup(id, "failed", None).unwrap();

        let pending = catalog.pending_backups(10).unwrap();
        assert_eq!(pending.len(), 0); // "failed" is not "pending"

        let found = catalog.find_by_quick_hash("abc123", 1024).unwrap().unwrap();
        assert_eq!(found.backup_status, "failed");
        assert_eq!(found.backed_up_at, None);
    }

    #[test]
    fn test_pending_backups_respects_limit() {
        let (_dir, catalog) = open_test_catalog();
        catalog
            .create_session(&NewSession {
                id: "session-1".to_string(),
                started_at: "2024-01-15T10:00:00Z".to_string(),
                source_path: "/src".to_string(),
                source_label: None,
                dest_path: "/archive".to_string(),
                backup_path: Some("/drive".to_string()),
            })
            .unwrap();

        for i in 0..5 {
            let mut rec = sample_import("session-1");
            rec.quick_hash = format!("hash{}", i);
            catalog.record_import(&rec).unwrap();
        }

        let pending = catalog.pending_backups(3).unwrap();
        assert_eq!(pending.len(), 3);
    }

    #[test]
    fn test_recent_sessions_ordering() {
        let (_dir, catalog) = open_test_catalog();
        catalog
            .create_session(&NewSession {
                id: "session-1".to_string(),
                started_at: "2024-01-15T10:00:00Z".to_string(),
                source_path: "/src".to_string(),
                source_label: None,
                dest_path: "/archive".to_string(),
                backup_path: None,
            })
            .unwrap();
        catalog
            .create_session(&NewSession {
                id: "session-2".to_string(),
                started_at: "2024-02-15T10:00:00Z".to_string(),
                source_path: "/src".to_string(),
                source_label: None,
                dest_path: "/archive".to_string(),
                backup_path: None,
            })
            .unwrap();

        let sessions = catalog.recent_sessions(10).unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].id, "session-2"); // most recent first
        assert_eq!(sessions[1].id, "session-1");
    }

    #[test]
    fn test_stats_last_import_at() {
        let (_dir, catalog) = open_test_catalog();
        catalog
            .create_session(&NewSession {
                id: "session-1".to_string(),
                started_at: "2024-01-15T10:00:00Z".to_string(),
                source_path: "/src".to_string(),
                source_label: None,
                dest_path: "/archive".to_string(),
                backup_path: None,
            })
            .unwrap();

        let mut rec1 = sample_import("session-1");
        rec1.quick_hash = "hash1".to_string();
        rec1.imported_at = "2024-01-15T10:00:00Z".to_string();
        catalog.record_import(&rec1).unwrap();

        let mut rec2 = sample_import("session-1");
        rec2.quick_hash = "hash2".to_string();
        rec2.imported_at = "2024-06-01T10:00:00Z".to_string();
        catalog.record_import(&rec2).unwrap();

        let stats = catalog.stats().unwrap();
        assert_eq!(stats.total_files, 2);
        assert_eq!(stats.last_import_at, Some("2024-06-01T10:00:00Z".to_string()));
    }
}
