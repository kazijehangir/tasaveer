//! Organization module for sorting media files into date-based directory structure.
//!
//! This replaces the external phockup dependency with native Rust logic.
//! Files are organized into YYYY/YYYY-MM-DD format based on EXIF DateTimeOriginal.

use crate::catalog::{Catalog, NewImport, NewSession, SessionCounts};
use crate::metadata::extract_date_from_filename;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Emitter;
use walkdir::WalkDir;

/// Compute the full SHA-256 hash of a file's entire contents.
///
/// Distinct from `Organizer::compute_file_hash`, which only hashes the first
/// 64KB + size for speed. The full hash is required whenever a decision would
/// destroy data (deleting a source file after a "duplicate" match), since the
/// quick hash alone cannot rule out a collision between genuinely different
/// files that happen to share their first 64KB and total size.
pub(crate) fn compute_full_file_hash(path: &Path) -> Result<String, std::io::Error> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Stream-copy `src` to `dst`, hashing the source as it is written, then
/// re-read `dst` and confirm the hash matches before returning success.
///
/// On any failure (I/O error or hash mismatch) the possibly-partial
/// destination file is removed; the source is never touched by this function.
pub(crate) fn copy_and_verify(src: &Path, dst: &Path) -> Result<String, String> {
    let copy_result = (|| -> Result<String, std::io::Error> {
        let mut source_file = fs::File::open(src)?;
        let mut dest_file = fs::File::create(dst)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let n = source_file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
            dest_file.write_all(&buffer[..n])?;
        }
        Ok(format!("{:x}", hasher.finalize()))
    })();

    let source_hash = match copy_result {
        Ok(h) => h,
        Err(e) => {
            let _ = fs::remove_file(dst);
            return Err(format!("Failed to copy {:?} -> {:?}: {}", src, dst, e));
        }
    };

    match compute_full_file_hash(dst) {
        Ok(dest_hash) if dest_hash == source_hash => Ok(source_hash),
        Ok(_) => {
            let _ = fs::remove_file(dst);
            Err(format!(
                "Verification failed: copy of {:?} does not match source",
                src
            ))
        }
        Err(e) => {
            let _ = fs::remove_file(dst);
            Err(format!("Failed to verify copy of {:?}: {}", src, e))
        }
    }
}

/// Media extensions we support
pub const MEDIA_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "bmp", "tiff", "tif", "raw", "cr2", "nef",
    "arw", "dng", "mp4", "mov", "avi", "mkv", "m4v", "webm", "3gp", "wmv", "flv",
];

/// Result of a file organization operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizeResult {
    pub total_files: usize,
    pub organized: usize,
    pub skipped: usize,
    pub duplicates: usize,
    pub errors: usize,
}

/// Progress update emitted during organization
#[derive(Clone, Serialize)]
pub struct OrganizeProgress {
    pub id: String,
    pub current: usize,
    pub total: usize,
    pub current_file: String,
    pub status: String,
}

/// Single file result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOrganizeResult {
    pub source_path: String,
    pub dest_path: Option<String>,
    pub status: String, // "organized", "skipped", "duplicate", "error"
    pub message: Option<String>,
}

/// Preview result for dry-run
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizePreview {
    pub files: Vec<FileOrganizeResult>,
    pub total_files: usize,
    pub will_organize: usize,
    pub will_skip: usize,
    pub duplicates: usize,
    pub already_imported: usize,
}

/// Options controlling a unified ingest run beyond the basic source/dest paths
/// and copy/move strategy (which stay direct arguments on `Organizer`).
pub struct IngestOptions<'a> {
    pub rules: &'a [crate::metadata::TagRule],
    pub enable_tagging: bool,
    /// Import catalog for cross-session dedup + backup tracking. `None` disables
    /// catalog-aware behavior; dedup then falls back to in-run and
    /// destination-path collision checks only, same as before this existed.
    pub catalog: Option<&'a Catalog>,
    pub session_id: String,
    pub source_label: Option<String>,
    /// Destination folder files should eventually be mirrored to (e.g. a
    /// Google Drive mount). Not acted on here - only recorded on the session
    /// and used to decide whether new imports start as "pending" backup or
    /// "skipped" - the actual mirroring is a separate pass (`run_backup_sync`).
    pub backup_path: Option<String>,
}

/// Core organization engine
pub struct Organizer {
    pub dest_root: PathBuf,
    pub move_files: bool,
    pub exiftool_path: PathBuf,
    pub daemon: Option<crate::exiftool_daemon::SharedExifToolDaemon>,
}

impl Organizer {
    pub fn new(
        dest_root: PathBuf,
        move_files: bool,
        exiftool_path: Option<PathBuf>,
        daemon: Option<crate::exiftool_daemon::SharedExifToolDaemon>,
    ) -> Self {
        Self {
            dest_root,
            move_files,
            exiftool_path: exiftool_path.unwrap_or_else(|| PathBuf::from("exiftool")),
            daemon,
        }
    }

    /// True if two files are byte-for-byte identical (full hash comparison).
    ///
    /// Used to confirm a duplicate before deleting anything: `compute_file_hash`
    /// only hashes the first 64KB + size, which is cheap and fine for deciding
    /// whether to *skip a copy*, but is not a strong enough guarantee to justify
    /// deleting a source file. Any hashing failure (e.g. a file that vanished)
    /// is treated as "not confirmed" so callers default to the safe path.
    fn full_hash_matches(&self, a: &Path, b: &Path) -> bool {
        match (compute_full_file_hash(a), compute_full_file_hash(b)) {
            (Ok(ha), Ok(hb)) => ha == hb,
            _ => false,
        }
    }

