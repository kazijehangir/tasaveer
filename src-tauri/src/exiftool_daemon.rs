//! ExifTool wrapper for high-performance batch metadata operations.
//!
//! Uses the `exiftool` crate which maintains a long-running ExifTool process
//! in stay-open mode for efficiency when processing multiple files.

use exiftool::ExifTool;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Thread-safe wrapper around ExifTool for use in async contexts.
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

    #[test]
    fn test_shared_daemon() {
        let shared = SharedExifToolDaemon::new();

        // Should fail before starting
        assert!(shared.read_metadata_json("/nonexistent").is_err());

        // Try to start (may fail if exiftool not installed)
        if shared.ensure_started(None).is_ok() {
            // Shutdown
            assert!(shared.shutdown().is_ok());
        }
    }
}
