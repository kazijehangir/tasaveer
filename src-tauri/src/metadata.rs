//! Metadata module for EXIF operations using ExifTool.
//!
//! This module provides functions to:
//! - Scan files for missing DateTimeOriginal
//! - Extract dates from filename patterns (WhatsApp, screenshots, etc.)
//! - Read and write EXIF metadata safely (never overwriting valid data)

use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

lazy_static! {
    static ref WHATSAPP_ANDROID_RE: Regex = Regex::new(r"^IMG-(\d{4})(\d{2})(\d{2})-WA").unwrap();
    static ref WHATSAPP_IOS_RE: Regex =
        Regex::new(r"^WhatsApp.*(\d{4})-(\d{2})-(\d{2})(?:\s+at\s+(\d{2})\.(\d{2})\.(\d{2}))?")
            .unwrap();
    static ref SCREENSHOT_MAC_RE: Regex =
        Regex::new(r"^Screenshot\s+(\d{4})-(\d{2})-(\d{2})\s+at\s+(\d{2})\.(\d{2})\.(\d{2})")
            .unwrap();
    static ref ANDROID_CAMERA_RE: Regex =
        Regex::new(r"^(?:IMG_)?(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})").unwrap();
    static ref GOOGLE_PHOTOS_RE: Regex =
        Regex::new(r"^PXL_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})").unwrap();
    static ref SAMSUNG_RE: Regex =
        Regex::new(r"^(\d{4})-(\d{2})-(\d{2})\s+(\d{2})\.(\d{2})\.(\d{2})").unwrap();
    static ref WINDOWS_SCREENSHOT_RE: Regex =
        Regex::new(r"^Screenshot\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{6})").unwrap();
    static ref GENERIC_DATE_RE: Regex = Regex::new(r"(\d{4})[-_]?(\d{2})[-_]?(\d{2})").unwrap();
}

/// Represents extracted EXIF metadata from a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExifMetadata {
    pub file_path: String,
    pub date_time_original: Option<String>,
    pub create_date: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub software: Option<String>,
    pub keywords: Vec<String>,
}

impl ExifMetadata {
    /// Get combined camera model string (Make + Model)
    pub fn get_camera_model(&self) -> Option<String> {
        match (&self.make, &self.model) {
            (Some(make), Some(model)) => {
                let m = make.trim();
                let mo = model.trim();
                if mo.to_lowercase().starts_with(&m.to_lowercase()) {
                    Some(mo.to_string())
                } else {
                    Some(format!("{} {}", m, mo))
                }
            }
            (None, Some(model)) => Some(model.trim().to_string()),
            (Some(make), None) => Some(make.trim().to_string()),
            (None, None) => None,
        }
    }
}

/// Result of date extraction from filename
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedDate {
    pub date: String,         // Format: YYYY-MM-DD
    pub time: Option<String>, // Format: HH:MM:SS if available
    pub source: String,       // e.g., "WhatsApp", "Screenshot", "Android Camera"
}

/// File info with metadata status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadataInfo {
    pub file_path: String,
    pub has_date: bool,
    pub extracted_date: Option<ExtractedDate>,
    pub camera_model: Option<String>,
}

/// Extract date from common filename patterns
///
/// Supported patterns:
/// - WhatsApp Android: IMG-20240115-WA0042.jpg
/// - WhatsApp iOS: WhatsApp Image 2024-01-15 at 10.30.45.jpeg
/// - Screenshot Mac: Screenshot 2024-01-15 at 14.30.00.png
/// - Android Camera: 20240115_143000.jpg
/// - iOS Camera: IMG_20240115_143000.jpg
pub fn extract_date_from_filename(filename: &str) -> Option<ExtractedDate> {
    // WhatsApp Android: IMG-20240115-WA0042.jpg
    if let Some(caps) = WHATSAPP_ANDROID_RE.captures(filename) {
        return Some(ExtractedDate {
            date: format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]),
            time: None,
            source: "WhatsApp".to_string(),
        });
    }

    // WhatsApp iOS: WhatsApp Image 2024-01-15 at 10.30.45
    if let Some(caps) = WHATSAPP_IOS_RE.captures(filename) {
        let time = if caps.get(4).is_some() {
            Some(format!("{}:{}:{}", &caps[4], &caps[5], &caps[6]))
        } else {
            None
        };
        return Some(ExtractedDate {
            date: format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]),
            time,
            source: "WhatsApp".to_string(),
        });
    }

    // Screenshot Mac: Screenshot 2024-01-15 at 14.30.00
    if let Some(caps) = SCREENSHOT_MAC_RE.captures(filename) {
        return Some(ExtractedDate {
            date: format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]),
            time: Some(format!("{}:{}:{}", &caps[4], &caps[5], &caps[6])),
            source: "Screenshot".to_string(),
        });
    }

    // Google Photos: PXL_20240115_143000123.jpg
    if let Some(caps) = GOOGLE_PHOTOS_RE.captures(filename) {
        return Some(ExtractedDate {
            date: format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]),
            time: Some(format!("{}:{}:{}", &caps[4], &caps[5], &caps[6])),
            source: "Google Photos".to_string(),
        });
    }

    // Android Camera: 20240115_143000.jpg or IMG_20240115_143000.jpg
    if let Some(caps) = ANDROID_CAMERA_RE.captures(filename) {
        let year: u32 = caps[1].parse().unwrap_or(0);
        let month: u32 = caps[2].parse().unwrap_or(0);
        let day: u32 = caps[3].parse().unwrap_or(0);

        // Validate it looks like a real date
        if (1990..=2100).contains(&year) && (1..=12).contains(&month) && (1..=31).contains(&day) {
            return Some(ExtractedDate {
                date: format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]),
                time: Some(format!("{}:{}:{}", &caps[4], &caps[5], &caps[6])),
                source: "Camera".to_string(),
            });
        }
    }

    // Samsung: 2024-01-15 14.30.00.jpg
    if let Some(caps) = SAMSUNG_RE.captures(filename) {
        return Some(ExtractedDate {
            date: format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]),
            time: Some(format!("{}:{}:{}", &caps[4], &caps[5], &caps[6])),
            source: "Samsung".to_string(),
        });
    }

    // Windows Screenshot: Screenshot 2024-01-15 143000.png
    if let Some(caps) = WINDOWS_SCREENSHOT_RE.captures(filename) {
        let time_raw = &caps[4];
        let time = Some(format!("{}:{}:{}", &time_raw[0..2], &time_raw[2..4], &time_raw[4..6]));
        return Some(ExtractedDate {
            date: format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]),
            time,
            source: "Screenshot".to_string(),
        });
    }

    // Generic date pattern: YYYY-MM-DD or YYYYMMDD anywhere in filename
    if let Some(caps) = GENERIC_DATE_RE.captures(filename) {
        let year: u32 = caps[1].parse().unwrap_or(0);
        let month: u32 = caps[2].parse().unwrap_or(0);
        let day: u32 = caps[3].parse().unwrap_or(0);

        // Validate it looks like a real date
        if (1990..=2100).contains(&year) && (1..=12).contains(&month) && (1..=31).contains(&day) {
            return Some(ExtractedDate {
                date: format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]),
                time: None,
                source: "Filename".to_string(),
            });
        }
    }

    None
}