    /// Compute SHA-256 hash of a file (first 64KB for performance)
    pub fn compute_file_hash(&self, path: &Path) -> Result<String, std::io::Error> {
        let mut file = fs::File::open(path)?;
        let mut hasher = Sha256::new();

        // Read first 64KB for quick hash (good enough for dedup)
        let mut buffer = vec![0u8; 65536];
        let bytes_read = file.read(&mut buffer)?;
        hasher.update(&buffer[..bytes_read]);

        // Also include file size in hash to reduce collisions
        let metadata = fs::metadata(path)?;
        hasher.update(metadata.len().to_le_bytes());

        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Extract date from file (EXIF or filename)
    ///
    /// Tries `DateTimeOriginal` first, then falls back to `CreateDate`: video
    /// containers (MOV/MP4 from cameras) commonly lack `DateTimeOriginal` but
    /// carry a `CreateDate` (QuickTime's media creation timestamp), so without
    /// this fallback camera videos would always land in "skipped, no date".
    pub fn get_file_date(&self, file_path: &str) -> Option<String> {
        // Try EXIF via daemon first if available
        let date_from_exif = if let Some(daemon) = &self.daemon {
            if let Ok(json_str) = daemon.read_metadata_json(file_path) {
                let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&json_str);
                if let Ok(arr) = parsed {
                    arr.first().and_then(Self::date_from_exif_json)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            // Fallback to per-file command
            if let Ok(metadata) =
                crate::metadata::read_exif_metadata_internal(&self.exiftool_path, file_path)
            {
                metadata
                    .date_time_original
                    .as_deref()
                    .and_then(crate::metadata::format_exif_date)
                    .or_else(|| {
                        metadata
                            .create_date
                            .as_deref()
                            .and_then(crate::metadata::format_exif_date)
                    })
            } else {
                None
            }
        };

        if date_from_exif.is_some() {
            return date_from_exif;
        }

        // Fall back to filename extraction
        let filename = Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        extract_date_from_filename(filename).map(|ext| ext.date)
    }

    /// Extract a date from a single ExifTool JSON record, trying
    /// `DateTimeOriginal` then `CreateDate` (see `get_file_date`).
    fn date_from_exif_json(value: &serde_json::Value) -> Option<String> {
        value
            .get("DateTimeOriginal")
            .and_then(|v| v.as_str())
            .and_then(crate::metadata::format_exif_date)
            .or_else(|| {
                value
                    .get("CreateDate")
                    .and_then(|v| v.as_str())
                    .and_then(crate::metadata::format_exif_date)
            })
    }

    /// Calculate destination path for a file
    pub fn calculate_dest_path(&self, file_path: &Path, date: &str) -> PathBuf {
        if date == "Unknown-Date" || date == "unknown" || date.is_empty() {
            return self.dest_root.join("Unknown-Date").join(
                file_path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
            );
        }
        // Date format: YYYY-MM-DD
        let parts: Vec<&str> = date.split('-').collect();
        if parts.len() != 3 {
            // Invalid date, put in "Unknown-Date" folder
            return self.dest_root.join("Unknown-Date").join(
                file_path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
            );
        }

        let year = parts[0];
        let folder_date = date; // YYYY-MM-DD

        // Structure: YYYY/YYYY-MM-DD/filename
        self.dest_root.join(year).join(folder_date).join(
            file_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
        )
    }

    /// Handle filename collision by appending counter
    pub fn resolve_collision(&self, dest_path: &Path) -> PathBuf {
        if !dest_path.exists() {
            return dest_path.to_path_buf();
        }

        let stem = dest_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        let ext = dest_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let parent = dest_path.parent().unwrap_or(Path::new("."));

        for i in 1..1000 {
            let new_name = if ext.is_empty() {
                format!("{}_{}", stem, i)
            } else {
                format!("{}_{}.{}", stem, i, ext)
            };
            let new_path = parent.join(new_name);
            if !new_path.exists() {
                return new_path;
            }
        }

        // Fallback: use timestamp
        let now = chrono::Local::now().format("%Y%m%d_%H%M%S");
        parent.join(format!("{}_{}.{}", stem, now, ext))
    }

    /// Preview organization (dry-run)
    pub fn preview(
        &self,
        source: &Path,
        catalog: Option<&Catalog>,
    ) -> Result<OrganizePreview, String> {
        if !source.exists() {
            return Err(format!("Source path does not exist: {:?}", source));
        }

        let mut files = Vec::new();
        let mut will_organize = 0;
        let will_skip = 0;
        let mut duplicates = 0;
        let mut already_imported = 0;

        // Track hashes for duplicate detection within preview
        let mut seen_hashes: HashMap<String, String> = HashMap::new();

        for entry in WalkDir::new(source)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();

            if path.is_dir() || !self.is_media_file(path) {
                continue;
            }

            let file_path_str = path.to_string_lossy().to_string();

            // Compute the hash early so a catalog hit can skip the EXIF/date
            // lookup entirely for files we already know about.
            let hash_result = self.compute_file_hash(path);

            if let (Some(cat), Ok(hash)) = (catalog, &hash_result) {
                let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                if let Ok(Some(existing)) = cat.find_by_quick_hash(hash, size) {
                    files.push(FileOrganizeResult {
                        source_path: file_path_str,
                        dest_path: Some(existing.local_path.clone()),
                        status: "already_imported".to_string(),
                        message: Some(format!("Already imported on {}", existing.imported_at)),
                    });
                    already_imported += 1;
                    continue;
                }
            }

            // Get date
            let date = self.get_file_date(&file_path_str);

            let (date_str, message) = match date {
                Some(d) => (d, None),
                None => (
                    "Unknown-Date".to_string(),
                    Some("No date found; importing to Unknown-Date".to_string()),
                ),
            };

            let dest_file = self.calculate_dest_path(path, &date_str);

            // Check for duplicates within this preview pass
            if let Ok(hash) = &hash_result {
                if let Some(existing) = seen_hashes.get(hash) {
                    files.push(FileOrganizeResult {
                        source_path: file_path_str,
                        dest_path: None,
                        status: "duplicate".to_string(),
                        message: Some(format!("Duplicate of {}", existing)),
                    });
                    duplicates += 1;
                    continue;
                }
                seen_hashes.insert(hash.clone(), file_path_str.clone());
            }

            files.push(FileOrganizeResult {
                source_path: file_path_str,
                dest_path: Some(dest_file.to_string_lossy().to_string()),
                status: "will_organize".to_string(),
                message,
            });
            will_organize += 1;
        }

        Ok(OrganizePreview {
            total_files: files.len(),
            files,
            will_organize,
            will_skip,
            duplicates,
            already_imported,
        })
    }

    /// Run organization (move/copy files) with progress and cancellation support
    pub fn run<F, C>(
        &self,
        source: &Path,
        mut on_progress: F,
        is_cancelled: C,
    ) -> Result<OrganizeResult, String>
    where
        F: FnMut(usize, usize, &str, &str), // current, total, filename, status
        C: Fn() -> bool,
    {
        if !source.exists() {
            return Err(format!("Source path does not exist: {:?}", source));
        }

        // Count total files first
        let total_files: usize = WalkDir::new(source)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file() && self.is_media_file(e.path()))
            .count();

        let mut organized = 0;
        let skipped = 0;
        let mut duplicates = 0;
        let mut errors = 0;
        let mut current = 0;

        // Track hashes for duplicate detection
        let mut seen_hashes: HashMap<String, String> = HashMap::new();
        let dest_path_str = self.dest_root.to_string_lossy().to_string();

        for entry in WalkDir::new(source)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            // Check cancellation
            if is_cancelled() {
                return Ok(OrganizeResult {
                    total_files,
                    organized,
                    skipped,
                    duplicates,
                    errors,
                });
            }

            let path = entry.path();

            if path.is_dir() || !self.is_media_file(path) {
                continue;
            }

            current += 1;
            let file_path_str = path.to_string_lossy().to_string();
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");

            // Report progress
            if current % 5 == 0 || current == 1 || current == total_files {
                on_progress(current, total_files, filename, "processing");
            }

            // Get date
            let date = match self.get_file_date(&file_path_str) {
                Some(d) => d,
                None => "Unknown-Date".to_string(),
            };

            // Check for duplicates via hash
            let hash = match self.compute_file_hash(path) {
                Ok(h) => h,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };

            if let Some(existing) = seen_hashes.get(&hash) {
                // Check if the existing file is in dest (already processed). The
                // quick hash alone can theoretically collide on genuinely
                // different files, so a full-hash comparison confirms it before
                // anything is deleted.
                if existing.starts_with(&dest_path_str)
                    && self.full_hash_matches(path, Path::new(existing))
                {
                    duplicates += 1;
                    // If moving, delete the duplicate source
                    if self.move_files {
                        let _ = fs::remove_file(path);
                    }
                    continue;
                }
            }

            // Calculate destination
            let mut dest_file = self.calculate_dest_path(path, &date);

            // Handle collision
            if dest_file.exists() {
                // Check if it's the same file (by hash)
                if let Ok(existing_hash) = self.compute_file_hash(&dest_file) {
                    if existing_hash == hash && self.full_hash_matches(path, &dest_file) {
                        duplicates += 1;
                        if self.move_files {
                            let _ = fs::remove_file(path);
                        }
                        continue;
                    }
                }
                // Different file, resolve collision
                dest_file = self.resolve_collision(&dest_file);
            }

            // Create parent directories
            if let Some(parent) = dest_file.parent() {
                if let Err(e) = fs::create_dir_all(parent) {
                    eprintln!("Failed to create directory {:?}: {}", parent, e);
                    errors += 1;
                    continue;
                }
            }

            // Move or copy. Copies are always verified (streamed hash of the
            // source compared against a fresh read of the destination) before
            // the operation counts as successful; a same-filesystem rename is
            // atomic and needs no verification.
            let result = if self.move_files {
                fs::rename(path, &dest_file).or_else(|_| {
                    // Cross-filesystem: verified copy, then delete source only on success.
                    copy_and_verify(path, &dest_file)
                        .map(|_| ())
                        .and_then(|_| fs::remove_file(path).map_err(|e| e.to_string()))
                        .map_err(std::io::Error::other)
                })
            } else {
                copy_and_verify(path, &dest_file)
                    .map(|_| ())
                    .map_err(std::io::Error::other)
            };

            match result {
                Ok(_) => {
                    organized += 1;
                    seen_hashes.insert(hash, dest_file.to_string_lossy().to_string());
                }
                Err(e) => {
                    eprintln!(
                        "Failed to {} {:?}: {}",
                        if self.move_files { "move" } else { "copy" },
                        path,
                        e
                    );
                    errors += 1;
                }
            }
        }

