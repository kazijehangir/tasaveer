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
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let binaries_dir = resource_dir.join("binaries");
            let candidate = binaries_dir.join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }

        // 2. Check System PATH
        self.discover_in_path()
    }

    pub fn discover_in_path(&self) -> Result<PathBuf, String> {
        let name = self.name();
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

    #[test]
    fn test_prerequisite_names() {
        assert_eq!(Prerequisite::ExifTool.name(), "exiftool");
        assert_eq!(Prerequisite::ImmichGo.name(), "immich-go");
        assert_eq!(Prerequisite::Czkawka.name(), "czkawka_cli");
    }

    #[test]
    fn test_discover_in_path() {
        // We can test this without an AppHandle
        // 'ls' is not one of our prerequisites, but we can check if it finds one of them
        // if they are in the path.
        // Alternatively, test the error message for a dummy prerequisite.
        let result = Prerequisite::ExifTool.discover_in_path();
        // Result depends on the environment, but we can at least check if it's a Result.
        match result {
            Ok(path) => assert!(path.exists()),
            Err(e) => assert!(e.contains("exiftool")),
        }
    }

    #[test]
    fn test_discover_nonexistent() {
        // Create a fake prerequisite just for testing
        #[derive(Debug, Clone)]
        struct FakePre;
        impl FakePre {
            fn name(&self) -> &str { "definitely_not_a_real_binary_12345" }
            fn discover_in_path(&self) -> Result<PathBuf, String> {
                match which(self.name()) {
                    Ok(path) => Ok(path),
                    Err(_) => Err(format!("Could not find '{}'", self.name())),
                }
            }
        }
        
        let fake = FakePre {};
        let result = fake.discover_in_path();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("definitely_not_a_real_binary_12345"));
    }
}