/// Helper to format EXIF date (YYYY:MM:DD HH:MM:SS) into YYYY-MM-DD
pub fn format_exif_date(date_str: &str) -> Option<String> {
    if date_str.len() >= 10 {
        let parts: Vec<&str> = date_str.split(&[' ', ':'][..]).collect();
        if parts.len() >= 3 {
            return Some(format!("{}-{}-{}", parts[0], parts[1], parts[2]));
        }
    }
    None
}

/// Read EXIF metadata from a file using exiftool
#[tauri::command]
pub fn read_exif_metadata(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    file_path: String,
) -> Result<ExifMetadata, String> {
    let exiftool_path = crate::binaries::Prerequisite::ExifTool
        .discover(&app)
        .map_err(|e| format!("Failed to find exiftool: {}", e))?;

    // Try to ensure daemon is running (non-blocking if already running)
    let path_str = exiftool_path.to_str();
    let _ = state.exiftool_daemon.ensure_started(path_str);

    // Attempt read via daemon
    if let Ok(json) = state.exiftool_daemon.read_metadata_json(&file_path) {
         if let Ok(parsed) = serde_json::from_str::<Vec<serde_json::Value>>(&json) {
            if !parsed.is_empty() {
                return Ok(parse_exif_metadata(&parsed[0], &file_path));
            }
         }
    }

    read_exif_metadata_internal(&exiftool_path, &file_path)
}

/// Internal function to read EXIF with explicit binary path
pub fn read_exif_metadata_internal(
    exiftool_path: &Path,
    file_path: &str,
) -> Result<ExifMetadata, String> {
    // Validate path before executing command
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err(format!(
            "Path does not exist or is not a file: {}",
            file_path
        ));
    }

    let output = Command::new(exiftool_path)
        .args([
            "-json",
            "-DateTimeOriginal",
            "-CreateDate",
            "-Make",
            "-Model",
            "-Software",
            "-Keywords",
            "-XPKeywords",
            "-Subject",
            file_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run exiftool: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("exiftool failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse exiftool output: {}", e))?;

    if parsed.is_empty() {
        return Err("No EXIF data found".to_string());
    }

    Ok(parse_exif_metadata(&parsed[0], file_path))
}