        Ok(OrganizeResult {
            total_files,
            organized,
            skipped,
            duplicates,
            errors,
        })
    }

    /// Unified ingest (Scan -> Hash -> Organize -> Tag)
    pub fn unified_ingest<F, C>(
        &self,
        source: &Path,
        options: &IngestOptions,
        mut on_progress: F,
        is_cancelled: C,
    ) -> Result<OrganizeResult, String>
    where
        F: FnMut(usize, usize, &str, &str),
        C: Fn() -> bool,
    {
        use rayon::prelude::*;

        if !source.exists() {
            return Err(format!("Source path does not exist: {:?}", source));
        }

        let rules = options.rules;
        let enable_tagging = options.enable_tagging;

        on_progress(0, 100, "Scanning source...", "scanning");

        // 1. Discovery phase
        let all_files: Vec<PathBuf> = WalkDir::new(source)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file() && self.is_media_file(e.path()))
            .map(|e| e.path().to_path_buf())
            .collect();

        let total_files = all_files.len();

        // 2. Parallel hashing (quick hash + size, needed for both in-run and
        // catalog dedup lookups)
        on_progress(0, total_files, "Computing file hashes...", "hashing");

        let file_hashes: HashMap<PathBuf, (String, u64)> = all_files
            .par_iter()
            .map(|path| {
                let hash = self.compute_file_hash(path).unwrap_or_default();
                let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                (path.clone(), (hash, size))
            })
            .collect();

        // Best-effort catalog session: if it can't be created (e.g. the
        // catalog DB failed to open), ingest proceeds without catalog dedup
        // or recording rather than blocking the user's import.
        let catalog_active = if let Some(cat) = options.catalog {
            let session = NewSession {
                id: options.session_id.clone(),
                started_at: chrono::Local::now().to_rfc3339(),
                source_path: source.to_string_lossy().to_string(),
                source_label: options.source_label.clone(),
                dest_path: self.dest_root.to_string_lossy().to_string(),
                backup_path: options.backup_path.clone(),
            };
            match cat.create_session(&session) {
                Ok(()) => true,
                Err(e) => {
                    eprintln!("Failed to create catalog session (continuing without catalog): {}", e);
                    false
                }
            }
        } else {
            false
        };
        let catalog = options.catalog.filter(|_| catalog_active);
        let backup_status = if options.backup_path.is_some() { "pending" } else { "skipped" };

        let mut organized = 0;
        let skipped = 0;
        let mut duplicates = 0;
        let mut errors = 0;
        let mut current = 0;

        // Track hashes for duplicate detection
        let mut seen_hashes: HashMap<String, String> = HashMap::new();
        let mut tag_groups: HashMap<String, Vec<PathBuf>> = HashMap::new();
        let dest_path_str = self.dest_root.to_string_lossy().to_string();

        // 3. Processing loop
        for path in all_files {
            if is_cancelled() {
                break;
            }

            current += 1;
            let file_path_str = path.to_string_lossy().to_string();
            let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown");

            if current % 10 == 0 || current == 1 || current == total_files {
                on_progress(current, total_files, filename, "processing");
            }

            // Use precomputed hash + size
            let (hash, size) = file_hashes.get(&path).cloned().unwrap_or_default();
            if hash.is_empty() {
                errors += 1;
                continue;
            }

            // Catalog lookup: has this exact file been imported before,
            // regardless of whether it (or the destination it went to) still
            // exists? Checked before any EXIF/date work so already-known
            // files skip that cost entirely.
            if let Some(cat) = catalog {
                if let Ok(Some(existing)) = cat.find_by_quick_hash(&hash, size) {
                    duplicates += 1;
                    if self.move_files {
                        // A quick-hash match against a file that (per the
                        // catalog) may no longer exist anywhere is not
                        // enough to justify deleting the source. Only do so
                        // if we can confirm identity via the previously
                        // recorded full hash.
                        let confirmed = existing
                            .full_hash
                            .as_deref()
                            .map(|full| {
                                compute_full_file_hash(&path)
                                    .map(|ph| ph == full)
                                    .unwrap_or(false)
                            })
                            .unwrap_or(false);
                        if confirmed {
                            let _ = fs::remove_file(&path);
                        }
                    }
                    continue;
                }
            }

            // Get date
            let date = match self.get_file_date(&file_path_str) {
                Some(d) => d,
                None => "Unknown-Date".to_string(),
            };

            // Check duplicates from this run / from the destination archive.
            // The quick hash alone can theoretically collide on genuinely
            // different files, so a full-hash comparison confirms it before
            // anything is deleted or skipped.
            if let Some(existing) = seen_hashes.get(&hash) {
                if existing.starts_with(&dest_path_str)
                    && self.full_hash_matches(&path, Path::new(existing))
                {
                    duplicates += 1;
                    if self.move_files {
                        let _ = fs::remove_file(&path);
                    }
                    continue;
                }
            }

            let mut dest_file = self.calculate_dest_path(&path, &date);
            if dest_file.exists() {
                if let Ok(existing_hash) = self.compute_file_hash(&dest_file) {
                    if existing_hash == hash && self.full_hash_matches(&path, &dest_file) {
                        duplicates += 1;
                        if self.move_files {
                            let _ = fs::remove_file(&path);
                        }
                        continue;
                    }
                }
                dest_file = self.resolve_collision(&dest_file);
            }

            // Enforce low disk space safeguard (5 GB min free)
            if let Err(e) = crate::disk::check_disk_space(&self.dest_root, 5 * 1024 * 1024 * 1024) {
                return Err(e);
            }

            // Create directory
            if let Some(parent) = dest_file.parent() {
                let _ = fs::create_dir_all(parent);
            }

            // Move or copy. Every new import is verified: a same-filesystem
            // rename is atomic and needs no check, but any copy (including
            // the cross-filesystem move fallback) is streamed and hash
            // -verified against the destination before it counts as success.
            let full_hash: Option<String> = if self.move_files {
                match fs::rename(&path, &dest_file) {
                    Ok(_) => compute_full_file_hash(&dest_file).ok(),
                    Err(_) => match copy_and_verify(&path, &dest_file) {
                        Ok(h) => {
                            let _ = fs::remove_file(&path);
                            Some(h)
                        }
                        Err(e) => {
                            eprintln!("Failed to move (verified copy) {:?}: {}", path, e);
                            None
                        }
                    },
                }
            } else {
                match copy_and_verify(&path, &dest_file) {
                    Ok(h) => Some(h),
                    Err(e) => {
                        eprintln!("Failed to copy {:?}: {}", path, e);
                        None
                    }
                }
            };

            if let Some(full_hash) = full_hash {
                organized += 1;
                let final_dest_str = dest_file.to_string_lossy().to_string();
                seen_hashes.insert(hash.clone(), final_dest_str.clone());

                // Tagging logic
                let mut camera_model: Option<String> = None;
                if enable_tagging {
                    camera_model = if let Some(daemon) = &self.daemon {
                        daemon.read_metadata_json(&final_dest_str)
                            .ok()
                            .and_then(|json| {
                                let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&json);
                                parsed.ok()?.first()?.get("Model")?.as_str().map(|s| s.to_string())
                            })
                    } else {
                        crate::metadata::read_exif_metadata_internal(&self.exiftool_path, &final_dest_str)
                            .ok()
                            .and_then(|m| m.model)
                    };

                    let rel_path_from_source = path.strip_prefix(source).ok()
                        .and_then(|p| p.parent())
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default();

                    for rule in rules {
                        let mut matched = false;
                        if let Some(model) = &camera_model {
                            if rule.camera_models.iter().any(|m| model.contains(m)) {
                                matched = true;
                            }
                        }
                        if !matched && !rel_path_from_source.is_empty() {
                            if rule.directory_patterns.iter().any(|p| rel_path_from_source.contains(p)) {
                                matched = true;
                            }
                        }

                        if matched {
                            tag_groups.entry(rule.name.clone()).or_default().push(dest_file.clone());
                            break;
                        }
                    }
                }

                if let Some(cat) = catalog {
                    let record = NewImport {
                        session_id: options.session_id.clone(),
                        quick_hash: hash,
                        full_hash: Some(full_hash),
                        file_size: size,
                        original_name: filename.to_string(),
                        source_path: Some(file_path_str),
                        local_path: final_dest_str,
                        date_taken: Some(date),
                        camera_model,
                        imported_at: chrono::Local::now().to_rfc3339(),
                        backup_status: backup_status.to_string(),
                    };
                    if let Err(e) = cat.record_import(&record) {
                        eprintln!("Failed to record import in catalog: {}", e);
                    }
                }
            } else {
                errors += 1;
            }
        }

        // 4. Batch tagging
        if enable_tagging && !tag_groups.is_empty() {
            let total_tag_groups = tag_groups.len();
            for (i, (tag_name, files)) in tag_groups.into_iter().enumerate() {
                if is_cancelled() {
                    break;
                }

                on_progress(current, total_files, &format!("Tagging: {}", tag_name), &format!("tagging {}/{}", i + 1, total_tag_groups));

                for chunk in files.chunks(50) {
                    let mut cmd = std::process::Command::new(&self.exiftool_path);
                    cmd.args([
                        "-overwrite_original",
                        "-P",
                        "-sep",
                        ", ",
                        &format!("-Keywords+={}", tag_name),
                        &format!("-Subject+={}", tag_name),
                    ]);
                    for f in chunk {
                        cmd.arg(f.to_string_lossy().to_string());
                    }
                    let _ = cmd.output();
                }
            }
        }

        let result = OrganizeResult {
            total_files,
            organized,
            skipped,
            duplicates,
            errors,
        };

        if let Some(cat) = catalog {
            let status = if is_cancelled() { "cancelled" } else { "complete" };
            let counts = SessionCounts {
                total_files: result.total_files,
                imported: result.organized,
                skipped_duplicates: result.duplicates,
                skipped_no_date: result.skipped,
                errors: result.errors,
            };
            if let Err(e) = cat.finish_session(&options.session_id, &counts, status) {
                eprintln!("Failed to finish catalog session: {}", e);
            }
        }

        Ok(result)
    }

    /// Check if file is a media file

    pub fn is_media_file(&self, path: &Path) -> bool {
        path.extension()
            .and_then(|e| e.to_str())
            .map(|ext| MEDIA_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
            .unwrap_or(false)
    }
}

