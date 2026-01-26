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
    static ref WHATSAPP_ANDROID_RE: Regex = Regex::new(r"IMG-(\d{4})(\d{2})(\d{2})-WA").unwrap();
    static ref WHATSAPP_IOS_RE: Regex =
        Regex::new(r"WhatsApp.*(\d{4})-(\d{2})-(\d{2})(?:\s+at\s+(\d{2})\.(\d{2})\.(\d{2}))?")
            .unwrap();
    static ref SCREENSHOT_MAC_RE: Regex =
        Regex::new(r"Screenshot\s+(\d{4})-(\d{2})-(\d{2})\s+at\s+(\d{2})\.(\d{2})\.(\d{2})")
            .unwrap();
    static ref ANDROID_CAMERA_RE: Regex =
        Regex::new(r"(?:IMG_)?(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})").unwrap();
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

/// Read EXIF metadata from a file using exiftool
#[tauri::command]
pub fn read_exif_metadata(file_path: String) -> Result<ExifMetadata, String> {
    // Validate path before executing command
    let path = Path::new(&file_path);
    if !path.is_file() {
        return Err(format!(
            "Path does not exist or is not a file: {}",
            file_path
        ));
    }

    let output = Command::new("exiftool")
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
            &file_path,
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

    let data = &parsed[0];

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

    Ok(ExifMetadata {
        file_path,
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
    })
}

/// Get camera model string from EXIF (Make + Model)
#[tauri::command]
pub fn get_camera_model(file_path: String) -> Result<Option<String>, String> {
    match read_exif_metadata(file_path) {
        Ok(metadata) => match (metadata.make, metadata.model) {
            (Some(make), Some(model)) => Ok(Some(format!("{} {}", make.trim(), model.trim()))),
            (None, Some(model)) => Ok(Some(model)),
            (Some(make), None) => Ok(Some(make)),
            (None, None) => Ok(None),
        },
        Err(_) => Ok(None), // No EXIF data is not an error for this function
    }
}

/// Write EXIF date to file ONLY if DateTimeOriginal is missing
#[tauri::command]
pub fn write_exif_date_if_missing(
    file_path: String,
    date: String,
    time: Option<String>,
) -> Result<String, String> {
    // Validate path before executing command
    let path = Path::new(&file_path);
    if !path.is_file() {
        return Err(format!(
            "Path does not exist or is not a file: {}",
            file_path
        ));
    }

    // First check if date already exists
    if let Ok(metadata) = read_exif_metadata(file_path.clone()) {
        if metadata.date_time_original.is_some() {
            return Ok("Date already exists, skipping".to_string());
        }
    }

    // Format the datetime for EXIF
    let datetime = match time {
        Some(t) => format!("{} {}", date.replace('-', ":"), t),
        None => format!("{} 12:00:00", date.replace('-', ":")),
    };

    let output = Command::new("exiftool")
        .args([
            "-overwrite_original",
            &format!("-DateTimeOriginal={}", datetime),
            &format!("-CreateDate={}", datetime),
            &file_path,
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
pub fn write_exif_keywords(file_path: String, keywords: Vec<String>) -> Result<String, String> {
    if keywords.is_empty() {
        return Ok("No keywords to write".to_string());
    }

    // Validate path before executing command
    let path = Path::new(&file_path);
    if !path.is_file() {
        return Err(format!(
            "Path does not exist or is not a file: {}",
            file_path
        ));
    }

    // First, read existing keywords using our robust reader
    let existing_keywords = match read_exif_metadata(file_path.clone()) {
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

    let output = Command::new("exiftool")
        .args([
            "-overwrite_original",
            "-P", // Preserve file modification date
            "-sep",
            ", ", // Ensure lists are written correctly
            &format!("-Keywords={}", keywords_str),
            &format!("-Subject={}", keywords_str), // Sync XMP
            "-XPKeywords=", // Remove Windows-specific tag to avoid duplication
            &file_path,
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
    use walkdir::WalkDir;

    let cancel_token = state.register_token(&operation_id);

    // Try to start the ExifTool daemon for batch processing
    let daemon_available = state.exiftool_daemon.ensure_started(None).is_ok();
    if daemon_available {
        eprintln!("[INFO] Using ExifTool daemon for optimized scanning");
    } else {
        eprintln!("[WARN] ExifTool daemon unavailable, falling back to per-file processing");
    }

    let mut results = Vec::new();
    let mut scanned_count = 0;

    let walker = WalkDir::new(&path).follow_links(true);

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        // Check cancellation
        if cancel_token.load(Ordering::Relaxed) {
            state.remove_token(&operation_id);
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
        let (has_date, camera_model) = if daemon_available {
            read_exif_with_daemon(&state.exiftool_daemon, &file_path_str)
        } else {
            read_exif_with_command(&file_path_str)
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

        // Emit progress every 10 files to avoid flooding events
        if scanned_count % 10 == 0 {
            let _ = app_handle.emit(
                "scan-progress",
                ScanProgress {
                    id: operation_id.clone(),
                    count: scanned_count,
                },
            );
        }
    }

    state.remove_token(&operation_id);
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

/// Read EXIF metadata by spawning exiftool (slow fallback path).
fn read_exif_with_command(file_path: &str) -> (bool, Option<String>) {
    match read_exif_metadata(file_path.to_string()) {
        Ok(metadata) => (
            metadata.date_time_original.is_some(),
            match (metadata.make, metadata.model) {
                (Some(make), Some(model)) => Some(format!("{} {}", make.trim(), model.trim())),
                (None, Some(model)) => Some(model),
                (Some(make), None) => Some(make),
                (None, None) => None,
            },
        ),
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
    fn test_extract_date_no_match() {
        let result = extract_date_from_filename("random_image.jpg");
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_date_invalid_date() {
        // Month 15 is invalid
        let result = extract_date_from_filename("20241599_143000.jpg");
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
    fn test_extract_date_no_separators() {
        let result = extract_date_from_filename("20241225.jpg");
        assert!(result.is_some());
        assert_eq!(result.unwrap().date, "2024-12-25");
    }

    #[test]
    fn test_merge_conflicting_keywords() {
        use std::io::Write;
        use tempfile::tempdir;

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
        let status = Command::new("exiftool")
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
        let result = write_exif_keywords(path_str.clone(), vec!["TagE".to_string()]);
        assert!(result.is_ok());

        // 4. Verify results
        // Read raw output to check fields individually
        let output = Command::new("exiftool")
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
}