/// Pure function to parse ExifTool JSON output into ExifMetadata struct.
fn parse_exif_metadata(data: &serde_json::Value, file_path: &str) -> ExifMetadata {
    // Parse keywords from both Keywords and XPKeywords
    let mut keywords = Vec::new();
    if let Some(kw) = data.get("Keywords") {
        if let Some(arr) = kw.as_array() {
            for k in arr {
                if let Some(s) = k.as_str() {
                    keywords.push(s.to_string());
                }
            }
        } else if let Some(s) = kw.as_str() {
            keywords.push(s.to_string());
        }
    }
    if let Some(xp_kw) = data.get("XPKeywords") {
        if let Some(s) = xp_kw.as_str() {
            for k in s.split(';') {
                let trimmed = k.trim().to_string();
                if !trimmed.is_empty() && !keywords.contains(&trimmed) {
                    keywords.push(trimmed);
                }
            }
        }
    }
    if let Some(subj) = data.get("Subject") {
        if let Some(arr) = subj.as_array() {
            for k in arr {
                if let Some(s) = k.as_str() {
                    let trimmed = s.trim().to_string();
                    if !trimmed.is_empty() && !keywords.contains(&trimmed) {
                        keywords.push(trimmed);
                    }
                }
            }
        } else if let Some(s) = subj.as_str() {
            let trimmed = s.trim().to_string();
            if !trimmed.is_empty() && !keywords.contains(&trimmed) {
                keywords.push(trimmed);
            }
        }
    }

    ExifMetadata {
        file_path: file_path.to_string(),
        date_time_original: data
            .get("DateTimeOriginal")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        create_date: data
            .get("CreateDate")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        make: data
            .get("Make")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        model: data
            .get("Model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        software: data
            .get("Software")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        keywords,
    }
}

/// Get camera model string from EXIF (Make + Model)
#[tauri::command]
pub fn get_camera_model(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<Option<String>, String> {
    match read_exif_metadata(app, file_path) {
        Ok(metadata) => Ok(metadata.get_camera_model()),
        Err(_) => Ok(None), // No EXIF data is not an error for this function
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct TagRule {
    pub name: String,
    pub camera_models: Vec<String>,
    pub directory_patterns: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
struct TagProgress {
    id: String,
    current: usize,
    total: usize,
    message: String,
}

/// Apply tags to files in a directory based on camera models and directory patterns.
/// Groups files by tag to minimize ExifTool process spawns.
#[tauri::command]
pub async fn apply_tags_to_directory(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    path: String,
    rules: Vec<TagRule>,
    operation_id: String,
) -> Result<usize, String> {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;

    let cancel_token = state.register_token(&operation_id);
    let exiftool_path = crate::binaries::Prerequisite::ExifTool
        .discover(&app_handle)
        .map_err(|e| format!("Failed to find exiftool: {}", e))?;

    let daemon_available = state.exiftool_daemon.ensure_started(exiftool_path.to_str()).is_ok();

    let results = apply_tags_internal(
        Path::new(&path),
        &rules,
        if daemon_available { Some(&state.exiftool_daemon) } else { None },
        &exiftool_path,
        |current, total, message| {
            let _ = app_handle.emit(
                "tag-progress",
                TagProgress {
                    id: operation_id.clone(),
                    current,
                    total,
                    message: message.to_string(),
                },
            );
        },
        || cancel_token.load(Ordering::Relaxed),
    );

    state.remove_token(&operation_id);
    results
}

pub fn apply_tags_internal<F, C>(
    path: &Path,
    rules: &[TagRule],
    daemon: Option<&crate::exiftool_daemon::SharedExifToolDaemon>,
    exiftool_path: &Path,
    mut on_progress: F,
    is_cancelled: C,
) -> Result<usize, String>
where
    F: FnMut(usize, usize, &str), // current_tag, total_tags, message
    C: Fn() -> bool,
{
    use std::collections::HashMap;
    use walkdir::WalkDir;

    // 1. Scan and match files to tags
    let mut tag_groups: HashMap<String, Vec<String>> = HashMap::new();
    let mut total_found = 0;

    let walker = WalkDir::new(path).follow_links(true);

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        if is_cancelled() {
            return Err("Operation cancelled".to_string());
        }

        let file_path = entry.path();
        if file_path.is_dir() {
            continue;
        }

        if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
            if !crate::organize::MEDIA_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                continue;
            }
        } else {
            continue;
        }

        let file_path_str = file_path.to_string_lossy().to_string();

        // Get camera model
        let (_has_date, camera_model) = if let Some(d) = daemon {
            read_exif_with_daemon(d, &file_path_str)
        } else {
            read_exif_with_command_path(exiftool_path, &file_path_str)
        };

        // Get relative directory
        let rel_dir = file_path
            .parent()
            .and_then(|p| p.strip_prefix(path).ok())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        // Match against rules
        for rule in rules {
            let mut matched = false;

            // Match camera
            if let Some(model) = &camera_model {
                if rule.camera_models.iter().any(|m| model.contains(m)) {
                    matched = true;
                }
            }

            // Match directory pattern
            if !matched && !rel_dir.is_empty() {
                if rule.directory_patterns.iter().any(|p| rel_dir.contains(p)) {
                    matched = true;
                }
            }

            if matched {
                tag_groups
                    .entry(rule.name.clone())
                    .or_default()
                    .push(file_path_str.clone());
                total_found += 1;
                break;
            }
        }
    }

    if total_found == 0 {
        return Ok(0);
    }

    // 2. Apply tags in batches
    let mut tagged_count = 0;
    let total_tags = tag_groups.len();

    for (i, (tag_name, files)) in tag_groups.into_iter().enumerate() {
        if is_cancelled() {
            return Err("Operation cancelled".to_string());
        }

        on_progress(i + 1, total_tags, &format!("Applying tag '{}' to {} files", tag_name, files.len()));

        for chunk in files.chunks(50) {
            let mut cmd = std::process::Command::new(exiftool_path);
            cmd.args([
                "-overwrite_original",
                "-P",
                "-sep",
                ", ",
                &format!("-Keywords+={}", tag_name),
                &format!("-Subject+={}", tag_name),
            ]);
            cmd.args(chunk);

            let output = cmd.output().map_err(|e| format!("Failed to run exiftool: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                eprintln!("[ERROR] ExifTool failed for tag {}: {}", tag_name, stderr);
            } else {
                tagged_count += chunk.len();
            }
        }
    }

    Ok(tagged_count)
}

/// Helper to read EXIF with explicit command path
fn read_exif_with_command_path(exiftool_path: &Path, file_path: &str) -> (bool, Option<String>) {
    match read_exif_metadata_internal(exiftool_path, file_path) {
        Ok(metadata) => (
            metadata.date_time_original.is_some(),
            metadata.get_camera_model()
        ),
        Err(_) => (false, None),
    }
}

/// Write EXIF date to file ONLY if DateTimeOriginal is missing
#[tauri::command]
pub fn write_exif_date_if_missing(
    app: tauri::AppHandle,
    file_path: String,
    date: String,
    time: Option<String>,
) -> Result<String, String> {
    let exiftool_path = crate::binaries::Prerequisite::ExifTool
        .discover(&app)
        .map_err(|e| format!("Failed to find exiftool: {}", e))?;

    // First check if date already exists (re-use the path)
    if let Ok(metadata) = read_exif_metadata_internal(&exiftool_path, &file_path) {
        if metadata.date_time_original.is_some() {
            return Ok("Date already exists, skipping".to_string());
        }
    }

    write_exif_date_if_missing_internal(&exiftool_path, &file_path, &date, time)
}

pub fn write_exif_date_if_missing_internal(
    exiftool_path: &Path,
    file_path: &str,
    date: &str,
    time: Option<String>,
) -> Result<String, String> {
    // Validate path before executing command
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err(format!(
            "Path does not exist or is not a file: {}",
            file_path
        ));
    }

    // Format the datetime for EXIF
    let datetime = match time {
        Some(t) => format!("{} {}", date.replace('-', ":"), t),
        None => format!("{} 12:00:00", date.replace('-', ":")),
    };

    let output = Command::new(exiftool_path)
        .args([
            "-overwrite_original",
            &format!("-DateTimeOriginal={}", datetime),
            &format!("-CreateDate={}", datetime),
            file_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run exiftool: {}", e))?;

    if output.status.success() {
        Ok(format!("Date written: {}", datetime))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("exiftool failed: {}", stderr))
    }
}

/// Write keywords/tags to EXIF, avoiding duplicates
#[tauri::command]
pub fn write_exif_keywords(
    app: tauri::AppHandle,
    file_path: String,
    keywords: Vec<String>,
) -> Result<String, String> {
    let exiftool_path = crate::binaries::Prerequisite::ExifTool
        .discover(&app)
        .map_err(|e| format!("Failed to find exiftool: {}", e))?;

    write_exif_keywords_internal(&exiftool_path, &file_path, keywords)
}

pub fn write_exif_keywords_internal(
    exiftool_path: &Path,
    file_path: &str,
    keywords: Vec<String>,
) -> Result<String, String> {
    if keywords.is_empty() {
        return Ok("No keywords to write".to_string());
    }

    // Validate path before executing command
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err(format!(
            "Path does not exist or is not a file: {}",
            file_path
        ));
    }

    // First, read existing keywords using our robust reader
    let existing_keywords = match read_exif_metadata_internal(exiftool_path, file_path) {
        Ok(metadata) => metadata
            .keywords
            .into_iter()
            .collect::<std::collections::HashSet<_>>(),
        Err(_) => std::collections::HashSet::new(),
    };

    // Merge with new keywords, avoiding duplicates
    let mut all_keywords: std::collections::HashSet<String> = existing_keywords;
    for kw in &keywords {
        all_keywords.insert(kw.clone());
    }

    // Convert back to sorted vec for consistent output
    let mut merged: Vec<String> = all_keywords.into_iter().collect();
    merged.sort();

    let keywords_str = merged.join(", ");

    let output = Command::new(exiftool_path)
        .args([
            "-overwrite_original",
            "-P", // Preserve file modification date
            "-sep",
            ", ", // Ensure lists are written correctly
            &format!("-Keywords={}", keywords_str),
            &format!("-Subject={}", keywords_str), // Sync XMP
            "-XPKeywords=", // Remove Windows-specific tag to avoid duplication
            file_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run exiftool: {}", e))?;

    if output.status.success() {
        Ok(format!("Keywords written: {}", keywords_str))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("exiftool failed: {}", stderr))
    }
}

/// Scan a directory recursively for media files
#[derive(Clone, serde::Serialize)]
struct ScanProgress {
    id: String,
    count: usize,
}

/// Scan a directory recursively for media files with progress and cancellation
/// Uses ExifTool daemon for optimized batch processing.
#[tauri::command]
pub async fn scan_missing_dates(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    path: String,
    operation_id: String,
) -> Result<Vec<FileMetadataInfo>, String> {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;

    let cancel_token = state.register_token(&operation_id);

    let exiftool_path = crate::binaries::Prerequisite::ExifTool
        .discover(&app_handle)
        .map_err(|e| format!("Failed to find exiftool: {}", e))?;

    // Try to start the ExifTool daemon for batch processing
    let daemon_res = state.exiftool_daemon.ensure_started(exiftool_path.to_str());
    let daemon_available = daemon_res.is_ok();
    
    if daemon_available {
        eprintln!("[INFO] Using ExifTool daemon for optimized scanning");
    } else {
        eprintln!("[WARN] ExifTool daemon unavailable, falling back to per-file processing");
    }

    let results = scan_directory_internal(
        Path::new(&path),
        if daemon_available { Some(&state.exiftool_daemon) } else { None },
        &exiftool_path,
        |count| {
            let _ = app_handle.emit(
                "scan-progress",
                ScanProgress {
                    id: operation_id.clone(),
                    count,
                },
            );
        },
        || cancel_token.load(Ordering::Relaxed),
    );

    state.remove_token(&operation_id);
    results
}

pub fn scan_directory_internal<F, C>(
    path: &Path,
    daemon: Option<&crate::exiftool_daemon::SharedExifToolDaemon>,
    exiftool_path: &Path,
    mut on_progress: F,
    is_cancelled: C,
) -> Result<Vec<FileMetadataInfo>, String>
where
    F: FnMut(usize),
    C: Fn() -> bool,
{
    use walkdir::WalkDir;

    let mut results = Vec::new();
    let mut scanned_count = 0;

    let walker = WalkDir::new(path).follow_links(true);

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        // Check cancellation
        if is_cancelled() {
            return Err("Operation cancelled".to_string());
        }

        let file_path = entry.path();

        // Skip directories
        if file_path.is_dir() {
            continue;
        }

        // Check if it's an image or video using shared extension list
        if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            if !crate::organize::MEDIA_EXTENSIONS.contains(&ext_lower.as_str()) {
                continue;
            }
        } else {
            continue;
        }

        let file_path_str = file_path.to_string_lossy().to_string();
        let filename = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        // Try to read EXIF using daemon if available, fall back to Command
        let (has_date, camera_model) = if let Some(d) = daemon {
            read_exif_with_daemon(d, &file_path_str)
        } else {
            read_exif_with_command_path(exiftool_path, &file_path_str)
        };

        // Try to extract date from filename
        let extracted_date = extract_date_from_filename(filename);

        results.push(FileMetadataInfo {
            file_path: file_path_str,
            has_date,
            extracted_date,
            camera_model,
        });

        scanned_count += 1;

        // Emit progress every 10 files
        if scanned_count % 10 == 0 {
            on_progress(scanned_count);
        }
    }

    Ok(results)
}

/// Read EXIF metadata using the daemon (fast path).
fn read_exif_with_daemon(
    daemon: &crate::exiftool_daemon::SharedExifToolDaemon,
    file_path: &str,
) -> (bool, Option<String>) {
    match daemon.read_metadata_json(file_path) {
        Ok(json_str) => parse_exif_json_for_scan(&json_str),
        Err(_) => (false, None),
    }
}

/// Parse exiftool JSON output for scan results (date presence and camera model).
fn parse_exif_json_for_scan(json_str: &str) -> (bool, Option<String>) {
    let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(json_str);

    match parsed {
        Ok(arr) if !arr.is_empty() => {
            let data = &arr[0];
            let has_date = data
                .get("DateTimeOriginal")
                .and_then(|v| v.as_str())
                .is_some();

            let make = data.get("Make").and_then(|v| v.as_str());
            let model = data.get("Model").and_then(|v| v.as_str());

            let camera_model = match (make, model) {
                (Some(m), Some(mo)) => Some(format!("{} {}", m.trim(), mo.trim())),
                (None, Some(mo)) => Some(mo.to_string()),
                (Some(m), None) => Some(m.to_string()),
                (None, None) => None,
            };

            (has_date, camera_model)
        }
        _ => (false, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_date_whatsapp_android() {
        let result = extract_date_from_filename("IMG-20240115-WA0042.jpg");
        assert!(result.is_some());
        let ext = result.unwrap();
        assert_eq!(ext.date, "2024-01-15");
        assert_eq!(ext.source, "WhatsApp");
        assert!(ext.time.is_none());
    }

    #[test]
    fn test_extract_date_whatsapp_ios() {
        let result = extract_date_from_filename("WhatsApp Image 2024-01-15 at 10.30.45.jpeg");
        assert!(result.is_some());
        let ext = result.unwrap();
        assert_eq!(ext.date, "2024-01-15");
        assert_eq!(ext.time, Some("10:30:45".to_string()));
        assert_eq!(ext.source, "WhatsApp");
    }

    #[test]
    fn test_extract_date_screenshot_mac() {
        let result = extract_date_from_filename("Screenshot 2024-01-15 at 14.30.00.png");
        assert!(result.is_some());
        let ext = result.unwrap();
        assert_eq!(ext.date, "2024-01-15");
        assert_eq!(ext.time, Some("14:30:00".to_string()));
        assert_eq!(ext.source, "Screenshot");
    }

    #[test]
    fn test_extract_date_android_camera() {
        let result = extract_date_from_filename("20240115_143000.jpg");
        assert!(result.is_some());
        let ext = result.unwrap();
        assert_eq!(ext.date, "2024-01-15");
        assert_eq!(ext.time, Some("14:30:00".to_string()));
        assert_eq!(ext.source, "Camera");
    }

    #[test]
    fn test_extract_date_android_camera_with_prefix() {
        let result = extract_date_from_filename("IMG_20240115_143000.jpg");
        assert!(result.is_some());
        let ext = result.unwrap();
        assert_eq!(ext.date, "2024-01-15");
        assert_eq!(ext.time, Some("14:30:00".to_string()));
        assert_eq!(ext.source, "Camera");
    }

    #[test]
    fn test_extract_date_invalid_date() {
        // Month 15 is invalid
        let result = extract_date_from_filename("20241599_143000.jpg");
        assert!(result.is_none());

        // Year out of range
        let result = extract_date_from_filename("18000101_120000.jpg");
        assert!(result.is_none());

        // Day out of range
        let result = extract_date_from_filename("20240132_120000.jpg");
        assert!(result.is_none());

        // Generic pattern invalid date
        let result = extract_date_from_filename("photo_2024-13-01.jpg");
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_date_no_match() {
        let result = extract_date_from_filename("random_image.jpg");
        assert!(result.is_none());
        
        let result = extract_date_from_filename("no_extension");
        assert!(result.is_none());

        let result = extract_date_from_filename("");
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_date_generic_pattern() {
        let result = extract_date_from_filename("photo_2024-03-20_something.jpg");
        assert!(result.is_some());
        let ext = result.unwrap();
        assert_eq!(ext.date, "2024-03-20");
        assert_eq!(ext.source, "Filename");
    }

    #[test]
    fn test_extract_date_signal_pattern() {
        // signal-2024-01-01-12-00-00.jpg
        let result = extract_date_from_filename("signal-2024-01-01-12-00-00.jpg");
        assert!(result.is_some());
        let ext = result.unwrap();
        assert_eq!(ext.date, "2024-01-01");
        // Our generic pattern catches it but doesn't parse time strictly from "12-00-00" unless we add specific signal regex.
        // The generic regex matches "2024-01-01"
        assert_eq!(ext.source, "Filename");
    }

    #[test]
    fn test_extract_date_hyphenated() {
        let result = extract_date_from_filename("2024-12-25.jpg");
        assert!(result.is_some());
        assert_eq!(result.unwrap().date, "2024-12-25");
    }

    #[test]
    fn test_extract_date_underscored() {
        let result = extract_date_from_filename("2024_12_25.jpg");
        assert!(result.is_some());
        assert_eq!(result.unwrap().date, "2024-12-25");
    }

    #[test]
    fn test_extract_date_google_photos() {
        let result = extract_date_from_filename("PXL_20240115_143000123.jpg");
        assert!(result.is_some());
        let ext = result.unwrap();
        assert_eq!(ext.date, "2024-01-15");
        assert_eq!(ext.time, Some("14:30:00".to_string()));
        assert_eq!(ext.source, "Google Photos");
    }

    #[test]
    fn test_extract_date_samsung() {
        let result = extract_date_from_filename("2024-01-15 14.30.00.jpg");
        assert!(result.is_some());
        let ext = result.unwrap();
        assert_eq!(ext.date, "2024-01-15");
        assert_eq!(ext.time, Some("14:30:00".to_string()));
        assert_eq!(ext.source, "Samsung");
    }

    #[test]
    fn test_extract_date_windows_screenshot() {
        let result = extract_date_from_filename("Screenshot 2024-01-15 143000.png");
        assert!(result.is_some());
        let ext = result.unwrap();
        assert_eq!(ext.date, "2024-01-15");
        assert_eq!(ext.time, Some("14:30:00".to_string()));
        assert_eq!(ext.source, "Screenshot");
    }

    #[test]
    fn test_format_exif_date() {
        assert_eq!(format_exif_date("2024:01:15 14:30:00"), Some("2024-01-15".to_string()));
        assert_eq!(format_exif_date("2024:01:15"), Some("2024-01-15".to_string()));
        assert_eq!(format_exif_date("invalid"), None);
        assert_eq!(format_exif_date("2024-01-15"), None); // Expects colons
    }

    #[test]
    fn test_write_exif_date_if_missing_internal() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("test.jpg");
        std::fs::File::create(&file_path).unwrap();

        let mock_script = std::env::current_dir().unwrap().join("temp_test/mock_exiftool.sh");
        
        // We need to be careful with paths if we are in src-tauri
        let mock_script = if mock_script.exists() {
            mock_script
        } else {
             std::env::current_dir().unwrap().join("src-tauri/temp_test/mock_exiftool.sh")
        };

        if !mock_script.exists() {
            // Skip if mock script not found (should be there in this environment)
            return;
        }

        let result = write_exif_date_if_missing_internal(
            &mock_script,
            file_path.to_str().unwrap(),
            "2024-01-15",
            Some("14:30:00".to_string())
        );

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "Date written: 2024:01:15 14:30:00");
    }

    #[test]
    fn test_read_exif_metadata_internal() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("test.jpg");
        std::fs::File::create(&file_path).unwrap();

        let mock_script = std::env::current_dir().unwrap().join("temp_test/mock_exiftool_json.sh");
        let mock_script = if mock_script.exists() {
            mock_script
        } else {
             std::env::current_dir().unwrap().join("src-tauri/temp_test/mock_exiftool_json.sh")
        };

        if !mock_script.exists() {
            return;
        }

        let result = read_exif_metadata_internal(&mock_script, file_path.to_str().unwrap());

        assert!(result.is_ok());
        let meta = result.unwrap();
        assert_eq!(meta.date_time_original, Some("2024:01:15 14:30:00".to_string()));
        assert_eq!(meta.make, Some("Apple".to_string()));
        assert_eq!(meta.model, Some("iPhone 15".to_string()));
        assert_eq!(meta.keywords, vec!["test".to_string()]);
    }

    #[test]
    fn test_extract_date_no_separators() {
        let result = extract_date_from_filename("20241225.jpg");
        assert!(result.is_some());
        assert_eq!(result.unwrap().date, "2024-12-25");
    }

    #[test]
    fn test_parse_exif_json_for_scan() {
        let json = r#"[{"DateTimeOriginal": "2024:01:15 14:30:00", "Make": "Apple", "Model": "iPhone 15"}]"#;
        let (has_date, model) = parse_exif_json_for_scan(json);
        assert!(has_date);
        assert_eq!(model, Some("Apple iPhone 15".to_string()));

        let json_no_make = r#"[{"DateTimeOriginal": "2024:01:15 14:30:00", "Model": "iPhone 15"}]"#;
        let (has_date, model) = parse_exif_json_for_scan(json_no_make);
        assert!(has_date);
        assert_eq!(model, Some("iPhone 15".to_string()));

        let json_no_date = r#"[{"Make": "Apple", "Model": "iPhone 15"}]"#;
        let (has_date, model) = parse_exif_json_for_scan(json_no_date);
        assert!(!has_date);
        assert_eq!(model, Some("Apple iPhone 15".to_string()));

        let json_empty = "[]";
        let (has_date, model) = parse_exif_json_for_scan(json_empty);
        assert!(!has_date);
        assert_eq!(model, None);

        let json_invalid = "invalid";
        let (has_date, model) = parse_exif_json_for_scan(json_invalid);
        assert!(!has_date);
        assert_eq!(model, None);
    }

    #[test]
    fn test_parse_exif_metadata() {
        let json = serde_json::json!({
            "DateTimeOriginal": "2024:01:15 14:30:00",
            "Make": "Apple",
            "Model": "iPhone 15",
            "Keywords": ["Tag1", "Tag2"],
            "XPKeywords": "Tag3; Tag4",
            "Subject": ["Tag5", "Tag1"] // Duplicate Tag1
        });

        let meta = parse_exif_metadata(&json, "test.jpg");
        assert_eq!(meta.file_path, "test.jpg");
        assert_eq!(meta.date_time_original, Some("2024:01:15 14:30:00".to_string()));
        assert_eq!(meta.make, Some("Apple".to_string()));
        assert_eq!(meta.model, Some("iPhone 15".to_string()));
        
        // Check keywords (order might depend on implementation, but let's check existence)
        assert!(meta.keywords.contains(&"Tag1".to_string()));
        assert!(meta.keywords.contains(&"Tag2".to_string()));
        assert!(meta.keywords.contains(&"Tag3".to_string()));
        assert!(meta.keywords.contains(&"Tag4".to_string()));
        assert!(meta.keywords.contains(&"Tag5".to_string()));
        assert_eq!(meta.keywords.len(), 5);
    }

    #[test]
    fn test_parse_exif_metadata_single_string_keywords() {
        let json = serde_json::json!({
            "Keywords": "SingleTag",
            "Subject": "OtherTag"
        });

        let meta = parse_exif_metadata(&json, "test.jpg");
        assert!(meta.keywords.contains(&"SingleTag".to_string()));
        assert!(meta.keywords.contains(&"OtherTag".to_string()));
        assert_eq!(meta.keywords.len(), 2);
    }

    #[test]
    fn test_exif_metadata_get_camera_model() {
        let mut meta = ExifMetadata {
            file_path: "test.jpg".to_string(),
            date_time_original: None,
            create_date: None,
            make: Some("Apple".to_string()),
            model: Some("iPhone 15".to_string()),
            software: None,
            keywords: vec![],
        };
        assert_eq!(meta.get_camera_model(), Some("Apple iPhone 15".to_string()));

        meta.make = Some("SONY".to_string());
        meta.model = Some("ILCE-7M4".to_string());
        assert_eq!(meta.get_camera_model(), Some("SONY ILCE-7M4".to_string()));

        // Deduplication test
        meta.make = Some("Sony".to_string());
        meta.model = Some("SONY ILCE-7M4".to_string());
        assert_eq!(meta.get_camera_model(), Some("SONY ILCE-7M4".to_string()));

        meta.make = None;
        meta.model = Some("iPhone 15".to_string());
        assert_eq!(meta.get_camera_model(), Some("iPhone 15".to_string()));

        meta.make = Some("Apple".to_string());
        meta.model = None;
        assert_eq!(meta.get_camera_model(), Some("Apple".to_string()));

        meta.make = None;
        meta.model = None;
        assert_eq!(meta.get_camera_model(), None);
    }

    #[test]
    fn test_merge_conflicting_keywords() {
        use std::io::Write;
        use std::path::Path;
        use std::process::Command;
        use tempfile::tempdir;
        use which::which;

        // Skip test if exiftool is not in PATH
        if which("exiftool").is_err() {
            eprintln!("Skipping test_merge_conflicting_keywords: exiftool not found in PATH");
            return;
        }
        let exiftool_path = Path::new("exiftool");

        // 1. Setup temp directory and file
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test_keywords.jpg");
        let path_str = file_path.to_string_lossy().to_string();

        // Create a minimal valid JPEG with ExifTool-writable structure
        // This is a minimal blank JPEG (1x1 pixel)
        let minimal_jpg = [
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
            0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xDB, 0x00, 0x43, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xC0, 0x00, 0x11, 0x08,
            0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
            0xFF, 0xC4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xC4, 0x00, 0x14, 0x10, 0x01,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0xFF, 0xC4, 0x00, 0x14, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xC4, 0x00, 0x14,
            0x11, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0xFF, 0xDA, 0x00, 0x0C, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03,
            0x11, 0x00, 0x3F, 0x00, 0xFF, 0xD9,
        ];

        let mut file = std::fs::File::create(&file_path).unwrap();
        file.write_all(&minimal_jpg).unwrap();

        // 2. Pollute metadata with conflicting tags
        // IPTC:Keywords = "TagA"
        // XPKeywords = "TagB;TagC"
        // XMP:Subject = "TagD"
        let status = Command::new(exiftool_path)
            .args([
                "-overwrite_original",
                "-Keywords=TagA",
                "-XPKeywords=TagB;TagC",
                "-Subject=TagD",
                &path_str,
            ])
            .status()
            .expect("Failed to run exiftool setup");
        assert!(status.success());

        // 3. Call our function to write a NEW tag ("TagE") which should trigger the merge
        let result =
            write_exif_keywords_internal(exiftool_path, &path_str, vec!["TagE".to_string()]);
        assert!(result.is_ok());

        // 4. Verify results
        // Read raw output to check fields individually
        let output = Command::new(exiftool_path)
            .args(["-json", "-Keywords", "-XPKeywords", "-Subject", &path_str])
            .output()
            .unwrap();

        let stdout = String::from_utf8_lossy(&output.stdout);
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&stdout).unwrap();
        let data = &parsed[0];

        // XPKeywords should be missing or empty
        assert!(data.get("XPKeywords").is_none());

        // Keywords and Subject should contain ALL tags (A, B, C, D, E)
        let expected = vec!["TagA", "TagB", "TagC", "TagD", "TagE"];

        let check_field = |field: &str| {
            let val = data.get(field).unwrap();
            let mut found: Vec<String> = if let Some(arr) = val.as_array() {
                arr.iter()
                    .map(|v| v.as_str().unwrap().to_string())
                    .collect()
            } else {
                vec![val.as_str().unwrap().to_string()]
            };
            found.sort();
            assert_eq!(found, expected, "Field {} mismatch", field);
        };

        check_field("Keywords");
        check_field("Subject");
    }

    #[test]
    fn test_scan_directory_internal() {
        let dir = tempfile::tempdir().unwrap();
        let file1 = dir.path().join("20240115_143000.jpg");
        let file2 = dir.path().join("no_date.txt");
        
        std::fs::File::create(&file1).unwrap();
        std::fs::File::create(&file2).unwrap();

        let results = scan_directory_internal(
            dir.path(),
            None,
            Path::new("exiftool"),
            |_| {},
            || false
        ).unwrap();

        assert_eq!(results.len(), 1); // Only .jpg
        assert_eq!(results[0].file_path, file1.to_string_lossy().to_string());
        assert!(results[0].extracted_date.is_some());
        assert_eq!(results[0].extracted_date.as_ref().unwrap().date, "2024-01-15");
    }

    #[test]
    fn test_scan_directory_internal_cancellation() {
        let dir = tempfile::tempdir().unwrap();
        let file1 = dir.path().join("20240115_143000.jpg");
        std::fs::File::create(&file1).unwrap();

        let results = scan_directory_internal(
            dir.path(),
            None,
            Path::new("exiftool"),
            |_| {},
            || true // Immediate cancel
        );

        assert!(results.is_err());
        assert_eq!(results.unwrap_err(), "Operation cancelled");
    }

    #[test]
    fn test_apply_tags_internal_no_files() {
        let dir = tempfile::tempdir().unwrap();
        let rules = vec![TagRule {
            name: "TestTag".to_string(),
            camera_models: vec![],
            directory_patterns: vec![],
        }];

        let result = apply_tags_internal(
            dir.path(),
            &rules,
            None,
            Path::new("exiftool"),
            |_, _, _| {},
            || false
        ).unwrap();

        assert_eq!(result, 0);
    }

    #[test]
    fn test_apply_tags_internal_cancellation() {
        let dir = tempfile::tempdir().unwrap();
        let rules = vec![TagRule {
            name: "TestTag".to_string(),
            camera_models: vec![],
            directory_patterns: vec![],
        }];

        let result = apply_tags_internal(
            dir.path(),
            &rules,
            None,
            Path::new("exiftool"),
            |_, _, _| {},
            || true // Immediate cancel
        );

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Operation cancelled");
    }

    #[test]
    fn test_apply_tags_internal_directory_match() {
        let dir = tempfile::tempdir().unwrap();
        let subdir = dir.path().join("Vacation");
        std::fs::create_dir_all(&subdir).unwrap();
        
        let file1 = subdir.join("photo.jpg");
        std::fs::File::create(&file1).unwrap();

        let rules = vec![TagRule {
            name: "VacationTag".to_string(),
            camera_models: vec![],
            directory_patterns: vec!["Vacation".to_string()],
        }];

        let mock_script = std::env::current_dir().unwrap().join("temp_test/mock_exiftool_success.sh");
        let mock_script = if mock_script.exists() {
            mock_script
        } else {
             std::env::current_dir().unwrap().join("src-tauri/temp_test/mock_exiftool_success.sh")
        };

        if !mock_script.exists() {
            return;
        }
        
        let result = apply_tags_internal(
            dir.path(),
            &rules,
            None,
            &mock_script,
            |_, _, _| {},
            || false
        ).unwrap();

        assert_eq!(result, 1);
    }

    #[test]
    fn test_apply_tags_internal_model_match() {
        let dir = tempfile::tempdir().unwrap();
        let file1 = dir.path().join("photo.jpg");
        std::fs::File::create(&file1).unwrap();

        let rules = vec![TagRule {
            name: "iPhoneTag".to_string(),
            camera_models: vec!["iPhone".to_string()],
            directory_patterns: vec![],
        }];

        let mock_script = std::env::current_dir().unwrap().join("temp_test/mock_exiftool_model.sh");
        let mock_script = if mock_script.exists() {
            mock_script
        } else {
             std::env::current_dir().unwrap().join("src-tauri/temp_test/mock_exiftool_model.sh")
        };

        if !mock_script.exists() {
            return;
        }
        
        let result = apply_tags_internal(
            dir.path(),
            &rules,
            None,
            &mock_script,
            |_, _, _| {},
            || false
        ).unwrap();

        assert_eq!(result, 1);
    }
}