/// Preview organization (dry run)
#[tauri::command]
pub async fn preview_organize(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    source_path: String,
    dest_path: String,
) -> Result<OrganizePreview, String> {
    let source = Path::new(&source_path);

    // Try to discover exiftool - don't fail preview hard if not found, fallback to system "exiftool"
    let exiftool_path = crate::binaries::Prerequisite::ExifTool
        .discover(&app_handle)
        .ok(); // Convert error to None for optional fallback in Organizer

    // Ensure daemon is started
    let _ = state.exiftool_daemon.ensure_started(None);

    let organizer = Organizer::new(
        PathBuf::from(dest_path),
        false,
        exiftool_path,
        Some(state.exiftool_daemon.clone()),
    );

    // Best-effort: a catalog that fails to open just means the preview can't
    // flag already-imported files, not that preview itself should fail.
    let catalog = crate::catalog::Catalog::open(&app_handle).ok();

    organizer.preview(source, catalog.as_ref())
}

/// Run organization (move/copy files)
#[tauri::command]
pub async fn run_organize(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    source_path: String,
    dest_path: String,
    operation_id: String,
    move_files: bool, // true = move, false = copy
) -> Result<OrganizeResult, String> {
    use std::sync::atomic::Ordering;

    let source = Path::new(&source_path);

    // Try to discover exiftool - error if missing for actual run
    let exiftool_path = crate::binaries::Prerequisite::ExifTool
        .discover(&app_handle)
        .map_err(|e| format!("Failed to find exiftool: {}", e))?;

    // Ensure daemon is started
    let _ = state.exiftool_daemon.ensure_started(None);

    let organizer = Organizer::new(
        PathBuf::from(&dest_path),
        move_files,
        Some(exiftool_path),
        Some(state.exiftool_daemon.clone()),
    );
    let cancel_token = state.register_token(&operation_id);

    let result = organizer.run(
        source,
        |current, total, filename, status| {
            let _ = app_handle.emit(
                "organize-progress",
                OrganizeProgress {
                    id: operation_id.clone(),
                    current,
                    total,
                    current_file: filename.to_string(),
                    status: status.to_string(),
                },
            );
        },
        || cancel_token.load(Ordering::Relaxed),
    );

    state.remove_token(&operation_id);

    // Final progress update if successful
    if let Ok(res) = &result {
        let _ = app_handle.emit(
            "organize-progress",
            OrganizeProgress {
                id: operation_id,
                current: res.total_files,
                total: res.total_files,
                current_file: "Complete".to_string(),
                status: "complete".to_string(),
            },
        );
    }

    result
}

