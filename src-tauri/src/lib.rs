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
        },
        Err(e) => return Err(format!("Could not reach server at {}. Error: {}", base_url, e)),
    }

    // 3. Check Auth (validates API Key)
    // This is the real test. If this passes, everything is good.
    let auth_url = format!("{}/api/users/me", base_url);
    let auth_res = client.get(&auth_url)
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
        Err(format!("Authentication failed at {}. Status: {}.\nResponse: {}", auth_url, status, body))
    }
}

#[cfg(target_os = "macos")]
fn fix_path_env() {
    use std::process::Command;
    use std::env;

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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, load_settings, save_settings, find_zips, validate_immich])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
