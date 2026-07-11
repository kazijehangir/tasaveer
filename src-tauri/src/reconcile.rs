use crate::catalog::{Catalog, NewImport};
use crate::disk::check_disk_space;
use crate::organize::{compute_full_file_hash, copy_and_verify, MEDIA_EXTENSIONS};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedFile {
    pub rel_path: String,  // relative path forward-slashed, e.g. "2026-04-25/_DSC5912.JPG"
    pub file_name: String, // lowercased filename for APFS case-insensitivity
    pub size: u64,         // st_size (Logical size, zero cost for placeholder)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Classification {
    SafeToFree,
    AtRisk,
    DriveOnly,
    SdOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStatus {
    pub rel_path: String,
    pub file_name: String,
    pub size: u64,
    pub on_laptop: bool,
    pub on_drive: bool,
    pub on_sd: bool,
    pub classification: Classification,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderSummary {
    pub folder: String,
    pub laptop_count: usize,
    pub drive_count: usize,
    pub sd_count: usize,
    pub safe_to_free_count: usize,
    pub safe_to_free_bytes: u64,
    pub at_risk_count: usize,
    pub at_risk_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileReport {
    pub folders: Vec<FolderSummary>,
    pub files: Vec<FileStatus>,
    pub total_reclaimable_bytes: u64,
    pub total_at_risk_bytes: u64,
    pub laptop_root: String,
    pub drive_root: Option<String>,
    pub sd_root: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileProgress {
    pub id: String,
    pub phase: String, // "scanning_laptop" | "scanning_drive" | "scanning_sd" | "matching" | "complete"
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub backed_up_count: usize,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteResult {
    pub deleted_count: usize,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

/// Helper to extract quick hash of a file (first 64KB + size)
pub fn compute_quick_hash(path: &Path) -> Result<String, std::io::Error> {
    use sha2::{Digest, Sha256};
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();

    let mut buffer = vec![0u8; 65536];
    let bytes_read = file.read(&mut buffer)?;
    hasher.update(&buffer[..bytes_read]);

    let metadata = fs::metadata(path)?;
    hasher.update(metadata.len().to_le_bytes());

    Ok(format!("{:x}", hasher.finalize()))
}

/// Helper to get the top level folder from a relative path (e.g. "2026-04-25/_DSC.JPG" -> "2026-04-25")
fn get_top_level_folder(rel_path: &str) -> String {
    if let Some(pos) = rel_path.find('/') {
        rel_path[..pos].to_string()
    } else {
        "Root".to_string()
    }
}

/// Scan a directory tree for media files
fn scan_tree(root: &Path, is_cancelled: &Arc<AtomicBool>) -> Result<Vec<ScannedFile>, String> {
    let mut files = Vec::new();
    let walk = walkdir::WalkDir::new(root).follow_links(true);

    for entry in walk.into_iter().filter_map(|e| e.ok()) {
        if is_cancelled.load(Ordering::Relaxed) {
            return Err("Operation cancelled".to_string());
        }

        if !entry.path().is_file() {
            continue;
        }

        let path = entry.path();
        if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
            let ext_lower = ext.to_lowercase();
            if MEDIA_EXTENSIONS.contains(&ext_lower.as_str()) {
                if let Ok(rel) = path.strip_prefix(root) {
                    let rel_path = rel.to_string_lossy().replace('\\', "/");
                    let file_name = path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                    files.push(ScannedFile {
                        rel_path,
                        file_name,
                        size,
                    });
                }
            }
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn run_reconcile(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    laptop_root: String,
    drive_root: Option<String>,
    sd_root: Option<String>,
    operation_id: String,
) -> Result<ReconcileReport, String> {
    let cancel_token = state.register_token(&operation_id);
    let op_id_clone = operation_id.clone();
    let handler_clone = app_handle.clone();
    
    let result = run_reconcile_internal(
        laptop_root,
        drive_root,
        sd_root,
        |phase, current, total, current_file| {
            let _ = handler_clone.emit(
                "reconcile-progress",
                ReconcileProgress {
                    id: op_id_clone.clone(),
                    phase: phase.to_string(),
                    current,
                    total,
                    current_file: current_file.to_string(),
                },
            );
        },
        &cancel_token,
    );
    state.remove_token(&operation_id);
    result
}

pub fn run_reconcile_internal(
    laptop_root: String,
    drive_root: Option<String>,
    sd_root: Option<String>,
    mut on_progress: impl FnMut(&str, usize, usize, &str),
    cancel_token: &Arc<AtomicBool>,
) -> Result<ReconcileReport, String> {
    let mut warnings = Vec::new();

    // 1. Scan Laptop
    on_progress("scanning_laptop", 0, 100, "Scanning Laptop...");
    let laptop_path = Path::new(&laptop_root);
    if !laptop_path.exists() {
        return Err(format!("Laptop root path does not exist: {}", laptop_root));
    }
    let laptop_files = scan_tree(laptop_path, cancel_token)?;

    // 2. Scan Drive
    on_progress("scanning_drive", 0, 100, "Scanning Google Drive...");
    let mut drive_files = Vec::new();
    if let Some(ref dr) = drive_root {
        let drive_path = Path::new(dr);
        if drive_path.exists() {
            drive_files = scan_tree(drive_path, cancel_token)?;
        } else {
            warnings.push(format!("Google Drive path does not exist: {}", dr));
        }
    } else {
        warnings.push("Google Drive root path not configured".to_string());
    }

    // 3. Scan SD Card
    on_progress("scanning_sd", 0, 100, "Scanning SD Card...");
    let mut sd_files = Vec::new();
    if let Some(ref sr) = sd_root {
        let sd_path = Path::new(sr);
        if sd_path.exists() {
            sd_files = scan_tree(sd_path, cancel_token)?;
        }
    }

    // 4. Matching & Classification
    on_progress("matching", 0, 100, "Matching files...");

    // Build lookups
    let drive_set: HashSet<(String, u64)> = drive_files
        .iter()
        .map(|f| (f.rel_path.to_lowercase(), f.size))
        .collect();

    let sd_set: HashSet<(String, u64)> = sd_files
        .iter()
        .map(|f| (f.file_name.clone(), f.size))
        .collect();

    // Track matched sets to find "DriveOnly" and "SdOnly" files
    let mut matched_drive_keys = HashSet::new();
    let mut matched_sd_keys = HashSet::new();

    let mut files = Vec::new();
    let mut folder_summaries: HashMap<String, FolderSummary> = HashMap::new();
    let mut total_reclaimable_bytes = 0;
    let mut total_at_risk_bytes = 0;

    // Process laptop files
    for f in laptop_files {
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Operation cancelled".to_string());
        }

        let on_drive = drive_set.contains(&(f.rel_path.to_lowercase(), f.size));
        let on_sd = sd_set.contains(&(f.file_name.clone(), f.size));

        if on_drive {
            matched_drive_keys.insert((f.rel_path.to_lowercase(), f.size));
        }
        if on_sd {
            matched_sd_keys.insert((f.file_name.clone(), f.size));
        }

        // Rule change: SafeToFree strictly requires on_drive. SD presence is secondary/informational.
        let classification = if on_drive {
            Classification::SafeToFree
        } else {
            Classification::AtRisk
        };

        if classification == Classification::SafeToFree {
            total_reclaimable_bytes += f.size;
        } else {
            total_at_risk_bytes += f.size;
        }

        let folder = get_top_level_folder(&f.rel_path);
        let summary = folder_summaries.entry(folder.clone()).or_insert_with(|| FolderSummary {
            folder,
            laptop_count: 0,
            drive_count: 0,
            sd_count: 0,
            safe_to_free_count: 0,
            safe_to_free_bytes: 0,
            at_risk_count: 0,
            at_risk_bytes: 0,
        });

        summary.laptop_count += 1;
        if on_drive {
            summary.drive_count += 1;
            summary.safe_to_free_count += 1;
            summary.safe_to_free_bytes += f.size;
        } else {
            summary.at_risk_count += 1;
            summary.at_risk_bytes += f.size;
        }
        if on_sd {
            summary.sd_count += 1;
        }

        files.push(FileStatus {
            rel_path: f.rel_path,
            file_name: f.file_name,
            size: f.size,
            on_laptop: true,
            on_drive,
            on_sd,
            classification,
        });
    }

    // Process DriveOnly files
    for f in &drive_files {
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Operation cancelled".to_string());
        }

        let key = (f.rel_path.to_lowercase(), f.size);
        if !matched_drive_keys.contains(&key) {
            let folder = get_top_level_folder(&f.rel_path);
            let summary = folder_summaries.entry(folder.clone()).or_insert_with(|| FolderSummary {
                folder,
                laptop_count: 0,
                drive_count: 0,
                sd_count: 0,
                safe_to_free_count: 0,
                safe_to_free_bytes: 0,
                at_risk_count: 0,
                at_risk_bytes: 0,
            });
            summary.drive_count += 1;

            files.push(FileStatus {
                rel_path: f.rel_path.clone(),
                file_name: f.file_name.clone(),
                size: f.size,
                on_laptop: false,
                on_drive: true,
                on_sd: false,
                classification: Classification::DriveOnly,
            });
        }
    }

    // Process SdOnly files
    let drive_names_sizes: HashSet<(String, u64)> = drive_files
        .iter()
        .map(|f| (f.file_name.clone(), f.size))
        .collect();

    for f in &sd_files {
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Operation cancelled".to_string());
        }

        let key = (f.file_name.clone(), f.size);
        if !matched_sd_keys.contains(&key) {
            // Also check if it exists on drive (by name/size since paths differ)
            let on_drive = drive_names_sizes.contains(&key);
            if !on_drive {
                files.push(FileStatus {
                    rel_path: f.rel_path.clone(),
                    file_name: f.file_name.clone(),
                    size: f.size,
                    on_laptop: false,
                    on_drive: false,
                    on_sd: true,
                    classification: Classification::SdOnly,
                });
            }
        }
    }

    let mut folders: Vec<FolderSummary> = folder_summaries.into_values().collect();
    folders.sort_by(|a, b| a.folder.cmp(&b.folder));

    on_progress("complete", 100, 100, "Scan Complete");

    Ok(ReconcileReport {
        folders,
        files,
        total_reclaimable_bytes,
        total_at_risk_bytes,
        laptop_root: laptop_root,
        drive_root,
        sd_root,
        warnings,
    })
}

#[tauri::command]
pub async fn backup_at_risk(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    laptop_root: String,
    drive_root: String,
    rel_paths: Vec<String>,
    operation_id: String,
) -> Result<BackupResult, String> {
    let cancel_token = state.register_token(&operation_id);
    let op_id_clone = operation_id.clone();
    let handler_clone = app_handle.clone();
    
    let catalog = match Catalog::open(&app_handle) {
        Ok(cat) => Some(cat),
        Err(e) => {
            eprintln!("Failed to open catalog (continuing): {}", e);
            None
        }
    };

    let result = backup_at_risk_internal(
        catalog.as_ref(),
        &laptop_root,
        &drive_root,
        &rel_paths,
        |current, total, current_file| {
            let _ = handler_clone.emit(
                "reconcile-progress",
                ReconcileProgress {
                    id: op_id_clone.clone(),
                    phase: "backing_up".to_string(),
                    current,
                    total,
                    current_file: current_file.to_string(),
                },
            );
        },
        &cancel_token,
    );
    state.remove_token(&operation_id);
    result
}

pub fn backup_at_risk_internal(
    catalog: Option<&Catalog>,
    laptop_root: &str,
    drive_root: &str,
    rel_paths: &[String],
    mut on_progress: impl FnMut(usize, usize, &str),
    cancel_token: &Arc<AtomicBool>,
) -> Result<BackupResult, String> {
    let mut backed_up_count = 0;
    let mut skipped = Vec::new();
    let mut errors = Vec::new();

    let laptop_path = Path::new(laptop_root);
    let drive_path = Path::new(drive_root);

    if !drive_path.exists() {
        return Err(format!("Drive root path does not exist: {}", drive_root));
    }

    let total = rel_paths.len();
    for (i, rel_path) in rel_paths.iter().enumerate() {
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Operation cancelled".to_string());
        }

        on_progress(i, total, rel_path);

        // Low disk space guard check before each copy
        if let Err(e) = check_disk_space(drive_path, 5 * 1024 * 1024 * 1024) {
            return Err(format!("Disk space abort during backup: {}", e));
        }

        let src = laptop_path.join(rel_path);
        let dst = drive_path.join(rel_path);

        if !src.exists() {
            skipped.push(format!("Source missing: {}", rel_path));
            continue;
        }

        // Create parent folders if missing
        if let Some(parent) = dst.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                errors.push(format!("Failed to create folder {:?}: {}", parent, e));
                continue;
            }
        }

        // Perform streaming verified copy
        match copy_and_verify(&src, &dst) {
            Ok(hash) => {
                backed_up_count += 1;
                // If catalog is open, mark backup as done
                if let Some(cat) = catalog {
                    let size = fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
                    let q_hash = compute_quick_hash(&src).unwrap_or_default();
                    if let Ok(Some(existing)) = cat.find_by_quick_hash(&q_hash, size) {
                        let _ = cat.mark_backup(existing.id, "done", Some(&dst.to_string_lossy().to_string()));
                    } else {
                        // Record new import as done
                        let file_name = src.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                        let new_import = NewImport {
                            session_id: format!("reconcile-backup-backfill"),
                            quick_hash: q_hash,
                            full_hash: Some(hash),
                            file_size: size,
                            original_name: file_name,
                            source_path: None,
                            local_path: rel_path.clone(),
                            date_taken: None,
                            camera_model: None,
                            imported_at: chrono::Local::now().to_rfc3339(),
                            backup_status: "done".to_string(),
                        };
                        if let Ok(id) = cat.record_import(&new_import) {
                            let _ = cat.mark_backup(id, "done", Some(&dst.to_string_lossy().to_string()));
                        }
                    }
                }
            }
            Err(e) => {
                errors.push(format!("Failed to back up {}: {}", rel_path, e));
            }
        }
    }

    Ok(BackupResult {
        backed_up_count,
        skipped,
        errors,
    })
}

#[tauri::command]
pub async fn free_local_space(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    laptop_root: String,
    drive_root: Option<String>,
    sd_root: Option<String>,
    files: Vec<String>,
    operation_id: String,
) -> Result<DeleteResult, String> {
    let cancel_token = state.register_token(&operation_id);
    let op_id_clone = operation_id.clone();
    let handler_clone = app_handle.clone();
    
    let catalog = match Catalog::open(&app_handle) {
        Ok(cat) => Some(cat),
        Err(e) => {
            eprintln!("Failed to open catalog (continuing): {}", e);
            None
        }
    };

    let result = free_local_space_internal(
        catalog.as_ref(),
        &laptop_root,
        &drive_root,
        &sd_root,
        &files,
        |current, total, current_file| {
            let _ = handler_clone.emit(
                "reconcile-progress",
                ReconcileProgress {
                    id: op_id_clone.clone(),
                    phase: "deleting".to_string(),
                    current,
                    total,
                    current_file: current_file.to_string(),
                },
            );
        },
        &cancel_token,
    );
    state.remove_token(&operation_id);
    result
}

pub fn free_local_space_internal(
    catalog: Option<&Catalog>,
    laptop_root: &str,
    drive_root: &Option<String>,
    _sd_root: &Option<String>,
    files: &[String],
    mut on_progress: impl FnMut(usize, usize, &str),
    cancel_token: &Arc<AtomicBool>,
) -> Result<DeleteResult, String> {
    let mut deleted_count = 0;
    let mut skipped = Vec::new();
    let mut errors = Vec::new();

    let laptop_path = Path::new(laptop_root);
    let drive_path = drive_root.as_ref().map(|r| Path::new(r));

    let total = files.len();
    for (i, rel_path) in files.iter().enumerate() {
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Operation cancelled".to_string());
        }

        on_progress(i, total, rel_path);

        let src = laptop_path.join(rel_path);
        if !src.exists() {
            skipped.push(format!("Laptop file missing: {}", rel_path));
            continue;
        }

        let size = fs::metadata(&src).map(|m| m.len()).unwrap_or(0);

        // 1. RE-VERIFY: Ensure file exists on Drive mount with identical size
        let is_on_drive = if let Some(dp) = drive_path {
            let dst = dp.join(rel_path);
            dst.exists() && fs::metadata(&dst).map(|m| m.len()).unwrap_or(0) == size
        } else {
            false
        };

        if !is_on_drive {
            skipped.push(format!("Not verified on Drive: {}", rel_path));
            continue;
        }

        // 2. Compute hashes for catalog updates before deletion
        let q_hash = compute_quick_hash(&src).unwrap_or_default();
        let f_hash = compute_full_file_hash(&src).unwrap_or_default();
        let dst_str = drive_path.map(|dp| dp.join(rel_path).to_string_lossy().to_string());

        // 3. Move file to Trash
        match trash::delete(&src) {
            Ok(_) => {
                deleted_count += 1;

                // 4. Seeding/Updating Catalog
                if let Some(cat) = catalog {
                    if let Ok(Some(existing)) = cat.find_by_quick_hash(&q_hash, size) {
                        let _ = cat.mark_backup(existing.id, "done", dst_str.as_deref());
                    } else {
                        let file_name = src.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                        let new_import = NewImport {
                            session_id: format!("reconcile-delete-backfill"),
                            quick_hash: q_hash,
                            full_hash: Some(f_hash),
                            file_size: size,
                            original_name: file_name,
                            source_path: None,
                            local_path: rel_path.clone(),
                            date_taken: None,
                            camera_model: None,
                            imported_at: chrono::Local::now().to_rfc3339(),
                            backup_status: "done".to_string(),
                        };
                        if let Ok(id) = cat.record_import(&new_import) {
                            let _ = cat.mark_backup(id, "done", dst_str.as_deref());
                        }
                    }
                }
            }
            Err(e) => {
                errors.push(format!("Failed to delete {}: {}", rel_path, e));
            }
        }
    }

    Ok(DeleteResult {
        deleted_count,
        skipped,
        errors,
    })
}

#[tauri::command]
pub async fn deep_verify_folder(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    laptop_root: String,
    drive_root: String,
    folder: String,
    operation_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let cancel_token = state.register_token(&operation_id);
    let op_id_clone = operation_id.clone();
    let handler_clone = app_handle.clone();

    let result = deep_verify_folder_internal(
        &laptop_root,
        &drive_root,
        &folder,
        |current, total, current_file| {
            let _ = handler_clone.emit(
                "reconcile-progress",
                ReconcileProgress {
                    id: op_id_clone.clone(),
                    phase: "deep_verifying".to_string(),
                    current,
                    total,
                    current_file: current_file.to_string(),
                },
            );
        },
        &cancel_token,
    );
    state.remove_token(&operation_id);
    result
}

pub fn deep_verify_folder_internal(
    laptop_root: &str,
    drive_root: &str,
    folder: &str,
    mut on_progress: impl FnMut(usize, usize, &str),
    cancel_token: &Arc<AtomicBool>,
) -> Result<Vec<serde_json::Value>, String> {
    let mut results = Vec::new();
    let laptop_path = Path::new(laptop_root);
    let drive_path = Path::new(drive_root);

    let laptop_folder_path = laptop_path.join(folder);
    if !laptop_folder_path.exists() {
        return Err(format!("Laptop folder does not exist: {:?}", laptop_folder_path));
    }

    // 1. Scan laptop folder files
    let scan_cancelled = Arc::new(AtomicBool::new(false));
    let laptop_files = scan_tree(&laptop_folder_path, &scan_cancelled)?;
    let total = laptop_files.len();

    for (i, f) in laptop_files.iter().enumerate() {
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Operation cancelled".to_string());
        }

        // Full rel_path: folder + / + f.rel_path
        let rel_path = format!("{}/{}", folder, f.rel_path);

        on_progress(i, total, &rel_path);

        // Enforce 5 GB check prior to download (though verify itself only reads and discards, OS cache space is used)
        if let Err(e) = check_disk_space(drive_path, 5 * 1024 * 1024 * 1024) {
            return Err(format!("Disk space abort during deep verify: {}", e));
        }

        let src = laptop_path.join(&rel_path);
        let dst = drive_path.join(&rel_path);

        if !dst.exists() {
            results.push(serde_json::json!({
                "rel_path": rel_path,
                "verified": false,
                "reason": "Missing on Google Drive"
            }));
            continue;
        }

        // Compute full hashes (this downloads the Drive placeholder file!)
        let src_hash = match compute_full_file_hash(&src) {
            Ok(h) => h,
            Err(e) => {
                results.push(serde_json::json!({
                    "rel_path": rel_path,
                    "verified": false,
                    "reason": format!("Failed to read laptop file: {}", e)
                }));
                continue;
            }
        };

        let dst_hash = match compute_full_file_hash(&dst) {
            Ok(h) => h,
            Err(e) => {
                results.push(serde_json::json!({
                    "rel_path": rel_path,
                    "verified": false,
                    "reason": format!("Failed to read Google Drive file: {}", e)
                }));
                continue;
            }
        };

        if src_hash == dst_hash {
            results.push(serde_json::json!({
                "rel_path": rel_path,
                "verified": true,
                "reason": "Hashes match exactly"
            }));
        } else {
            results.push(serde_json::json!({
                "rel_path": rel_path,
                "verified": false,
                "reason": "Content hash mismatch"
            }));
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn seed_catalog_from_reconcile(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    laptop_root: String,
    drive_root: String,
    operation_id: String,
) -> Result<usize, String> {
    let cancel_token = state.register_token(&operation_id);
    let op_id_clone = operation_id.clone();
    let handler_clone = app_handle.clone();
    
    let catalog = Catalog::open(&app_handle)?;
    
    let result = seed_catalog_internal(
        &catalog,
        &laptop_root,
        &drive_root,
        |current, total, current_file| {
            let _ = handler_clone.emit(
                "reconcile-progress",
                ReconcileProgress {
                    id: op_id_clone.clone(),
                    phase: "seeding".to_string(),
                    current,
                    total,
                    current_file: current_file.to_string(),
                },
            );
        },
        &cancel_token,
    );
    state.remove_token(&operation_id);
    result
}

pub fn seed_catalog_internal(
    catalog: &Catalog,
    laptop_root: &str,
    drive_root: &str,
    mut on_progress: impl FnMut(usize, usize, &str),
    cancel_token: &Arc<AtomicBool>,
) -> Result<usize, String> {
    let laptop_path = Path::new(laptop_root);
    let drive_path = Path::new(drive_root);

    if !laptop_path.exists() {
        return Err(format!("Laptop root does not exist: {}", laptop_root));
    }

    let laptop_files = scan_tree(laptop_path, cancel_token)?;
    let total = laptop_files.len();

    let mut drive_files_set = HashSet::new();
    if drive_path.exists() {
        let drive_files = scan_tree(drive_path, cancel_token)?;
        for f in drive_files {
            drive_files_set.insert((f.rel_path.to_lowercase(), f.size));
        }
    }

    let mut seeded = 0;
    for (i, f) in laptop_files.iter().enumerate() {
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Operation cancelled".to_string());
        }

        on_progress(i, total, &f.rel_path);

        let file_path = laptop_path.join(&f.rel_path);
        let q_hash = compute_quick_hash(&file_path).unwrap_or_default();

        if let Ok(Some(_)) = catalog.find_by_quick_hash(&q_hash, f.size) {
            // Already cataloged, skip seeding
            continue;
        }

        let on_drive = drive_files_set.contains(&(f.rel_path.to_lowercase(), f.size));
        let backup_status = if on_drive {
            "done".to_string()
        } else {
            "pending".to_string()
        };

        let f_hash = compute_full_file_hash(&file_path).unwrap_or_default();
        let drive_file_str = if on_drive {
            Some(drive_path.join(&f.rel_path).to_string_lossy().to_string())
        } else {
            None
        };

        let new_import = NewImport {
            session_id: format!("backfill-reconcile"),
            quick_hash: q_hash,
            full_hash: Some(f_hash),
            file_size: f.size,
            original_name: file_path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
            source_path: None,
            local_path: f.rel_path.clone(),
            date_taken: None,
            camera_model: None,
            imported_at: chrono::Local::now().to_rfc3339(),
            backup_status,
        };

        if let Ok(id) = catalog.record_import(&new_import) {
            seeded += 1;
            if on_drive {
                let _ = catalog.mark_backup(id, "done", drive_file_str.as_deref());
            }
        }
    }

    Ok(seeded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::path::PathBuf;

    fn write_test_file(dir: &Path, rel_path: &str, content: &str) -> PathBuf {
        let path = dir.join(rel_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn test_scan_tree() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        write_test_file(path, "2026-04-25/_DSC5912.JPG", "content1");
        write_test_file(path, "2026-04-25/text.txt", "content2"); // Not media

        let is_cancelled = Arc::new(AtomicBool::new(false));
        let files = scan_tree(path, &is_cancelled).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].rel_path, "2026-04-25/_DSC5912.JPG");
        assert_eq!(files[0].file_name, "_dsc5912.jpg");
        assert_eq!(files[0].size, 8);
    }

    #[test]
    fn test_reconcile_classification() {
        let laptop_dir = tempdir().unwrap();
        let drive_dir = tempdir().unwrap();
        let sd_dir = tempdir().unwrap();

        // 1. SafeToFree: on laptop and drive
        write_test_file(laptop_dir.path(), "2026-04-25/safe.jpg", "same_content");
        write_test_file(drive_dir.path(), "2026-04-25/safe.jpg", "same_content");

        // 2. AtRisk (only on laptop)
        write_test_file(laptop_dir.path(), "2026-04-25/at_risk.jpg", "some_content");

        // 3. NotSafeToFree (on laptop and SD, but not on drive)
        write_test_file(laptop_dir.path(), "2026-05-22/only_sd.jpg", "content");
        write_test_file(sd_dir.path(), "DCIM/100NIKON/only_sd.jpg", "content");

        // 4. DriveOnly
        write_test_file(drive_dir.path(), "2026-04-25/drive_only.jpg", "content");

        // 5. SdOnly
        write_test_file(sd_dir.path(), "DCIM/100NIKON/sd_only.jpg", "content");

        let cancel_token = Arc::new(AtomicBool::new(false));
        let report = run_reconcile_internal(
            laptop_dir.path().to_string_lossy().to_string(),
            Some(drive_dir.path().to_string_lossy().to_string()),
            Some(sd_dir.path().to_string_lossy().to_string()),
            |_, _, _, _| {},
            &cancel_token,
        )
        .unwrap();

        // Check classification
        let safe = report.files.iter().find(|f| f.rel_path == "2026-04-25/safe.jpg").unwrap();
        assert_eq!(safe.classification, Classification::SafeToFree);

        let at_risk = report.files.iter().find(|f| f.rel_path == "2026-04-25/at_risk.jpg").unwrap();
        assert_eq!(at_risk.classification, Classification::AtRisk);

        let only_sd = report.files.iter().find(|f| f.rel_path == "2026-05-22/only_sd.jpg").unwrap();
        // Transient SD card presence does not make it SafeToFree
        assert_eq!(only_sd.classification, Classification::AtRisk);

        let drive_only = report.files.iter().find(|f| f.rel_path == "2026-04-25/drive_only.jpg").unwrap();
        assert_eq!(drive_only.classification, Classification::DriveOnly);

        let sd_only = report.files.iter().find(|f| f.file_name == "sd_only.jpg").unwrap();
        assert_eq!(sd_only.classification, Classification::SdOnly);
    }

    #[test]
    fn test_free_local_space_reverifies() {
        let laptop_dir = tempdir().unwrap();
        let drive_dir = tempdir().unwrap();

        let laptop_path = laptop_dir.path();
        let drive_path = drive_dir.path();

        write_test_file(laptop_path, "2026-04-25/test.jpg", "content");
        // Pretend it was on Drive during scan, but now deleted from Drive
        
        let cancel_token = Arc::new(AtomicBool::new(false));
        let result = free_local_space_internal(
            None,
            &laptop_path.to_string_lossy(),
            &Some(drive_path.to_string_lossy().to_string()),
            &None,
            &["2026-04-25/test.jpg".to_string()],
            |_, _, _| {},
            &cancel_token,
        )
        .unwrap();

        assert_eq!(result.deleted_count, 0);
        assert_eq!(result.skipped.len(), 1);
        assert!(result.skipped[0].contains("Not verified on Drive"));
        assert!(laptop_path.join("2026-04-25/test.jpg").exists());
    }

    #[test]
    fn test_backup_at_risk() {
        let laptop_dir = tempdir().unwrap();
        let drive_dir = tempdir().unwrap();

        let laptop_path = laptop_dir.path();
        let drive_path = drive_dir.path();

        write_test_file(laptop_path, "2026-04-25/at_risk.jpg", "content");

        let cancel_token = Arc::new(AtomicBool::new(false));
        let result = backup_at_risk_internal(
            None,
            &laptop_path.to_string_lossy(),
            &drive_path.to_string_lossy(),
            &["2026-04-25/at_risk.jpg".to_string()],
            |_, _, _| {},
            &cancel_token,
        )
        .unwrap();

        assert_eq!(result.backed_up_count, 1);
        assert!(drive_path.join("2026-04-25/at_risk.jpg").exists());
    }
}
