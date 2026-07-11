use std::path::{Path, PathBuf};

/// Find the nearest ancestor of a path that actually exists on disk.
/// This prevents queries from failing if a new import directory has not been created yet.
pub fn find_existing_ancestor(path: &Path) -> PathBuf {
    let mut current = path.to_path_buf();
    while !current.exists() {
        if let Some(parent) = current.parent() {
            current = parent.to_path_buf();
        } else {
            break;
        }
    }
    current
}

/// Query the available storage bytes on the disk/volume containing the target path.
/// Works cross-platform on macOS/Unix and Windows.
pub fn get_available_space(path: &Path) -> Result<u64, String> {
    let existing_path = find_existing_ancestor(path);
    get_available_space_internal(&existing_path)
}

#[cfg(unix)]
fn get_available_space_internal(path: &Path) -> Result<u64, String> {
    let output = std::process::Command::new("df")
        .arg("-k")
        .arg(path)
        .output()
        .map_err(|e| format!("Failed to run df command: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("df command failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().collect();
    if lines.len() < 2 {
        return Err("Unexpected df output format: too few lines".to_string());
    }

    // Typical df output:
    // Filesystem     1024-blocks      Used Available Capacity iused    ifree %iused  Mounted on
    // /dev/disk3s1s1   482746452  13186488   7804652    63%  458725 78046520    1%   /
    let fields: Vec<&str> = lines[1].split_whitespace().collect();
    if fields.len() < 4 {
        return Err(format!(
            "Unexpected df output format: too few fields in line: {}",
            lines[1]
        ));
    }

    // Index 3 is "Available" (in 1024-byte blocks)
    let available_kb = fields[3]
        .parse::<u64>()
        .map_err(|e| format!("Failed to parse available disk space: {}", e))?;

    Ok(available_kb * 1024)
}

#[cfg(windows)]
extern "system" {
    fn GetDiskFreeSpaceExW(
        lpDirectoryName: *const u16,
        lpFreeBytesAvailableToCaller: *mut u64,
        lpTotalNumberOfBytes: *mut u64,
        lpTotalNumberOfFreeBytes: *mut u64,
    ) -> i32;
}

#[cfg(windows)]
fn get_available_space_internal(path: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;

    let path_wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut free_bytes: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut total_free_bytes: u64 = 0;

    let success = unsafe {
        GetDiskFreeSpaceExW(
            path_wide.as_ptr(),
            &mut free_bytes,
            &mut total_bytes,
            &mut total_free_bytes,
        )
    };

    if success == 0 {
        let err = std::io::Error::last_os_error();
        return Err(format!("GetDiskFreeSpaceExW failed: {}", err));
    }

    Ok(free_bytes)
}

/// Enforce that a path has a minimum amount of free space.
/// Returns Ok(()) if free space is >= min_free_bytes, or Err with a descriptive message otherwise.
pub fn check_disk_space(path: &Path, min_free_bytes: u64) -> Result<(), String> {
    let free_space = get_available_space(path)?;
    if free_space < min_free_bytes {
        let free_gb = free_space as f64 / 1_073_741_824.0;
        let required_gb = min_free_bytes as f64 / 1_073_741_824.0;
        return Err(format!(
            "Insufficient disk space on volume for {:?}. Free space: {:.2} GB, required minimum: {:.2} GB",
            path, free_gb, required_gb
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_find_existing_ancestor() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nonexistent_sub1").join("nonexistent_sub2");
        let ancestor = find_existing_ancestor(&path);
        assert_eq!(ancestor, dir.path());
        assert!(ancestor.exists());
    }

    #[test]
    fn test_get_available_space() {
        let dir = tempdir().unwrap();
        let free_space = get_available_space(dir.path());
        assert!(free_space.is_ok());
        assert!(free_space.unwrap() > 0);
    }

    #[test]
    fn test_check_disk_space_success() {
        let dir = tempdir().unwrap();
        // Requesting 1 byte should always succeed on a working filesystem.
        let result = check_disk_space(dir.path(), 1);
        assert!(result.is_ok());
    }

    #[test]
    fn test_check_disk_space_failure() {
        let dir = tempdir().unwrap();
        // Requesting 1000 TB should always fail.
        let result = check_disk_space(dir.path(), 1_000_000_000_000_000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insufficient disk space"));
    }
}
