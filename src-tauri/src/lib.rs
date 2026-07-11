use std::fs;

pub mod binaries;
pub mod catalog;

mod dedup;
mod exiftool_daemon;
mod metadata;
mod organize;
mod state; // Add state module
pub mod disk;
pub mod reconcile;

use state::AppState; // Import AppState
use tauri_plugin_shell::ShellExt;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn cancel_operation(state: tauri::State<AppState>, operation_id: String) {
    state.cancel(&operation_id);
}

#[tauri::command]
fn find_zips(path: String) -> Result<Vec<String>, String> {
    let mut zips = Vec::new();
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
            if ext.to_lowercase() == "zip" {
                if let Some(path_str) = path.to_str() {
                    zips.push(path_str.to_string());
                }
            }
        }
    }
    Ok(zips)
}

#[tauri::command]
fn copy_to_staging(source: String, staging: String) -> Result<String, String> {
    // Check if source exists
    if !std::path::Path::new(&source).exists() {
        return Err(format!("Source path does not exist: {}", source));
    }

    // Create staging directory if it doesn't exist
    fs::create_dir_all(&staging).map_err(|e| format!("Failed to create staging dir: {}", e))?;

    // Use rsync -a (archive mode) to preserve attributes and recursiveness
    // source/ -> copies contents of source to staging (if trailing slash)
    // source  -> copies source directory into staging (if no trailing slash)
    // We want to copy contents into a subdirectory in staging or directly?
    // Let's copy source folder INTO staging to keep them separated if multiple sources.

    // Get source folder name to create specific subdir in staging
    let source_path = std::path::Path::new(&source);
    let dir_name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("source");

    let final_dest = std::path::Path::new(&staging).join(dir_name);
    let final_dest_str = final_dest.to_string_lossy().to_string();

    // Ensure parent dir exists
    if let Some(parent) = final_dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let output = std::process::Command::new("rsync")
        .args([
            "-a",     // archive mode (recursive, preserve attrs)
            &source,  // source
            &staging, // destination (rsync will create dir_name inside staging)
        ])
        .output()
        .map_err(|e| format!("Failed to execute rsync: {}", e))?;

    if output.status.success() {
        Ok(final_dest_str)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("rsync failed: {}", stderr))
    }
}

