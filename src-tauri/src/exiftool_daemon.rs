//! ExifTool wrapper for high-performance batch metadata operations.
//!
//! Replaces the external crate to allow manual control of the process,
//! supporting custom binary paths and bundled executables.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

/// Low-level wrapper around the ExifTool process.
struct ExifToolDaemon {
    child: Child,
    reader: BufReader<std::process::ChildStdout>,
}

impl ExifToolDaemon {
    /// Start a new ExifTool process in stay_open mode.
    fn new(exiftool_path: &str) -> Result<Self, String> {
        let mut child = Command::new(exiftool_path)
            .args([
                "-stay_open",
                "True",
                "-@",
                "-",
                "-common_args",
                "-n",     // Machine readable values
                "-json",  // Output as JSON
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to spawn exiftool at '{}': {}", exiftool_path, e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let reader = BufReader::new(stdout);

        Ok(Self { child, reader })
    }

    /// Execute a command (e.g., a filename) and read the JSON response.
    fn execute(&mut self, args: &[&str]) -> Result<String, String> {
        let stdin = self.child.stdin.as_mut().ok_or("No stdin captured")?;

        // Write arguments to stdin
        for arg in args {
            writeln!(stdin, "{}", arg).map_err(|e| format!("Write error: {}", e))?;
        }
        writeln!(stdin, "-execute").map_err(|e| format!("Write error: {}", e))?;

        // Read output until "{ready}"
        let mut output = String::new();
        let mut line = String::new();

        loop {
            line.clear();
            let bytes = self.reader.read_line(&mut line).map_err(|e| format!("Read error: {}", e))?;
            if bytes == 0 {
                return Err("ExifTool process closed unexpectedly".to_string());
            }

            if line.trim() == "{ready}" {
                break;
            }

            output.push_str(&line);
        }

        Ok(output)
    }
}

impl Drop for ExifToolDaemon {
    fn drop(&mut self) {
        // Try to close nicely
        if let Some(mut stdin) = self.child.stdin.take() {
            let _ = writeln!(stdin, "-stay_open\nFalse");
        }
        // Wait a bit or kill
        let _ = self.child.wait();
    }
}

/// Thread-safe wrapper around ExifTool for use in async contexts.
#[derive(Clone)]
pub struct SharedExifToolDaemon {
    inner: Arc<Mutex<Option<ExifToolDaemon>>>,
}

impl SharedExifToolDaemon {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    /// Ensure the ExifTool process is started, returning Ok if ready.
    pub fn ensure_started(&self, exiftool_path: Option<&str>) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned")?;

        // Check if ExifTool is already initialized
        if guard.is_some() {
            return Ok(());
        }

        let path = exiftool_path.unwrap_or("exiftool");

        // Start a new ExifTool process
        let daemon = ExifToolDaemon::new(path)?;
        *guard = Some(daemon);
        Ok(())
    }

    /// Read metadata from a single file as JSON string.
    pub fn read_metadata_json(&self, file_path: &str) -> Result<String, String> {
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned")?;

        match guard.as_mut() {
            Some(daemon) => {
                let args = &[
                    "-DateTimeOriginal",
                    "-CreateDate",
                    "-Make",
                    "-Model",
                    "-Software",
                    "-Keywords",
                    "-XPKeywords",
                    "-Subject",
                    file_path
                ];

                let result = daemon.execute(args)?;
                Ok(result)
            }
            None => Err("ExifTool not started".to_string()),
        }
    }

    /// Shut down the ExifTool process if running.
    #[allow(dead_code)]
    pub fn shutdown(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned")?;
        *guard = None; // ExifToolDaemon's Drop impl will clean up the process
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
            let test_file = Path::new(&manifest_dir).parent().unwrap().join("test_src").join("test_keywords.jpg");

            // Only run if test file exists (might need adjustments depending on where tests run)
            if test_file.exists() {
                let json_res = shared.read_metadata_json(test_file.to_str().unwrap());
                assert!(json_res.is_ok());
                
                let json_str = json_res.unwrap();
                let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
                
                assert!(parsed.is_array());
                let arr = parsed.as_array().unwrap();
                assert!(!arr.is_empty());
                
                let metadata = &arr[0];
                // Check if DateTimeOriginal is present
                assert!(metadata.get("DateTimeOriginal").is_some());
            }
            
            let _ = shared.shutdown();
        } else {
            println!("Skipping test: exiftool not found");
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
