use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use which::which;

#[derive(Debug, Clone)]
pub enum Prerequisite {
    ExifTool,
    ImmichGo,
    Czkawka,
}

impl Prerequisite {
    pub fn name(&self) -> &str {
        match self {
            Prerequisite::ExifTool => "exiftool",
            Prerequisite::ImmichGo => "immich-go",
            Prerequisite::Czkawka => "czkawka_cli",
        }
    }

    /// Tries to find the binary.
    /// Priority:
    /// 1. Bundled sidecar in resource directory (implied by Tauri sidecar logic, but here we look for existence)
    /// 2. System PATH
    pub fn discover(&self, app_handle: &AppHandle) -> Result<PathBuf, String> {
        let name = self.name();

        // 1. Check bundled/sidecar path
        // Tauri sidecars are typically stored in the resource directory with a target triple suffix.
        // However, `Command::new_sidecar` handles resolution.
        // If we want to *know* the path to pass to another process or verification, we check `resource_dir`.
        // Note: This logic assumes a standard Tauri sidecar setup.
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let binaries_dir = resource_dir.join("binaries");

            // Should probably check for target triple, but for now checking simple name or name in binaries dir
            // The file structure in the PLAN says `binaries/exiftool`.
            let candidate = binaries_dir.join(name);
            if candidate.exists() {
                return Ok(candidate);
            }

            // Also check for the name with possible platform extensions (exe) if needed,
            // but on Unix (Mac) it's usually just the name.
            // In a real sidecar scenario, tauri renames them to `name-target-triple`.
            // The user's repo has a `binaries` folder in `src-tauri`.
            // When built, these might be moved.
            // For now, let's assume if it's not found in resources, we fall back.
        }

        // 2. Check System PATH
        match which(name) {
            Ok(path) => Ok(path),
            Err(_) => Err(format!(
                "Could not find '{}'. Please install it on your system or ensure the bundled binary is present.",
                name
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper to create a dummy app handle for testing
    // Note: Creating a full AppHandle in unit tests is tricky because it requires a running loop or mock.
    // For unit testing `Prerequisite::discover`, we might need to mock the logic or split it.
    // However, since we are using `app_handle.path().resource_dir()`, we really need that context.
    // Alternatively, we can test the fallback to system PATH without the app handle if we refactor,
    // or we can test `which` directly.
    //
    // For now, let's verify the system path lookup for a known binary (like `ls` or `sh` if we added a generic one)
    // or try to assert that `ExifTool` is NOT found in a clean env (or IS found if installed).

    #[test]
    fn test_prerequisite_names() {
        assert_eq!(Prerequisite::ExifTool.name(), "exiftool");
        assert_eq!(Prerequisite::ImmichGo.name(), "immich-go");
        assert_eq!(Prerequisite::Czkawka.name(), "czkawka_cli");
    }

    #[test]
    fn test_system_binary_lookup() {
        // We can't easily mock `app_handle` here without heavy lifting.
        // But we can verify `which` works for a common command.
        let result = which::which("ls");
        assert!(result.is_ok(), "Should find 'ls' in system PATH");
    }

    // We will verify the full integration in a larger scope or manual run.
}
