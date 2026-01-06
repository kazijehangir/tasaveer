//! Deduplication module using czkawka CLI.
//!
//! This module provides functions to:
//! - Find exact duplicates (hash-based)
//! - Find similar images (perceptual hash)
//! - Parse czkawka JSON output
//! - Delete files to system Trash

use serde::{Deserialize, Serialize};
use std::process::Command;

/// Represents a group of duplicate files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub files: Vec<DuplicateFile>,
    pub size_bytes: u64,
}

/// A single file in a duplicate group
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateFile {
    pub path: String,
    pub size: u64,
    pub modified: Option<String>,
}

/// Represents a group of similar images
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarGroup {
    pub files: Vec<SimilarFile>,
    pub similarity: f32,
}

/// A single file in a similar images group
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarFile {
    pub path: String,
    pub size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub similarity: u32,  // Similarity difference (0 = identical, higher = more different)
}

/// Result of a dedup scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DedupResult {
    pub duplicates: Vec<DuplicateGroup>,
    pub total_groups: usize,
    pub total_wasted_space: u64,
}

/// Result of a similar images scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarResult {
    pub similar_groups: Vec<SimilarGroup>,
    pub total_groups: usize,
}

/// Check if czkawka_cli is available in PATH or at a custom path
#[tauri::command]
pub fn check_czkawka() -> Result<String, String> {
    // Try custom path from settings first (would be passed in)
    // For now, just check PATH
    let output = Command::new("czkawka_cli")
        .arg("--version")
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let version = String::from_utf8_lossy(&out.stdout);
            Ok(format!("czkawka_cli found: {}", version.trim()))
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            Err(format!("czkawka_cli failed: {}", stderr))
        }
        Err(_) => Err("czkawka_cli not found in PATH. Please install it or download from GitHub.".to_string())
    }
}

#[derive(Clone, serde::Serialize)]
struct DedupProgress {
    id: String,
    status: String,
}

/// Find exact duplicate files using hash comparison (async, cancellable)
#[tauri::command]
pub async fn find_duplicates(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    path: String,
    czkawka_path: Option<String>,
    operation_id: String,
) -> Result<DedupResult, String> {
    use tauri::{Emitter, Manager};
    
    let czkawka = czkawka_path.unwrap_or_else(|| "czkawka_cli".to_string());
    
    // Create a temp file for JSON output
    let temp_dir = std::env::temp_dir();
    let output_file = temp_dir.join("tasaveer_dup_results.json");
    let output_path = output_file.to_string_lossy().to_string();

    // Emit indeterminate progress
    let _ = app_handle.emit("dedup-progress", DedupProgress {
        id: operation_id.clone(),
        status: "Running czkawka scan...".to_string()
    });

    // Spawn process
    let mut child = Command::new(&czkawka)
        .args([
            "dup",
            "-d", &path,
            "-C", &output_path,
        ])
        .spawn()
        .map_err(|e| format!("Failed to spawn czkawka: {}", e))?;
        
    let pid = child.id();
    
    // register process for cancellation
    state.running_processes.lock().unwrap().insert(operation_id.clone(), pid);
    
    // Wait for output
    let output = child.wait_with_output()
        .map_err(|e| format!("Failed to wait for czkawka: {}", e))?;
        
    // remove from running processes
    state.running_processes.lock().unwrap().remove(&operation_id);

    // Read and parse the JSON output (czkawka creates the file even with non-zero exit)
    let json_content = std::fs::read_to_string(&output_file)
        .map_err(|e| format!("czkawka did not produce output file. Is czkawka_cli installed? Error: {}", e))?;

    parse_duplicate_json(&json_content)
}

