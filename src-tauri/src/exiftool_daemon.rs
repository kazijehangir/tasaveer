//! ExifTool wrapper for high-performance batch metadata operations.
//!
//! Uses the `exiftool` crate which maintains a long-running ExifTool process
//! in stay-open mode for efficiency when processing multiple files.

use exiftool::ExifTool;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Thread-safe wrapper around ExifTool for use in async contexts.
#[derive(Clone)]
pub struct SharedExifToolDaemon {
    inner: Arc<Mutex<Option<ExifTool>>>,
}

impl SharedExifToolDaemon {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    /// Ensure the ExifTool process is started, returning Ok if ready.
    pub fn ensure_started(&self, _exiftool_path: Option<&str>) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned")?;

        // Check if ExifTool is already initialized
        if guard.is_some() {
            return Ok(());
        }

        // Start a new ExifTool process
        let exiftool = ExifTool::new().map_err(|e| format!("Failed to start exiftool: {}", e))?;
        *guard = Some(exiftool);
        Ok(())
    }

    /// Read metadata from a single file as JSON string.
    pub fn read_metadata_json(&self, file_path: &str) -> Result<String, String> {
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned")?;

        match guard.as_mut() {
            Some(exiftool) => {
                let path = Path::new(file_path);
                // Read specific tags we need for scanning
                let json_value = exiftool
                    .json(
                        path,
                        &[
                            "-DateTimeOriginal",
                            "-CreateDate",
                            "-Make",
                            "-Model",
                            "-Software",
                            "-Keywords",
                            "-XPKeywords",
                        ],
                    )
                    .map_err(|e| format!("Failed to read metadata: {}", e))?;

                // Convert to JSON array format (to match existing code expectations)
                let result = serde_json::to_string(&[json_value])
                    .map_err(|e| format!("Failed to serialize: {}", e))?;
                Ok(result)
            }
            None => Err("ExifTool not started".to_string()),
        }
    }

    /// Shut down the ExifTool process if running.
    #[allow(dead_code)]
    pub fn shutdown(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned")?;
        *guard = None; // ExifTool's Drop impl will clean up the process
        Ok(())
    }
}

impl Default for SharedExifToolDaemon {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_daemon_read_metadata() {
        let shared = SharedExifToolDaemon::new();
        
        // Find exiftool in PATH for local testing
        let exiftool_path = if cfg!(target_os = "macos") && Path::new("/opt/homebrew/bin/exiftool").exists() {
            PathBuf::from("/opt/homebrew/bin/exiftool")
        } else {
            PathBuf::from("exiftool")
        };

        if shared.ensure_started(exiftool_path.to_str()).is_ok() {
            let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
            let test_file = Path::new(&manifest_dir).parent().unwrap().join("test_src").join("dated.jpg");

            if test_file.exists() {
                let json_res = shared.read_metadata_json(test_file.to_str().unwrap());
                assert!(json_res.is_ok());
                
                let json_str = json_res.unwrap();
                let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
                
                assert!(parsed.is_array());
                let arr = parsed.as_array().unwrap();
                assert!(!arr.is_empty());
                
                let metadata = &arr[0];
                assert_eq!(metadata["DateTimeOriginal"], "2024:06:15 12:00:00");
            }
            
            let _ = shared.shutdown();
        }
    }

    #[test]
    fn test_daemon_not_started() {
        let shared = SharedExifToolDaemon::new();
        let result = shared.read_metadata_json("any_file.jpg");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "ExifTool not started");
    }

    #[test]
    fn test_daemon_shutdown() {
        let shared = SharedExifToolDaemon::new();
        // Just checking it doesn't panic and resets inner
        assert!(shared.shutdown().is_ok());
    }
}
