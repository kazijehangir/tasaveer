use std::fs;
use std::io::Write;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn load_settings() -> Result<String, String> {
    let path = "settings.json";
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(_) => Ok("{}".to_string()), // Return empty JSON if file doesn't exist
    }
}

#[tauri::command]
fn save_settings(settings: String) -> Result<(), String> {
    let path = "settings.json";
    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    file.write_all(settings.as_bytes()).map_err(|e| e.to_string())?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, load_settings, save_settings, find_zips])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