/// Find similar images using perceptual hash (async, cancellable)
#[tauri::command]
pub async fn find_similar_images(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    path: String,
    czkawka_path: Option<String>,
    operation_id: String,
) -> Result<SimilarResult, String> {
    use tauri::{Emitter, Manager};
    
    let czkawka = czkawka_path.unwrap_or_else(|| "czkawka_cli".to_string());
    
    let temp_dir = std::env::temp_dir();
    let output_file = temp_dir.join("tasaveer_similar_results.json");
    let output_path = output_file.to_string_lossy().to_string();

    // Emit indeterminate progress
    let _ = app_handle.emit("similar-progress", DedupProgress {
        id: operation_id.clone(),
        status: "Scanning for similar images...".to_string()
    });

    let mut child = Command::new(&czkawka)
        .args([
            "image",
            "-d", &path,
            "-C", &output_path,
        ])
        .spawn()
        .map_err(|e| format!("Failed to spawn czkawka: {}", e))?;
        
    let pid = child.id();
    state.running_processes.lock().unwrap().insert(operation_id.clone(), pid);
    
    let output = child.wait_with_output()
        .map_err(|e| format!("Failed to wait for czkawka: {}", e))?;
        
    state.running_processes.lock().unwrap().remove(&operation_id);

    let json_content = std::fs::read_to_string(&output_file)
        .map_err(|e| format!("czkawka did not produce output file. Is czkawka_cli installed? Error: {}", e))?;

    parse_similar_json(&json_content)
}