/// Unified ingest command that combines staging, tagging, and organization.
/// This avoids multiple directory scans and IPC overhead.
#[tauri::command]
pub async fn run_unified_ingest(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    source_path: String,
    dest_path: String,
    rules: Vec<crate::metadata::TagRule>,
    move_files: bool,
    enable_tagging: bool,
    operation_id: String,
    source_label: Option<String>,
    backup_path: Option<String>,
) -> Result<OrganizeResult, String> {
    use std::sync::atomic::Ordering;

    let source = Path::new(&source_path);
    let dest = Path::new(&dest_path);

    // Enforce disk space safeguard at startup
    crate::disk::check_disk_space(dest, 5 * 1024 * 1024 * 1024)?;

    // 1. Discovery phase
    let exiftool_path = crate::binaries::Prerequisite::ExifTool
        .discover(&app_handle)
        .map_err(|e| format!("Failed to find exiftool: {}", e))?;

    let _ = state.exiftool_daemon.ensure_started(None);
    let organizer = Organizer::new(
        dest.to_path_buf(),
        move_files,
        Some(exiftool_path),
        Some(state.exiftool_daemon.clone()),
    );
    let cancel_token = state.register_token(&operation_id);

    // Best-effort: a catalog that fails to open just disables cross-session
    // dedup/backup tracking for this run rather than blocking the import.
    let catalog = match crate::catalog::Catalog::open(&app_handle) {
        Ok(cat) => Some(cat),
        Err(e) => {
            eprintln!("Failed to open import catalog (continuing without it): {}", e);
            None
        }
    };

    let options = IngestOptions {
        rules: &rules,
        enable_tagging,
        catalog: catalog.as_ref(),
        session_id: operation_id.clone(),
        source_label,
        backup_path,
    };

    let result = organizer.unified_ingest(
        source,
        &options,
        |current, total, filename, status| {
            let _ = app_handle.emit(
                "organize-progress",
                OrganizeProgress {
                    id: operation_id.clone(),
                    current,
                    total,
                    current_file: filename.to_string(),
                    status: status.to_string(),
                },
            );
        },
        || cancel_token.load(Ordering::Relaxed),
    );

    state.remove_token(&operation_id);

    // Final result emission
    if let Ok(res) = &result {
        let _ = app_handle.emit(
            "organize-progress",
            OrganizeProgress {
                id: operation_id,
                current: res.total_files,
                total: res.total_files,
                current_file: "Complete".to_string(),
                status: "complete".to_string(),
            },
        );
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_is_media_file() {
        let organizer = Organizer::new(PathBuf::from("/tmp"), false, None, None);
        assert!(organizer.is_media_file(Path::new("test.jpg")));
        assert!(organizer.is_media_file(Path::new("test.JPG")));
        assert!(organizer.is_media_file(Path::new("test.png")));
        assert!(organizer.is_media_file(Path::new("test.heic")));
        assert!(organizer.is_media_file(Path::new("test.webp")));
        assert!(organizer.is_media_file(Path::new("test.mp4")));
        assert!(organizer.is_media_file(Path::new("test.MOV")));
        assert!(organizer.is_media_file(Path::new("test.mkv")));
        assert!(!organizer.is_media_file(Path::new("test.txt")));
        assert!(!organizer.is_media_file(Path::new("test.pdf")));
        assert!(!organizer.is_media_file(Path::new(".DS_Store")));
        assert!(!organizer.is_media_file(Path::new("test"))); // No extension
    }

    #[test]
    fn test_calculate_dest_path() {
        let organizer = Organizer::new(PathBuf::from("/archive"), false, None, None);
        let path = Path::new("photo.jpg");

        let dest = organizer.calculate_dest_path(path, "2024-01-15");
        assert_eq!(dest, PathBuf::from("/archive/2024/2024-01-15/photo.jpg"));

        let dest_invalid = organizer.calculate_dest_path(path, "invalid-date");
        assert_eq!(dest_invalid, PathBuf::from("/archive/Unknown-Date/photo.jpg"));

        let dest_empty = organizer.calculate_dest_path(path, "");
        assert_eq!(dest_empty, PathBuf::from("/archive/Unknown-Date/photo.jpg"));

        let dest_partial = organizer.calculate_dest_path(path, "2024-01");
        assert_eq!(dest_partial, PathBuf::from("/archive/Unknown-Date/photo.jpg"));

        let dest_wrong = organizer.calculate_dest_path(path, "2024/01/15");
        assert_eq!(dest_wrong, PathBuf::from("/archive/Unknown-Date/photo.jpg"));
    }

    #[test]
    fn test_resolve_collision() {
        let dir = tempdir().unwrap();
        let organizer = Organizer::new(dir.path().to_path_buf(), false, None, None);
        let path = dir.path().join("test.jpg");

        // No collision
        let resolved = organizer.resolve_collision(&path);
        assert_eq!(resolved, path);

        // First collision
        File::create(&path).unwrap();
        let resolved2 = organizer.resolve_collision(&path);
        assert_eq!(resolved2, dir.path().join("test_1.jpg"));

        // Second collision
        File::create(&resolved2).unwrap();
        let resolved3 = organizer.resolve_collision(&path);
        assert_eq!(resolved3, dir.path().join("test_2.jpg"));

        // Complex name: resolve_collision uses file_stem() which for archive.tar.gz is archive.tar
        let complex_path = dir.path().join("archive.tar.gz");
        File::create(&complex_path).unwrap();
        let resolved_complex = organizer.resolve_collision(&complex_path);
        assert_eq!(resolved_complex, dir.path().join("archive.tar_1.gz"));
    }

    #[test]
    fn test_compute_file_hash() {
        let dir = tempdir().unwrap();
        let organizer = Organizer::new(dir.path().to_path_buf(), false, None, None);
        let path1 = dir.path().join("file1.txt");
        let path2 = dir.path().join("file2.txt");
        let path3 = dir.path().join("file3.txt");

        let mut f1 = File::create(&path1).unwrap();
        f1.write_all(b"hello world").unwrap();

        let mut f2 = File::create(&path2).unwrap();
        f2.write_all(b"hello world").unwrap(); // Same content

        let mut f3 = File::create(&path3).unwrap();
        f3.write_all(b"different content").unwrap();

        let h1 = organizer.compute_file_hash(&path1).unwrap();
        let h2 = organizer.compute_file_hash(&path2).unwrap();
        let h3 = organizer.compute_file_hash(&path3).unwrap();

        assert_eq!(h1, h2);
        assert_ne!(h1, h3);
    }

    #[test]
    fn test_organizer_preview() {
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();
        
        let file1 = source_dir.path().join("20240115_143000.jpg");
        let file2 = source_dir.path().join("IMG_20240116_100000.png");
        let file3 = source_dir.path().join("no_date.txt");
        let file4 = source_dir.path().join("20240115_143000_dup.jpg"); // Same as file1 content

        File::create(&file1).unwrap().write_all(b"content1").unwrap();
        File::create(&file2).unwrap().write_all(b"content2").unwrap();
        File::create(&file3).unwrap().write_all(b"content3").unwrap();
        File::create(&file4).unwrap().write_all(b"content1").unwrap();

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), false, None, None);
        let preview = organizer.preview(source_dir.path(), None).unwrap();

        assert_eq!(preview.total_files, 3); // jpg, png are media, txt is not
        assert_eq!(preview.will_organize, 2);
        assert_eq!(preview.duplicates, 1);
        assert_eq!(preview.will_skip, 0); // No date found would be skip, but our media files have dates
        assert_eq!(preview.already_imported, 0);
    }

    #[test]
    fn test_organizer_preview_flags_already_imported() {
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();
        let catalog_dir = tempdir().unwrap();
        let catalog = Catalog::open_at(&catalog_dir.path().join("catalog.sqlite")).unwrap();

        let known_file = source_dir.path().join("20240115_143000.jpg");
        let new_file = source_dir.path().join("IMG_20240116_100000.png");
        File::create(&known_file).unwrap().write_all(b"already on file").unwrap();
        File::create(&new_file).unwrap().write_all(b"brand new content").unwrap();

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), false, None, None);
        let quick_hash = organizer.compute_file_hash(&known_file).unwrap();
        let size = fs::metadata(&known_file).unwrap().len();

        catalog
            .create_session(&NewSession {
                id: "session-1".to_string(),
                started_at: "2024-01-15T10:00:00Z".to_string(),
                source_path: "/old-card".to_string(),
                source_label: None,
                dest_path: "/old-archive".to_string(),
                backup_path: None,
            })
            .unwrap();
        catalog
            .record_import(&NewImport {
                session_id: "session-1".to_string(),
                quick_hash,
                full_hash: None,
                file_size: size,
                original_name: "20240115_143000.jpg".to_string(),
                source_path: None,
                local_path: "/old-archive/2024/2024-01-15/20240115_143000.jpg".to_string(),
                date_taken: Some("2024-01-15".to_string()),
                camera_model: None,
                imported_at: "2024-01-15T10:00:00Z".to_string(),
                backup_status: "skipped".to_string(),
            })
            .unwrap();

        let preview = organizer.preview(source_dir.path(), Some(&catalog)).unwrap();

        assert_eq!(preview.total_files, 2);
        assert_eq!(preview.already_imported, 1);
        assert_eq!(preview.will_organize, 1);
        let flagged = preview
            .files
            .iter()
            .find(|f| f.source_path.contains("20240115_143000.jpg"))
            .unwrap();
        assert_eq!(flagged.status, "already_imported");
    }

    #[test]
    fn test_organizer_run() {
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();
        
        let file1 = source_dir.path().join("20240115_143000.jpg");
        let file2 = source_dir.path().join("IMG_20240116_100000.png");
        
        File::create(&file1).unwrap().write_all(b"content1").unwrap();
        File::create(&file2).unwrap().write_all(b"content2").unwrap();

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), false, None, None);
        
        let mut progress_count = 0;
        let result = organizer.run(
            source_dir.path(),
            |_, _, _, _| progress_count += 1,
            || false
        ).unwrap();

        assert_eq!(result.total_files, 2);
        assert_eq!(result.organized, 2);
        assert!(progress_count > 0);
        
        // Verify files exist in destination
        assert!(dest_dir.path().join("2024/2024-01-15/20240115_143000.jpg").exists());
        assert!(dest_dir.path().join("2024/2024-01-16/IMG_20240116_100000.png").exists());
    }

    #[test]
    fn test_organizer_run_cancellation() {
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();
        
        let file1 = source_dir.path().join("20240115_143000.jpg");
        File::create(&file1).unwrap().write_all(b"content1").unwrap();

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), false, None, None);
        
        // Immediate cancellation
        let result = organizer.run(
            source_dir.path(),
            |_, _, _, _| {},
            || true
        ).unwrap();

        assert_eq!(result.organized, 0);
    }

    #[test]
    fn test_organizer_run_duplicates() {
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();
        
        let file1 = source_dir.path().join("20240115_143000.jpg");
        let file2 = source_dir.path().join("20240115_143000_dup.jpg");
        
        File::create(&file1).unwrap().write_all(b"same_content").unwrap();
        File::create(&file2).unwrap().write_all(b"same_content").unwrap();

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), false, None, None);
        let result = organizer.run(
            source_dir.path(),
            |_, _, _, _| {},
            || false
        ).unwrap();

        assert_eq!(result.total_files, 2);
        assert_eq!(result.organized, 1);
        assert_eq!(result.duplicates, 1);
    }

    #[test]
    fn test_organizer_run_collisions() {
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();
        
        // Setup existing file in destination to cause collision
        let dest_file = dest_dir.path().join("2024/2024-01-15/20240115_143000.jpg");
        fs::create_dir_all(dest_file.parent().unwrap()).unwrap();
        File::create(&dest_file).unwrap().write_all(b"existing_different_content").unwrap();

        let source_file = source_dir.path().join("20240115_143000.jpg");
        File::create(&source_file).unwrap().write_all(b"new_content").unwrap();

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), false, None, None);
        let result = organizer.run(
            source_dir.path(),
            |_, _, _, _| {},
            || false
        ).unwrap();

        assert_eq!(result.organized, 1);
        assert_eq!(result.duplicates, 0);

        // Verify it was renamed
        assert!(dest_dir.path().join("2024/2024-01-15/20240115_143000_1.jpg").exists());
    }

    /// Two files whose first 64KB and total size are identical (so their
    /// "quick hash" collides) but whose content differs afterwards. This is
    /// the realistic failure mode the quick hash cannot rule out on its own
    /// (e.g. two RAW files from the same camera/session sharing header bytes).
    /// Build two such byte buffers of equal length.
    fn quick_hash_colliding_pair() -> (Vec<u8>, Vec<u8>) {
        let mut prefix = vec![0u8; 65536];
        for (i, b) in prefix.iter_mut().enumerate() {
            *b = (i % 256) as u8;
        }

        let mut a = prefix.clone();
        a.extend_from_slice(b"AAAA-tail-content-a");
        let mut b = prefix;
        b.extend_from_slice(b"BBBB-tail-content-b");

        // Pad the shorter one so both files end up the exact same size too
        // (size is part of the quick hash input).
        while b.len() < a.len() {
            b.push(b'B');
        }
        while a.len() < b.len() {
            a.push(b'A');
        }
        (a, b)
    }

    #[test]
    fn test_organizer_run_quick_hash_collision_within_run_is_not_lost() {
        // Two distinct files in the same run whose quick hashes collide must
        // both be organized: the in-run duplicate check must not treat a
        // quick-hash match alone as sufficient to drop (or, in move mode,
        // delete) a genuinely different file.
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();
        let (content_a, content_b) = quick_hash_colliding_pair();

        let file1 = source_dir.path().join("20240115_143000.jpg");
        let file2 = source_dir.path().join("20240115_143000_other.jpg");
        File::create(&file1).unwrap().write_all(&content_a).unwrap();
        File::create(&file2).unwrap().write_all(&content_b).unwrap();

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), true /* move */, None, None);

        // Sanity check: the quick hashes really do collide.
        assert_eq!(
            organizer.compute_file_hash(&file1).unwrap(),
            organizer.compute_file_hash(&file2).unwrap()
        );

        let result = organizer
            .run(source_dir.path(), |_, _, _, _| {}, || false)
            .unwrap();

        assert_eq!(result.organized, 2, "both distinct files must be organized");
        assert_eq!(result.duplicates, 0);
        assert_eq!(
            fs::read(dest_dir.path().join("2024/2024-01-15/20240115_143000.jpg")).unwrap(),
            content_a
        );
        assert_eq!(
            fs::read(dest_dir.path().join("2024/2024-01-15/20240115_143000_other.jpg")).unwrap(),
            content_b
        );
    }

    #[test]
    fn test_organizer_run_quick_hash_collision_against_existing_dest_is_not_lost() {
        // A pre-existing destination file and a new source file share a quick
        // hash but differ in content: the new file must be organized under a
        // resolved (renamed) path, not silently treated as a duplicate.
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();
        let (existing_content, new_content) = quick_hash_colliding_pair();

        let dest_file = dest_dir.path().join("2024/2024-01-15/20240115_143000.jpg");
        fs::create_dir_all(dest_file.parent().unwrap()).unwrap();
        File::create(&dest_file).unwrap().write_all(&existing_content).unwrap();

        let source_file = source_dir.path().join("20240115_143000.jpg");
        File::create(&source_file).unwrap().write_all(&new_content).unwrap();

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), false, None, None);

        assert_eq!(
            organizer.compute_file_hash(&source_file).unwrap(),
            organizer.compute_file_hash(&dest_file).unwrap()
        );

        let result = organizer
            .run(source_dir.path(), |_, _, _, _| {}, || false)
            .unwrap();

        assert_eq!(result.organized, 1);
        assert_eq!(result.duplicates, 0);

        let renamed = dest_dir.path().join("2024/2024-01-15/20240115_143000_1.jpg");
        assert!(renamed.exists());
        assert_eq!(fs::read(renamed).unwrap(), new_content);
        // The original destination file must be untouched.
        assert_eq!(fs::read(&dest_file).unwrap(), existing_content);
    }

    #[test]
    fn test_compute_full_file_hash_differs_from_quick_hash_on_collision() {
        let dir = tempdir().unwrap();
        let (content_a, content_b) = quick_hash_colliding_pair();

        let path_a = dir.path().join("a.bin");
        let path_b = dir.path().join("b.bin");
        File::create(&path_a).unwrap().write_all(&content_a).unwrap();
        File::create(&path_b).unwrap().write_all(&content_b).unwrap();

        let organizer = Organizer::new(dir.path().to_path_buf(), false, None, None);

        // Quick hashes collide (that's the whole point of the fixture)...
        assert_eq!(
            organizer.compute_file_hash(&path_a).unwrap(),
            organizer.compute_file_hash(&path_b).unwrap()
        );
        // ...but full-file hashes correctly distinguish the two.
        assert_ne!(
            compute_full_file_hash(&path_a).unwrap(),
            compute_full_file_hash(&path_b).unwrap()
        );
    }

    #[test]
    fn test_copy_and_verify_success() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("src.bin");
        let dst = dir.path().join("nested/dst.bin");
        fs::write(&src, b"hello verified world").unwrap();

        fs::create_dir_all(dst.parent().unwrap()).unwrap();
        let hash = copy_and_verify(&src, &dst).unwrap();

        assert_eq!(fs::read(&dst).unwrap(), b"hello verified world");
        assert_eq!(hash, compute_full_file_hash(&src).unwrap());
        assert!(src.exists(), "copy_and_verify must never touch the source");
    }

    #[test]
    fn test_copy_and_verify_missing_source_leaves_no_partial_dest() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("does_not_exist.bin");
        let dst = dir.path().join("dst.bin");

        let result = copy_and_verify(&src, &dst);
        assert!(result.is_err());
        assert!(!dst.exists());
    }

    #[test]
    fn test_organizer_unified_ingest() {
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();
        
        let file1 = source_dir.path().join("20240115_143000.jpg");
        File::create(&file1).unwrap().write_all(b"content1").unwrap();

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), false, None, None);
        let rules = vec![crate::metadata::TagRule {
            name: "TestTag".to_string(),
            camera_models: vec![],
            directory_patterns: vec!["source".to_string()],
        }];

        let options = IngestOptions {
            rules: &rules,
            enable_tagging: false, // disable tagging for simple test
            catalog: None,
            session_id: "test-session".to_string(),
            source_label: None,
            backup_path: None,
        };

        let result = organizer.unified_ingest(
            source_dir.path(),
            &options,
            |_, _, _, _| {},
            || false
        ).unwrap();

        assert_eq!(result.total_files, 1);
        assert_eq!(result.organized, 1);
        assert!(dest_dir.path().join("2024/2024-01-15/20240115_143000.jpg").exists());
    }

    fn no_op_ingest_options<'a>(session_id: &str, catalog: Option<&'a Catalog>) -> IngestOptions<'a> {
        IngestOptions {
            rules: &[],
            enable_tagging: false,
            catalog,
            session_id: session_id.to_string(),
            source_label: None,
            backup_path: None,
        }
    }

    #[test]
    fn test_unified_ingest_catalog_survives_cleared_destination() {
        // The scenario this whole feature exists for: import a card into a
        // working folder, clear the folder out (e.g. after Lightroom import),
        // then import the *same* card again. Without a catalog this would
        // silently re-import everything; with one, the second run must
        // recognize every file as already-seen even though none of them
        // exist at their old destination anymore.
        let source_dir = tempdir().unwrap();
        let dest_a = tempdir().unwrap();
        let dest_b = tempdir().unwrap();
        let catalog_dir = tempdir().unwrap();
        let catalog = Catalog::open_at(&catalog_dir.path().join("catalog.sqlite")).unwrap();

        let file1 = source_dir.path().join("20240115_143000.jpg");
        File::create(&file1).unwrap().write_all(b"card_photo_content").unwrap();

        let organizer_a = Organizer::new(dest_a.path().to_path_buf(), false, None, None);
        let options_a = no_op_ingest_options("session-a", Some(&catalog));
        let result_a = organizer_a
            .unified_ingest(source_dir.path(), &options_a, |_, _, _, _| {}, || false)
            .unwrap();
        assert_eq!(result_a.organized, 1);
        assert_eq!(result_a.duplicates, 0);

        // Simulate clearing the working folder (e.g. after Lightroom import).
        fs::remove_dir_all(dest_a.path()).unwrap();
        fs::create_dir_all(dest_a.path()).unwrap();

        // Re-import the same card into a fresh destination.
        let organizer_b = Organizer::new(dest_b.path().to_path_buf(), false, None, None);
        let options_b = no_op_ingest_options("session-b", Some(&catalog));
        let result_b = organizer_b
            .unified_ingest(source_dir.path(), &options_b, |_, _, _, _| {}, || false)
            .unwrap();

        assert_eq!(result_b.organized, 0, "already-imported file must not be re-copied");
        assert_eq!(result_b.duplicates, 1);
        assert!(!dest_b.path().join("2024/2024-01-15/20240115_143000.jpg").exists());
    }

    #[test]
    fn test_unified_ingest_records_session_and_import() {
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();
        let catalog_dir = tempdir().unwrap();
        let catalog = Catalog::open_at(&catalog_dir.path().join("catalog.sqlite")).unwrap();

        let file1 = source_dir.path().join("20240115_143000.jpg");
        File::create(&file1).unwrap().write_all(b"content1").unwrap();

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), false, None, None);
        let options = IngestOptions {
            rules: &[],
            enable_tagging: false,
            catalog: Some(&catalog),
            session_id: "session-record".to_string(),
            source_label: Some("NIKON Z6".to_string()),
            backup_path: Some("/drive/archive".to_string()),
        };

        let result = organizer
            .unified_ingest(source_dir.path(), &options, |_, _, _, _| {}, || false)
            .unwrap();
        assert_eq!(result.organized, 1);

        let sessions = catalog.recent_sessions(10).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "session-record");
        assert_eq!(sessions[0].status, "complete");
        assert_eq!(sessions[0].imported, 1);
        assert_eq!(sessions[0].source_label, Some("NIKON Z6".to_string()));

        let quick_hash = organizer.compute_file_hash(&file1).unwrap();
        let size = fs::metadata(&file1).unwrap().len();
        let found = catalog.find_by_quick_hash(&quick_hash, size).unwrap().unwrap();
        assert_eq!(found.backup_status, "pending"); // backup_path was set
        assert!(found.full_hash.is_some());
        assert_eq!(found.date_taken, Some("2024-01-15".to_string()));
    }

    #[test]
    fn test_unified_ingest_catalog_duplicate_without_full_hash_is_not_deleted_in_move_mode() {
        // A catalog hit whose stored full_hash doesn't confirm identity (e.g.
        // a backfilled row that never had one computed) must still count as
        // a duplicate (skip the copy) but must NOT delete the source in move
        // mode, since we can't actually confirm the content matches.
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();
        let catalog_dir = tempdir().unwrap();
        let catalog = Catalog::open_at(&catalog_dir.path().join("catalog.sqlite")).unwrap();

        let file1 = source_dir.path().join("20240115_143000.jpg");
        File::create(&file1).unwrap().write_all(b"card_photo_content").unwrap();

        let quick_hash = Organizer::new(dest_dir.path().to_path_buf(), false, None, None)
            .compute_file_hash(&file1)
            .unwrap();
        let size = fs::metadata(&file1).unwrap().len();

        catalog
            .create_session(&NewSession {
                id: "backfill".to_string(),
                started_at: "2024-01-01T00:00:00Z".to_string(),
                source_path: "/archive".to_string(),
                source_label: None,
                dest_path: "/archive".to_string(),
                backup_path: None,
            })
            .unwrap();
        catalog
            .record_import(&NewImport {
                session_id: "backfill".to_string(),
                quick_hash,
                full_hash: None, // never computed, e.g. a backfilled row
                file_size: size,
                original_name: "20240115_143000.jpg".to_string(),
                source_path: None,
                local_path: "/archive/2024/2024-01-15/20240115_143000.jpg".to_string(),
                date_taken: Some("2024-01-15".to_string()),
                camera_model: None,
                imported_at: "2024-01-01T00:00:00Z".to_string(),
                backup_status: "skipped".to_string(),
            })
            .unwrap();

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), true /* move */, None, None);
        let options = no_op_ingest_options("session-move", Some(&catalog));
        let result = organizer
            .unified_ingest(source_dir.path(), &options, |_, _, _, _| {}, || false)
            .unwrap();

        assert_eq!(result.organized, 0);
        assert_eq!(result.duplicates, 1);
        assert!(file1.exists(), "source must survive when identity can't be confirmed");
    }

    #[test]
    fn test_unified_ingest_catalog_open_failure_does_not_block_ingest() {
        // If the catalog can't be created (bad path here stands in for a
        // permissions/disk error), ingest must still succeed - just without
        // cross-session dedup for this run.
        let source_dir = tempdir().unwrap();
        let dest_dir = tempdir().unwrap();

        let file1 = source_dir.path().join("20240115_143000.jpg");
        File::create(&file1).unwrap().write_all(b"content1").unwrap();

        let bad_catalog = Catalog::open_at(Path::new("/nonexistent/dir/catalog.sqlite"));
        assert!(bad_catalog.is_err());

        let organizer = Organizer::new(dest_dir.path().to_path_buf(), false, None, None);
        let options = no_op_ingest_options("session-no-catalog", None);
        let result = organizer
            .unified_ingest(source_dir.path(), &options, |_, _, _, _| {}, || false)
            .unwrap();

        assert_eq!(result.organized, 1);
    }

    #[test]
    fn test_get_file_date_filename_fallback() {
        let organizer = Organizer::new(PathBuf::from("/archive"), false, None, None);
        
        // 2024-01-15 14.30.00.jpg -> should be extracted from filename
        let date = organizer.get_file_date("2024-01-15 14.30.00.jpg");
        assert_eq!(date, Some("2024-01-15".to_string()));

        let date2 = organizer.get_file_date("IMG_20240220_100000.jpg");
        assert_eq!(date2, Some("2024-02-20".to_string()));

        let date3 = organizer.get_file_date("random.jpg");
        assert_eq!(date3, None);
    }

    #[test]
    fn test_get_file_date_from_exif() {
        // This test requires exiftool to be installed on the system
        let exiftool_path = PathBuf::from("/opt/homebrew/bin/exiftool");
        if !exiftool_path.exists() {
            return; // Skip if not found
        }

        let organizer = Organizer::new(PathBuf::from("/archive"), false, Some(exiftool_path), None);
        
        // Use our freshly created test file
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let test_file = Path::new(&manifest_dir).parent().unwrap().join("test_src").join("dated.jpg");
        
        if test_file.exists() {
            let date = organizer.get_file_date(test_file.to_str().unwrap());
            assert_eq!(date, Some("2024-06-15".to_string()));
        }
    }
}
