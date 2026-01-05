//! Metadata module for EXIF operations using ExifTool.
//!
//! This module provides functions to:
//! - Scan files for missing DateTimeOriginal
//! - Extract dates from filename patterns (WhatsApp, screenshots, etc.)
//! - Read and write EXIF metadata safely (never overwriting valid data)

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::process::Command;

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
    pub date: String,        // Format: YYYY-MM-DD
    pub time: Option<String>, // Format: HH:MM:SS if available
    pub source: String,      // e.g., "WhatsApp", "Screenshot", "Android Camera"
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
    let whatsapp_android = Regex::new(r"IMG-(\d{4})(\d{2})(\d{2})-WA").unwrap();
    if let Some(caps) = whatsapp_android.captures(filename) {
        return Some(ExtractedDate {
            date: format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]),
            time: None,
            source: "WhatsApp".to_string(),
        });
    }

    // WhatsApp iOS: WhatsApp Image 2024-01-15 at 10.30.45
    let whatsapp_ios = Regex::new(r"WhatsApp.*(\d{4})-(\d{2})-(\d{2})(?:\s+at\s+(\d{2})\.(\d{2})\.(\d{2}))?").unwrap();
    if let Some(caps) = whatsapp_ios.captures(filename) {
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
    let screenshot_mac = Regex::new(r"Screenshot\s+(\d{4})-(\d{2})-(\d{2})\s+at\s+(\d{2})\.(\d{2})\.(\d{2})").unwrap();
    if let Some(caps) = screenshot_mac.captures(filename) {
        return Some(ExtractedDate {
            date: format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]),
            time: Some(format!("{}:{}:{}", &caps[4], &caps[5], &caps[6])),
            source: "Screenshot".to_string(),
        });
    }

    // Android Camera: 20240115_143000.jpg or IMG_20240115_143000.jpg
    let android_camera = Regex::new(r"(?:IMG_)?(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})").unwrap();
    if let Some(caps) = android_camera.captures(filename) {
        let year: u32 = caps[1].parse().unwrap_or(0);
        let month: u32 = caps[2].parse().unwrap_or(0);
        let day: u32 = caps[3].parse().unwrap_or(0);
        
        // Validate it looks like a real date
        if year >= 1990 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31 {
            return Some(ExtractedDate {
                date: format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]),
                time: Some(format!("{}:{}:{}", &caps[4], &caps[5], &caps[6])),
                source: "Camera".to_string(),
            });
        }
    }

    // Generic date pattern: YYYY-MM-DD or YYYYMMDD anywhere in filename
    let generic_date = Regex::new(r"(\d{4})[-_]?(\d{2})[-_]?(\d{2})").unwrap();
    if let Some(caps) = generic_date.captures(filename) {
        let year: u32 = caps[1].parse().unwrap_or(0);
        let month: u32 = caps[2].parse().unwrap_or(0);
        let day: u32 = caps[3].parse().unwrap_or(0);
        
        // Validate it looks like a real date
        if year >= 1990 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31 {
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

    Ok(ExifMetadata {
        file_path,
        date_time_original: data.get("DateTimeOriginal").and_then(|v| v.as_str()).map(|s| s.to_string()),
        create_date: data.get("CreateDate").and_then(|v| v.as_str()).map(|s| s.to_string()),
        make: data.get("Make").and_then(|v| v.as_str()).map(|s| s.to_string()),
        model: data.get("Model").and_then(|v| v.as_str()).map(|s| s.to_string()),
        software: data.get("Software").and_then(|v| v.as_str()).map(|s| s.to_string()),
        keywords,
    })
}

/// Get camera model string from EXIF (Make + Model)
#[tauri::command]
pub fn get_camera_model(file_path: String) -> Result<Option<String>, String> {
    match read_exif_metadata(file_path) {
        Ok(metadata) => {
            match (metadata.make, metadata.model) {
                (Some(make), Some(model)) => Ok(Some(format!("{} {}", make.trim(), model.trim()))),
                (None, Some(model)) => Ok(Some(model)),
                (Some(make), None) => Ok(Some(make)),
                (None, None) => Ok(None),
            }
        }
        Err(_) => Ok(None), // No EXIF data is not an error for this function
    }
}

/// Write EXIF date to file ONLY if DateTimeOriginal is missing
#[tauri::command]
pub fn write_exif_date_if_missing(file_path: String, date: String, time: Option<String>) -> Result<String, String> {
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

/// Write keywords/tags to EXIF
#[tauri::command]
pub fn write_exif_keywords(file_path: String, keywords: Vec<String>) -> Result<String, String> {
    if keywords.is_empty() {
        return Ok("No keywords to write".to_string());
    }

    let keywords_str = keywords.join("; ");
    
    let output = Command::new("exiftool")
        .args([
            "-overwrite_original",
            &format!("-XPKeywords={}", keywords_str),
            &format!("-Keywords={}", keywords.join(", ")),
            &format!("-IPTC:Keywords={}", keywords.join(", ")),
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

/// Scan a directory for files missing DateTimeOriginal
#[tauri::command]
pub fn scan_missing_dates(path: String) -> Result<Vec<FileMetadataInfo>, String> {
    let mut results = Vec::new();
    
    let entries = std::fs::read_dir(&path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_path = entry.path();
        
        // Skip directories
        if file_path.is_dir() {
            continue;
        }

        // Check if it's an image or video
        if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            if !matches!(ext_lower.as_str(), 
                "jpg" | "jpeg" | "png" | "heic" | "heif" | "webp" | 
                "mp4" | "mov" | "avi" | "mkv" | "m4v"
            ) {
                continue;
            }
        } else {
            continue;
        }

        let file_path_str = file_path.to_string_lossy().to_string();
        let filename = file_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        // Try to read EXIF
        let (has_date, camera_model) = match read_exif_metadata(file_path_str.clone()) {
            Ok(metadata) => (
                metadata.date_time_original.is_some(),
                match (metadata.make, metadata.model) {
                    (Some(make), Some(model)) => Some(format!("{} {}", make.trim(), model.trim())),
                    (None, Some(model)) => Some(model),
                    (Some(make), None) => Some(make),
                    (None, None) => None,
                }
            ),
            Err(_) => (false, None),
        };

        // Try to extract date from filename
        let extracted_date = extract_date_from_filename(filename);

        results.push(FileMetadataInfo {
            file_path: file_path_str,
            has_date,
            extracted_date,
            camera_model,
        });
    }

    Ok(results)
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
}