/// Parse czkawka duplicate JSON output
/// czkawka 10.0 outputs: {"24576":[[{"path":..., "size":..., "hash":...}, ...]]} 
/// Keyed by file size, value is array of groups, each group is array of files
fn parse_duplicate_json(json: &str) -> Result<DedupResult, String> {
    if json.trim().is_empty() || json.trim() == "[]" || json.trim() == "{}" {
        return Ok(DedupResult {
            duplicates: vec![],
            total_groups: 0,
            total_wasted_space: 0,
        });
    }

    let parsed: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let mut groups = Vec::new();
    let mut total_wasted = 0u64;

    // czkawka 10.0: object keyed by file size
    if let Some(obj) = parsed.as_object() {
        for (_size_key, size_groups) in obj {
            // Each size key has an array of groups
            if let Some(groups_array) = size_groups.as_array() {
                for group in groups_array {
                    // Each group is an array of files
                    if let Some(files_array) = group.as_array() {
                        let mut files = Vec::new();
                        let mut group_size = 0u64;

                        for file in files_array {
                            let path = file.get("path")
                                .and_then(|p| p.as_str())
                                .unwrap_or("")
                                .to_string();
                            let size = file.get("size")
                                .and_then(|s| s.as_u64())
                                .unwrap_or(0);
                            let modified = file.get("modified_date")
                                .and_then(|m| m.as_i64())
                                .map(|ts| {
                                    // Convert Unix timestamp to readable date
                                    chrono::DateTime::from_timestamp(ts, 0)
                                        .map(|dt| dt.format("%Y-%m-%d").to_string())
                                        .unwrap_or_else(|| ts.to_string())
                                });

                            if !files.is_empty() {
                                total_wasted += size;
                            }
                            group_size = size;

                            files.push(DuplicateFile { path, size, modified });
                        }

                        if files.len() > 1 {
                            groups.push(DuplicateGroup {
                                files,
                                size_bytes: group_size,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(DedupResult {
        total_groups: groups.len(),
        total_wasted_space: total_wasted,
        duplicates: groups,
    })
}

/// Parse czkawka similar images JSON output
/// czkawka 10.0 outputs: [[{"path":..., "size":..., "width":..., "height":..., "similarity":...}, ...]]
fn parse_similar_json(json: &str) -> Result<SimilarResult, String> {
    if json.trim().is_empty() || json.trim() == "[]" || json.trim() == "{}" {
        return Ok(SimilarResult {
            similar_groups: vec![],
            total_groups: 0,
        });
    }

    let parsed: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let mut groups = Vec::new();

    // czkawka 10.0: array of groups, each group is an array of files
    if let Some(groups_array) = parsed.as_array() {
        for group in groups_array {
            if let Some(files_array) = group.as_array() {
                let mut files = Vec::new();
                let mut max_similarity = 0u32;

                for file in files_array {
                    let path = file.get("path")
                        .and_then(|p| p.as_str())
                        .unwrap_or("")
                        .to_string();
                    let size = file.get("size")
                        .and_then(|s| s.as_u64())
                        .unwrap_or(0);
                    let width = file.get("width")
                        .and_then(|w| w.as_u64())
                        .map(|w| w as u32);
                    let height = file.get("height")
                        .and_then(|h| h.as_u64())
                        .map(|h| h as u32);
                    let similarity = file.get("similarity")
                        .and_then(|s| s.as_u64())
                        .unwrap_or(0) as u32;

                    if similarity > max_similarity {
                        max_similarity = similarity;
                    }

                    files.push(SimilarFile { path, size, width, height, similarity });
                }

                if files.len() > 1 {
                    // Convert similarity difference to percentage (lower diff = higher similarity)
                    // czkawka uses 0 = identical, higher = more different
                    let similarity_pct = 100.0 - (max_similarity as f32 / 10.0).min(100.0);
                    groups.push(SimilarGroup { files, similarity: similarity_pct });
                }
            }
        }
    }

    Ok(SimilarResult {
        total_groups: groups.len(),
        similar_groups: groups,
    })
}

/// Delete files to system Trash (recoverable)
#[tauri::command]
pub fn delete_to_trash(files: Vec<String>) -> Result<String, String> {
    let mut deleted = 0;
    let mut errors = Vec::new();

    for file in &files {
        match trash::delete(file) {
            Ok(_) => deleted += 1,
            Err(e) => errors.push(format!("{}: {}", file, e)),
        }
    }

    if errors.is_empty() {
        Ok(format!("Deleted {} files to Trash", deleted))
    } else {
        Err(format!(
            "Deleted {} files, but {} failed: {}",
            deleted,
            errors.len(),
            errors.join("; ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_duplicate_json_empty() {
        let result = parse_duplicate_json("[]").unwrap();
        assert_eq!(result.total_groups, 0);
        assert_eq!(result.total_wasted_space, 0);
        assert!(result.duplicates.is_empty());
    }

    #[test]
    fn test_parse_duplicate_json_empty_string() {
        let result = parse_duplicate_json("").unwrap();
        assert_eq!(result.total_groups, 0);
    }

    #[test]
    fn test_parse_duplicate_json_with_data() {
        // czkawka 10.0 format: object keyed by file size
        let json = r#"{
            "1000": [[
                {"path": "/a/file1.jpg", "size": 1000, "modified_date": 1705276800, "hash": "abc"},
                {"path": "/b/file1.jpg", "size": 1000, "modified_date": 1705276800, "hash": "abc"}
            ]]
        }"#;
        let result = parse_duplicate_json(json).unwrap();
        assert_eq!(result.total_groups, 1);
        assert_eq!(result.duplicates[0].files.len(), 2);
        assert_eq!(result.total_wasted_space, 1000);
    }

    #[test]
    fn test_parse_similar_json_empty() {
        let result = parse_similar_json("[]").unwrap();
        assert_eq!(result.total_groups, 0);
        assert!(result.similar_groups.is_empty());
    }

    #[test]
    fn test_parse_similar_json_with_data() {
        // czkawka 10.0 format: array of groups, each group is array of files
        let json = r#"[[
            {"path": "/a/img1.jpg", "size": 2000, "width": 1920, "height": 1080, "similarity": 0, "hash": []},
            {"path": "/b/img1.jpg", "size": 1500, "width": 1280, "height": 720, "similarity": 3, "hash": []}
        ]]"#;
        let result = parse_similar_json(json).unwrap();
        assert_eq!(result.total_groups, 1);
        assert_eq!(result.similar_groups[0].files.len(), 2);
        // 0 similarity = identical, higher = more different
        assert!(result.similar_groups[0].similarity > 90.0);
    }
}
