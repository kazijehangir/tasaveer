//! Organization module for sorting media files into date-based directory structure.
//!
//! This replaces the external phockup dependency with native Rust logic.
//! Files are organized into YYYY/YYYY-MM-DD format based on EXIF DateTimeOriginal.

use crate::metadata::{extract_date_from_filename, read_exif_metadata};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Emitter;
use walkdir::WalkDir;

/// Media extensions we support
const MEDIA_EXTENSIONS: &[&str] = &[
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
struct OrganizeProgress {
    id: String,
    current: usize,
    total: usize,
    current_file: String,
    status: String,
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
}

/// Compute SHA-256 hash of a file (first 64KB for performance)
fn compute_file_hash(path: &Path) -> Result<String, std::io::Error> {
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
fn get_file_date(file_path: &str) -> Option<String> {
    // First try EXIF
    if let Ok(metadata) = read_exif_metadata(file_path.to_string()) {
        if let Some(date_str) = metadata.date_time_original {
            // Parse EXIF date format: "2024:01:15 14:30:00"
            if date_str.len() >= 10 {
                let parts: Vec<&str> = date_str.split(&[' ', ':'][..]).collect();
                if parts.len() >= 3 {
                    return Some(format!("{}-{}-{}", parts[0], parts[1], parts[2]));
                }
            }
        }
    }

    // Fall back to filename extraction
    let filename = Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    extract_date_from_filename(filename).map(|ext| ext.date)
}

/// Calculate destination path for a file
fn calculate_dest_path(file_path: &Path, dest_root: &Path, date: &str) -> PathBuf {
    // Date format: YYYY-MM-DD
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        // Invalid date, put in "unknown" folder
        return dest_root.join("unknown").join(
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
    dest_root.join(year).join(folder_date).join(
        file_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
    )
}

/// Handle filename collision by appending counter
fn resolve_collision(dest_path: &Path) -> PathBuf {
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
    let new_name = format!(
        "{}_{}.{}",
        stem,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        ext
    );
    parent.join(new_name)
}

/// Check if a file is a media file
fn is_media_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| MEDIA_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Preview organization (dry run)
#[tauri::command]
pub async fn preview_organize(
    source_path: String,
    dest_path: String,
) -> Result<OrganizePreview, String> {
    let source = Path::new(&source_path);
    let dest = Path::new(&dest_path);

    if !source.exists() {
        return Err(format!("Source path does not exist: {}", source_path));
    }

    let mut files = Vec::new();
    let mut will_organize = 0;
    let mut will_skip = 0;
    let mut duplicates = 0;

    // Track hashes for duplicate detection within preview
    let mut seen_hashes: HashMap<String, String> = HashMap::new();

    for entry in WalkDir::new(source)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        if path.is_dir() || !is_media_file(path) {
            continue;
        }

        let file_path_str = path.to_string_lossy().to_string();

        // Get date
        let date = get_file_date(&file_path_str);

        if date.is_none() {
            files.push(FileOrganizeResult {
                source_path: file_path_str,
                dest_path: None,
                status: "skipped".to_string(),
                message: Some("No date found in EXIF or filename".to_string()),
            });
            will_skip += 1;
            continue;
        }

        let date_str = date.unwrap();
        let dest_file = calculate_dest_path(path, dest, &date_str);

        // Check for duplicates
        if let Ok(hash) = compute_file_hash(path) {
            if let Some(existing) = seen_hashes.get(&hash) {
                files.push(FileOrganizeResult {
                    source_path: file_path_str,
                    dest_path: None,
                    status: "duplicate".to_string(),
                    message: Some(format!("Duplicate of {}", existing)),
                });
                duplicates += 1;
                continue;
            }
            seen_hashes.insert(hash, file_path_str.clone());
        }

        files.push(FileOrganizeResult {
            source_path: file_path_str,
            dest_path: Some(dest_file.to_string_lossy().to_string()),
            status: "will_organize".to_string(),
            message: None,
        });
        will_organize += 1;
    }

    Ok(OrganizePreview {
        total_files: files.len(),
        files,
        will_organize,
        will_skip,
        duplicates,
    })
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
    let dest = Path::new(&dest_path);
    let cancel_token = state.register_token(&operation_id);

    if !source.exists() {
        return Err(format!("Source path does not exist: {}", source_path));
    }

    // Count total files first
    let total_files: usize = WalkDir::new(source)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file() && is_media_file(e.path()))
        .count();

    let mut organized = 0;
    let mut skipped = 0;
    let mut duplicates = 0;
    let mut errors = 0;
    let mut current = 0;

    // Track hashes for duplicate detection
    let mut seen_hashes: HashMap<String, String> = HashMap::new();

    for entry in WalkDir::new(source)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        // Check cancellation
        if cancel_token.load(Ordering::Relaxed) {
            state.remove_token(&operation_id);
            return Ok(OrganizeResult {
                total_files,
                organized,
                skipped,
                duplicates,
                errors,
            });
        }

        let path = entry.path();

        if path.is_dir() || !is_media_file(path) {
            continue;
        }

        current += 1;
        let file_path_str = path.to_string_lossy().to_string();
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");

        // Emit progress
        if current % 5 == 0 || current == 1 {
            let _ = app_handle.emit(
                "organize-progress",
                OrganizeProgress {
                    id: operation_id.clone(),
                    current,
                    total: total_files,
                    current_file: filename.to_string(),
                    status: "processing".to_string(),
                },
            );
        }

        // Get date
        let date = match get_file_date(&file_path_str) {
            Some(d) => d,
            None => {
                skipped += 1;
                continue;
            }
        };

        // Check for duplicates via hash
        let hash = match compute_file_hash(path) {
            Ok(h) => h,
            Err(_) => {
                errors += 1;
                continue;
            }
        };

        if let Some(existing) = seen_hashes.get(&hash) {
            // Check if the existing file is in dest (already processed)
            if existing.starts_with(&dest_path) {
                duplicates += 1;
                // If moving, delete the duplicate source
                if move_files {
                    let _ = fs::remove_file(path);
                }
                continue;
            }
        }

        // Calculate destination
        let mut dest_file = calculate_dest_path(path, dest, &date);

        // Handle collision
        if dest_file.exists() {
            // Check if it's the same file (by hash)
            if let Ok(existing_hash) = compute_file_hash(&dest_file) {
                if existing_hash == hash {
                    duplicates += 1;
                    if move_files {
                        let _ = fs::remove_file(path);
                    }
                    continue;
                }
            }
            // Different file, resolve collision
            dest_file = resolve_collision(&dest_file);
        }

        // Create parent directories
        if let Some(parent) = dest_file.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                eprintln!("Failed to create directory {:?}: {}", parent, e);
                errors += 1;
                continue;
            }
        }

        // Move or copy
        let result = if move_files {
            // Try rename first (fastest for same filesystem)
            fs::rename(path, &dest_file).or_else(|_| {
                // Cross-filesystem: copy then delete
                fs::copy(path, &dest_file).and_then(|_| fs::remove_file(path))
            })
        } else {
            fs::copy(path, &dest_file).map(|_| ())
        };

        match result {
            Ok(_) => {
                organized += 1;
                seen_hashes.insert(hash, dest_file.to_string_lossy().to_string());
            }
            Err(e) => {
                eprintln!(
                    "Failed to {} {:?}: {}",
                    if move_files { "move" } else { "copy" },
                    path,
                    e
                );
                errors += 1;
            }
        }
    }

    state.remove_token(&operation_id);

    // Final progress
    let _ = app_handle.emit(
        "organize-progress",
        OrganizeProgress {
            id: operation_id,
            current: total_files,
            total: total_files,
            current_file: "".to_string(),
            status: "complete".to_string(),
        },
    );

    Ok(OrganizeResult {
        total_files,
        organized,
        skipped,
        duplicates,
        errors,
    })
}
