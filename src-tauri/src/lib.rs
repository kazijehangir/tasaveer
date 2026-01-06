use std::fs;
use std::io::Write;
use tauri::Manager;

mod metadata;
mod dedup;
mod state; // Add state module

use state::AppState; // Import AppState

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
fn load_settings(app_handle: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    
    // Create the directory if it doesn't exist
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    
    let settings_path = data_dir.join("settings.json");
    
    match fs::read_to_string(&settings_path) {
        Ok(content) => Ok(content),
        Err(_) => Ok("{}".to_string()), // Return empty JSON if file doesn't exist
    }
}

#[tauri::command]
fn save_settings(app_handle: tauri::AppHandle, settings: String) -> Result<(), String> {
    let data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    
    // Create the directory if it doesn't exist
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    
    let settings_path = data_dir.join("settings.json");
    
    let mut file = fs::File::create(&settings_path).map_err(|e| e.to_string())?;
    file.write_all(settings.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(())
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
    let dir_name = source_path.file_name()
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
            "-a",          // archive mode (recursive, preserve attrs)
            &source,       // source
            &staging       // destination (rsync will create dir_name inside staging)
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            load_settings,
            save_settings,
            cancel_operation, // Add cancel command
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
            // Dedup commands
            dedup::check_czkawka,
            dedup::find_duplicates,
            dedup::find_similar_images,
            dedup::delete_to_trash,
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
}