#[tauri::command]
fn clean_staging(path: String) -> Result<(), String> {
    // Safety check: ensure path contains "staging" to prevent accidental deletion of important dirs
    if !path.to_lowercase().contains("staging") {
        return Err("Safety check failed: Path must contain 'staging' to be deleted".to_string());
    }

    if std::path::Path::new(&path).exists() {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to remove staging dir: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn validate_immich(url: String, api_key: String) -> Result<String, String> {
    let client = reqwest::blocking::Client::new();

    // 1. Clean up URL (remove trailing slash)
    let base_url = url.trim_end_matches('/');

    // 2. Check Ping (validates URL)
    let ping_url = format!("{}/api/server-info/ping", base_url);
    match client.get(&ping_url).send() {
        Ok(res) => {
            if !res.status().is_success() && res.status() != reqwest::StatusCode::NOT_FOUND {
                // Ignore 404s for ping as some versions hide it, but log others?
                // For now, proceed to Auth check as the ultimate truth.
            }
        }
        Err(e) => {
            return Err(format!(
                "Could not reach server at {}. Error: {}",
                base_url, e
            ))
        }
    }

    // 3. Check Auth (validates API Key)
    // This is the real test. If this passes, everything is good.
    let auth_url = format!("{}/api/users/me", base_url);
    let auth_res = client
        .get(&auth_url)
        .header("x-api-key", &api_key)
        .header("Accept", "application/json")
        .send()
        .map_err(|e| format!("Network error during auth: {}", e))?;

    let status = auth_res.status();
    if status.is_success() {
        Ok("Connected successfully!".to_string())
    } else {
        // Capture the body to understand the 404 or error
        let body = auth_res.text().unwrap_or_else(|_| "<no body>".to_string());
        Err(format!(
            "Authentication failed at {}. Status: {}.\nResponse: {}",
            auth_url, status, body
        ))
    }
}

#[derive(serde::Serialize)]
pub struct BinaryStatus {
    pub found: bool,
    pub path: Option<String>,
    pub source: String,
    pub version: Option<String>,
}

#[tauri::command]
async fn verify_binary(app_handle: tauri::AppHandle, name: String) -> Result<BinaryStatus, String> {
    let prerequisite = match name.as_str() {
        "exiftool" => binaries::Prerequisite::ExifTool,
        "immich-go" => binaries::Prerequisite::ImmichGo,
        "czkawka" => binaries::Prerequisite::Czkawka,
        _ => return Err(format!("Unknown prerequisite: {}", name)),
    };

    // 1. Try standard discovery (PATH or manually found)
    match prerequisite.discover(&app_handle) {
        Ok(path) => {
            // Try to get version (blocking is acceptable here for short commands)
            let arg = if name == "exiftool" {
                "-version"
            } else {
                "--version"
            };
            let output = std::process::Command::new(&path).arg(arg).output();

            let version = match output {
                Ok(out) if out.status.success() => {
                    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
                }
                _ => None,
            };

            let source = if path.to_string_lossy().contains("resources")
                || path.to_string_lossy().contains("binaries")
            {
                "bundled"
            } else {
                "path"
            };

            Ok(BinaryStatus {
                found: true,
                path: Some(path.to_string_lossy().to_string()),
                source: source.to_string(),
                version,
            })
        }
        Err(_) => {
            // 2. Fallback: Try running as a sidecar (for bundled binaries)
            if name == "immich-go" || name == "exiftool" {
                if let Ok(cmd) = app_handle.shell().sidecar(&name) {
                    let arg = if name == "exiftool" {
                        "-ver"
                    } else {
                        "version"
                    };

                    // Execute async sidecar command
                    match cmd.args([arg]).output().await {
                        Ok(output) if output.status.success() => {
                            let version =
                                String::from_utf8_lossy(&output.stdout).trim().to_string();
                            return Ok(BinaryStatus {
                                found: true,
                                path: None, // Sidecar path is managed by Tauri
                                source: "bundled".to_string(),
                                version: Some(version),
                            });
                        }
                        _ => {} // Fall through to not found
                    }
                }
            }

            Ok(BinaryStatus {
                found: false,
                path: None,
                source: "none".to_string(),
                version: None,
            })
        }
    }
}

#[cfg(target_os = "macos")]
fn fix_path_env() {
    use std::env;
    use std::process::Command;

    if let Ok(output) = Command::new("sh")
        .arg("-l")
        .arg("-c")
        .arg("echo $PATH")
        .output()
    {
        if let Ok(path) = String::from_utf8(output.stdout) {
            env::set_var("PATH", path.trim());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    fix_path_env();

    tauri::Builder::default()
        .manage(AppState::new()) // Initialize AppState
        .setup(|app| {
            // Sessions can only legitimately be 'running' while their command
            // executes, so at startup any such row is a crash leftover.
            if let Ok(catalog) = catalog::Catalog::open(app.handle()) {
                if let Err(e) = catalog.mark_interrupted_sessions() {
                    eprintln!("Failed to clean up interrupted sessions: {}", e);
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            cancel_operation,
            find_zips,
            copy_to_staging,
            clean_staging,
            validate_immich,
            // Metadata commands
            metadata::read_exif_metadata,
            metadata::get_camera_model,
            metadata::write_exif_date_if_missing,
            metadata::write_exif_keywords,
            metadata::scan_missing_dates,
            metadata::apply_tags_to_directory,
            // Dedup commands
            dedup::check_czkawka,
            dedup::find_duplicates,
            dedup::find_similar_images,
            dedup::delete_to_trash,
            // Organize commands
            organize::preview_organize,
            organize::run_organize,
            organize::run_unified_ingest,
            // Reconcile commands
            reconcile::run_reconcile,
            reconcile::backup_at_risk,
            reconcile::free_local_space,
            reconcile::deep_verify_folder,
            reconcile::seed_catalog_from_reconcile,
            reconcile::eject_volume,
            // Catalog commands
            catalog::get_catalog_path,
            catalog::get_catalog_stats,
            catalog::get_recent_sessions,
            verify_binary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_greet() {
        let result = greet("World");
        assert_eq!(result, "Hello, World! You've been greeted from Rust!");
    }

    #[test]
    fn test_greet_empty_name() {
        let result = greet("");
        assert_eq!(result, "Hello, ! You've been greeted from Rust!");
    }

    #[test]
    fn test_greet_special_chars() {
        let result = greet("Alice & Bob");
        assert_eq!(result, "Hello, Alice & Bob! You've been greeted from Rust!");
    }

    #[test]
    fn test_find_zips_finds_zip_files() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path();

        // Create some test files
        fs::File::create(dir_path.join("test1.zip")).unwrap();
        fs::File::create(dir_path.join("test2.ZIP")).unwrap(); // Uppercase
        fs::File::create(dir_path.join("test3.jpg")).unwrap();
        fs::File::create(dir_path.join("test4.txt")).unwrap();

        let result = find_zips(dir_path.to_string_lossy().to_string()).unwrap();

        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|p| p.contains("test1.zip")));
        assert!(result.iter().any(|p| p.contains("test2.ZIP")));
    }

    #[test]
    fn test_find_zips_empty_directory() {
        let dir = tempdir().unwrap();
        let result = find_zips(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_find_zips_no_zip_files() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path();

        // Create non-zip files
        fs::File::create(dir_path.join("image.jpg")).unwrap();
        fs::File::create(dir_path.join("document.pdf")).unwrap();

        let result = find_zips(dir_path.to_string_lossy().to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_find_zips_nonexistent_directory() {
        let result = find_zips("/nonexistent/path/that/should/not/exist".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_find_zips_ignores_subdirectories() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path();

        // Create a zip file and a subdirectory
        fs::File::create(dir_path.join("valid.zip")).unwrap();
        fs::create_dir(dir_path.join("subdir")).unwrap();
        fs::File::create(dir_path.join("subdir").join("nested.zip")).unwrap();

        let result = find_zips(dir_path.to_string_lossy().to_string()).unwrap();

        // Should only find the top-level zip, not the nested one
        assert_eq!(result.len(), 1);
        assert!(result[0].contains("valid.zip"));
    }

    #[test]
    fn test_clean_staging() {
        let dir = tempdir().unwrap();
        let staging_path = dir.path().join("my-staging-area");
        fs::create_dir_all(&staging_path).unwrap();
        fs::File::create(staging_path.join("some-file.txt")).unwrap();
        
        assert!(staging_path.exists());
        
        let result = clean_staging(staging_path.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(!staging_path.exists());
    }

    #[test]
    fn test_clean_staging_safety() {
        let dir = tempdir().unwrap();
        let important_dir = dir.path().join("important-data");
        fs::create_dir_all(&important_dir).unwrap();
        
        let result = clean_staging(important_dir.to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Safety check failed"));
        assert!(important_dir.exists());
    }

    #[test]
    fn test_copy_to_staging() {
        // Skip if rsync is not available
        if std::process::Command::new("rsync").arg("--version").output().is_err() {
            return;
        }

        let dir = tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let staging_dir = dir.path().join("staging");
        
        fs::create_dir_all(&source_dir).unwrap();
        fs::File::create(source_dir.join("test.txt")).unwrap();
        
        let result = copy_to_staging(
            source_dir.to_string_lossy().to_string(),
            staging_dir.to_string_lossy().to_string()
        );
        
        assert!(result.is_ok());
        let final_dest_str = result.unwrap();
        let final_dest = std::path::Path::new(&final_dest_str);
        assert!(final_dest.exists());
        assert!(final_dest.join("test.txt").exists());
    }
}
