import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import {
  HardDrive,
  FolderOpen,
  RefreshCw,
  AlertTriangle,
  Trash2,
  CheckCircle2,
  Database,
  Eye,
  Loader2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Scale
} from "lucide-react";
import {
  useReconcileStore,
  ensureReconcileListeners,
  ReconcileReport
} from "../store/reconcileStore";

export function Reconcile() {
  const {
    laptopRoot,
    driveRoot,
    sdRoot,
    status,
    operationId,
    logs,
    progress,
    report,
    setLaptopRoot,
    setDriveRoot,
    setSdRoot,
    addLog,
    clearLogs,
    beginOperation,
    endOperation,
    setReport
  } = useReconcileStore();

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [targetFolder, setTargetFolder] = useState<string | null>(null); // null means all
  const [deepVerifyResults, setDeepVerifyResults] = useState<any[] | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const store = await load("settings.json");
        const archive = await store.get<string>("archivePath");
        const backup = await store.get<string>("backupPath");

        if (archive && !laptopRoot) setLaptopRoot(archive);
        if (backup && !driveRoot) setDriveRoot(backup);
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    };
    loadSettings();
    ensureReconcileListeners();
  }, []);

  useEffect(() => {
    if (logsEndRef.current && typeof logsEndRef.current.scrollIntoView === "function") {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const handleBrowsePath = async (
    type: "laptop" | "drive" | "sd",
    title: string
  ) => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title,
      });
      if (selected && typeof selected === "string") {
        if (type === "laptop") setLaptopRoot(selected);
        else if (type === "drive") setDriveRoot(selected);
        else if (type === "sd") setSdRoot(selected);
      }
    } catch (err) {
      console.error("Failed to browse path:", err);
    }
  };

  const handleScan = async () => {
    if (!laptopRoot) return;

    const opId = `reconcile_${Date.now()}`;
    beginOperation("scanning", opId);
    clearLogs();
    addLog(`Starting backup reconciliation scan...`);
    addLog(`Laptop Root: ${laptopRoot}`);
    addLog(`Google Drive Root: ${driveRoot || "Not configured"}`);
    addLog(`SD Card Root: ${sdRoot || "Not configured"}`);

    try {
      const result = await invoke<ReconcileReport>("run_reconcile", {
        laptopRoot,
        driveRoot: driveRoot || null,
        sdRoot: sdRoot || null,
        operationId: opId,
      });
      setReport(result);
      endOperation("success");
      addLog(`Scan completed successfully!`);
    } catch (err) {
      console.error(err);
      endOperation("error");
      addLog(`Error during scan: ${err}`);
    }
  };

  const handleCancel = async () => {
    if (!operationId) return;
    try {
      addLog("Cancelling operation...");
      await invoke("cancel_operation", { operationId });
    } catch (err) {
      console.error("Failed to cancel operation:", err);
    }
  };

  const triggerBackup = async () => {
    if (!report || !driveRoot) return;
    setShowBackupModal(false);

    const opId = `backup_${Date.now()}`;
    beginOperation("backing_up", opId);
    clearLogs();

    // Determine files to back up
    const filesToBackup = report.files
      .filter((f) => f.classification === "AtRisk" && f.on_laptop)
      .filter((f) => !targetFolder || get_top_level_folder(f.rel_path) === targetFolder)
      .map((f) => f.rel_path);

    addLog(`Backing up ${filesToBackup.length} files to Google Drive...`);

    try {
      const result = await invoke<any>("backup_at_risk", {
        laptopRoot: report.laptop_root,
        driveRoot,
        relPaths: filesToBackup,
        operationId: opId,
      });

      addLog(`Backup complete. Success: ${result.backed_up_count}, Skipped: ${result.skipped.length}, Errors: ${result.errors.length}`);
      if (result.errors.length > 0) {
        result.errors.forEach((err: string) => addLog(`Error: ${err}`));
      }
      endOperation("success");
      // Re-scan to update layout
      handleScan();
    } catch (err) {
      endOperation("error");
      addLog(`Error during backup: ${err}`);
    }
  };

  const triggerDelete = async () => {
    if (!report) return;
    setShowDeleteModal(false);

    const opId = `delete_${Date.now()}`;
    beginOperation("deleting", opId);
    clearLogs();

    const filesToDelete = report.files
      .filter((f) => f.classification === "SafeToFree" && f.on_laptop)
      .filter((f) => !targetFolder || get_top_level_folder(f.rel_path) === targetFolder)
      .map((f) => f.rel_path);

    addLog(`Trashing ${filesToDelete.length} files...`);

    try {
      const result = await invoke<any>("free_local_space", {
        laptopRoot: report.laptop_root,
        driveRoot: report.drive_root,
        sdRoot: report.sd_root,
        files: filesToDelete,
        operationId: opId,
      });

      addLog(`Trashing complete. Deleted: ${result.deleted_count}, Skipped (not verified on Drive): ${result.skipped.length}, Errors: ${result.errors.length}`);
      if (result.errors.length > 0) {
        result.errors.forEach((err: string) => addLog(`Error: ${err}`));
      }
      endOperation("success");
      // Re-scan to update layout
      handleScan();
    } catch (err) {
      endOperation("error");
      addLog(`Error during trashing: ${err}`);
    }
  };

  const triggerDeepVerify = async () => {
    if (!report || !targetFolder || !driveRoot) return;
    setShowVerifyModal(false);

    const opId = `verify_${Date.now()}`;
    beginOperation("deep_verifying", opId);
    clearLogs();
    addLog(`Starting binary deep verification for folder: ${targetFolder}...`);

    try {
      const result = await invoke<any[]>("deep_verify_folder", {
        laptopRoot: report.laptop_root,
        driveRoot,
        folder: targetFolder,
        operationId: opId,
      });

      setDeepVerifyResults(result);
      const fails = result.filter((r) => !r.verified);
      addLog(`Deep verification finished! Files checked: ${result.length}. Mismatches: ${fails.length}`);
      fails.forEach((f) => addLog(`FAIL: ${f.rel_path} - ${f.reason}`));
      endOperation("success");
    } catch (err) {
      endOperation("error");
      addLog(`Error during deep verify: ${err}`);
    }
  };

  const triggerSeedCatalog = async () => {
    if (!report || !driveRoot) return;

    const opId = `seed_${Date.now()}`;
    beginOperation("seeding", opId);
    clearLogs();
    addLog(`Indexing reconcile results into catalog...`);

    try {
      const seeded = await invoke<number>("seed_catalog_from_reconcile", {
        laptopRoot: report.laptop_root,
        driveRoot,
        operationId: opId,
      });

      addLog(`Catalog indexing complete! Seeded ${seeded} new files.`);
      endOperation("success");
    } catch (err) {
      endOperation("error");
      addLog(`Error during indexing: ${err}`);
    }
  };

  const get_top_level_folder = (rel_path: string) => {
    const pos = rel_path.indexOf("/");
    return pos !== -1 ? rel_path.substring(0, pos) : "Root";
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const isBusy =
    status === "scanning" ||
    status === "backing_up" ||
    status === "deleting" ||
    status === "deep_verifying" ||
    status === "seeding";

  return (
    <div className="space-y-8 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-text-main flex items-center gap-2">
            <Scale className="w-8 h-8 text-primary-500" />
            Free Local Space
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Compare local working files against Google Drive backups to safely reclaim disk space.
          </p>
        </div>

        {report && !isBusy && (
          <button
            onClick={triggerSeedCatalog}
            className="btn-secondary flex items-center gap-2"
          >
            <Database className="w-4 h-4" />
            Index Archive in Catalog
          </button>
        )}
      </div>

      {/* Path configuration card */}
      <div className="glass-card p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-primary-400" />
          Volume Paths
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Laptop Archive Path */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-muted">
              Laptop Staging / Archive Root
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                className="input-field flex-1"
                placeholder="Select Laptop Archive Root..."
                value={laptopRoot || ""}
                onChange={(e) => setLaptopRoot(e.target.value)}
                disabled={isBusy}
              />
              <button
                onClick={() => handleBrowsePath("laptop", "Select Laptop Folder")}
                className="btn-secondary whitespace-nowrap"
                disabled={isBusy}
              >
                Browse
              </button>
            </div>
          </div>

          {/* Drive Root */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-muted">
              Google Drive Backup Root
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                className="input-field flex-1"
                placeholder="Select Google Drive Backup Root..."
                value={driveRoot || ""}
                onChange={(e) => setDriveRoot(e.target.value)}
                disabled={isBusy}
              />
              <button
                onClick={() => handleBrowsePath("drive", "Select Google Drive Root")}
                className="btn-secondary whitespace-nowrap"
                disabled={isBusy}
              >
                Browse
              </button>
            </div>
          </div>

          {/* SD root */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-muted">
              SD Card Root (Optional)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                className="input-field flex-1"
                placeholder="Select SD Card Root (Optional)..."
                value={sdRoot || ""}
                onChange={(e) => setSdRoot(e.target.value)}
                disabled={isBusy}
              />
              <button
                onClick={() => handleBrowsePath("sd", "Select SD Card Root")}
                className="btn-secondary whitespace-nowrap"
                disabled={isBusy}
              >
                Browse
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleScan}
            disabled={isBusy || !laptopRoot}
            className="btn-primary flex items-center gap-2 w-full md:w-auto px-6 py-2.5 disabled:opacity-50"
          >
            {status === "scanning" ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <RefreshCw className="w-5 h-5" />
            )}
            {status === "scanning" ? "Scanning..." : "Reconcile / Scan"}
          </button>
        </div>
      </div>

      {/* Warnings */}
      {report && report.warnings && report.warnings.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg space-y-1">
          <h3 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Scan Warnings
          </h3>
          <ul className="list-disc pl-5 text-sm space-y-0.5">
            {report.warnings.map((warn, i) => (
              <li key={i}>{warn}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Report Summary Cards */}
      {report && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Reclaimable */}
          <div className="glass-card p-6 flex items-start gap-4 border-l-4 border-green-500">
            <div className="p-3 bg-green-500/15 rounded-lg text-green-400">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="flex-1 space-y-1">
              <span className="text-sm font-medium text-text-muted">Reclaimable Space (On Drive)</span>
              <div className="text-3xl font-extrabold text-green-400">
                {formatSize(report.total_reclaimable_bytes)}
              </div>
              <p className="text-xs text-text-muted mt-1">
                These staging files are verified on Google Drive and can be safely deleted.
              </p>
              {report.total_reclaimable_bytes > 0 && !isBusy && (
                <button
                  onClick={() => {
                    setTargetFolder(null);
                    setShowDeleteModal(true);
                  }}
                  className="mt-3 text-sm font-semibold text-green-400 hover:text-green-300 flex items-center gap-1 transition"
                >
                  <Trash2 className="w-4 h-4" /> Free All Space
                </button>
              )}
            </div>
          </div>

          {/* At Risk */}
          <div className="glass-card p-6 flex items-start gap-4 border-l-4 border-red-500">
            <div className="p-3 bg-red-500/15 rounded-lg text-red-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="flex-1 space-y-1">
              <span className="text-sm font-medium text-text-muted">At Risk Space (Un-archived)</span>
              <div className="text-3xl font-extrabold text-red-400">
                {formatSize(report.total_at_risk_bytes)}
              </div>
              <p className="text-xs text-text-muted mt-1">
                Files exist ONLY on the laptop (or SD card). Do NOT delete before backing up.
              </p>
              {report.total_at_risk_bytes > 0 && !isBusy && driveRoot && (
                <button
                  onClick={() => {
                    setTargetFolder(null);
                    setShowBackupModal(true);
                  }}
                  className="mt-3 text-sm font-semibold text-red-400 hover:text-red-300 flex items-center gap-1 transition"
                >
                  <HardDrive className="w-4 h-4" /> Back Up All At-Risk
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Folder breakdowns */}
      {report && report.folders.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border-main/20 bg-surface-secondary/40 flex justify-between items-center">
            <h2 className="font-semibold text-lg">Folder Breakdown</h2>
            <span className="text-xs text-text-muted">{report.folders.length} folders scanned</span>
          </div>

          <div className="divide-y divide-border-main/10">
            {report.folders.map((folder) => {
              const isExpanded = expandedFolders[folder.folder];
              const folderFiles = report.files.filter(
                (f) => get_top_level_folder(f.rel_path) === folder.folder
              );

              return (
                <div key={folder.folder} className="transition hover:bg-surface-hover/20">
                  {/* Folder Summary Row */}
                  <div className="flex items-center justify-between p-4 pl-6 cursor-pointer" onClick={() =>
                    setExpandedFolders((prev) => ({
                      ...prev,
                      [folder.folder]: !prev[folder.folder],
                    }))
                  }>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-text-muted" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-text-muted" />
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-text-main truncate">
                          {folder.folder}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5 flex items-center gap-2">
                          <span>{folder.laptop_count} laptop files</span>
                          <span>•</span>
                          <span>{folder.drive_count} drive files</span>
                          {folder.sd_count > 0 && (
                            <>
                              <span>•</span>
                              <span>{folder.sd_count} SD files</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      {/* Safe to Free Indicator */}
                      <div className="text-right">
                        <div className="text-sm font-semibold text-green-400">
                          {formatSize(folder.safe_to_free_bytes)}
                        </div>
                        <div className="text-xxs text-text-muted">
                          {folder.safe_to_free_count} safe
                        </div>
                      </div>

                      {/* At Risk Indicator */}
                      <div className="text-right w-24">
                        <div className="text-sm font-semibold text-red-400">
                          {formatSize(folder.at_risk_bytes)}
                        </div>
                        <div className="text-xxs text-text-muted">
                          {folder.at_risk_count} at risk
                        </div>
                      </div>

                      {/* Folder Actions */}
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {/* Deep verify */}
                        {driveRoot && folder.safe_to_free_count > 0 && !isBusy && (
                          <button
                            onClick={() => {
                              setTargetFolder(folder.folder);
                              setShowVerifyModal(true);
                            }}
                            title="Deep Verify Folder Content (Downloads files)"
                            className="p-2 rounded bg-primary-500/10 text-primary-400 hover:bg-primary-500/20 transition"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        )}

                        {/* Back up at risk */}
                        {driveRoot && folder.at_risk_count > 0 && !isBusy && (
                          <button
                            onClick={() => {
                              setTargetFolder(folder.folder);
                              setShowBackupModal(true);
                            }}
                            title="Back up at risk files to Drive"
                            className="p-2 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition"
                          >
                            <HardDrive className="w-4 h-4" />
                          </button>
                        )}

                        {/* Free space */}
                        {folder.safe_to_free_count > 0 && !isBusy && (
                          <button
                            onClick={() => {
                              setTargetFolder(folder.folder);
                              setShowDeleteModal(true);
                            }}
                            title="Free local staging files"
                            className="p-2 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded File List */}
                  {isExpanded && (
                    <div className="px-6 pb-4 bg-surface-secondary/20 overflow-x-auto">
                      <table className="w-full text-left border-collapse mt-2">
                        <thead>
                          <tr className="border-b border-border-main/10 text-xxs uppercase tracking-wider text-text-muted">
                            <th className="py-2 pl-3">Relative Path</th>
                            <th className="py-2">File Size</th>
                            <th className="py-2">On Laptop</th>
                            <th className="py-2">On Drive</th>
                            <th className="py-2">On SD</th>
                            <th className="py-2">Verdict</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-main/5 text-xs">
                          {folderFiles.map((file) => {
                            let badge = (
                              <span className="px-2 py-0.5 rounded text-xxs font-medium bg-red-500/15 text-red-400">
                                At Risk
                              </span>
                            );
                            if (file.classification === "SafeToFree") {
                              badge = (
                                <span className="px-2 py-0.5 rounded text-xxs font-medium bg-green-500/15 text-green-400">
                                  Safe to Free
                                </span>
                              );
                            } else if (file.classification === "DriveOnly") {
                              badge = (
                                <span className="px-2 py-0.5 rounded text-xxs font-medium bg-blue-500/15 text-blue-400">
                                  Drive Only
                                </span>
                              );
                            } else if (file.classification === "SdOnly") {
                              badge = (
                                <span className="px-2 py-0.5 rounded text-xxs font-medium bg-purple-500/15 text-purple-400">
                                  SD Only
                                </span>
                              );
                            }

                            return (
                              <tr key={file.rel_path} className="hover:bg-surface-hover/10">
                                <td className="py-2.5 pl-3 font-mono text-xxs text-text-main truncate max-w-md">
                                  {file.rel_path}
                                </td>
                                <td className="py-2.5 text-text-muted">
                                  {formatSize(file.size)}
                                </td>
                                <td className="py-2.5">
                                  {file.on_laptop ? (
                                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="py-2.5">
                                  {file.on_drive ? (
                                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="py-2.5">
                                  {file.on_sd ? (
                                    <CheckCircle2 className="w-4 h-4 text-purple-400" />
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="py-2.5">{badge}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Deep verify results report */}
      {deepVerifyResults && (
        <div className="glass-card p-6 space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-green-400" />
            Deep Verification Results
          </h2>
          <div className="max-h-60 overflow-y-auto border border-border-main/10 rounded divide-y divide-border-main/10">
            {deepVerifyResults.map((r, i) => (
              <div key={i} className="p-3 text-xs flex justify-between items-center hover:bg-surface-hover/10">
                <span className="font-mono">{r.rel_path}</span>
                {r.verified ? (
                  <span className="px-2 py-0.5 rounded bg-green-500/15 text-green-400 font-semibold">
                    Verified Match
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400 font-semibold">
                    FAIL: {r.reason}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setDeepVerifyResults(null)}
              className="btn-secondary"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Progress & Logs (When active) */}
      {(isBusy || logs.length > 0) && (
        <div className="glass-card p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              {isBusy && <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />}
              {isBusy ? "Operation in Progress" : "Operation Logs"}
            </h3>

            {isBusy && (
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 rounded bg-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/30 transition"
              >
                Cancel Operation
              </button>
            )}
          </div>

          {/* Progress bar */}
          {isBusy && progress && progress.total > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-text-muted">
                <span className="capitalize">{progress.phase.replace("_", " ")}</span>
                <span>
                  {progress.current} / {progress.total} (
                  {Math.round((progress.current / progress.total) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-surface-secondary rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-primary-500 h-2.5 rounded-full transition-all duration-300"
                  style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                  }}
                ></div>
              </div>
              {progress.currentFile && (
                <div className="text-xxs text-text-muted font-mono truncate">
                  Current file: {progress.currentFile}
                </div>
              )}
            </div>
          )}

          {/* Logs */}
          <div className="h-60 bg-surface-secondary/40 border border-border-main/10 rounded-lg p-4 font-mono text-xs overflow-y-auto space-y-1.5">
            {logs.map((log, index) => (
              <div key={index} className="text-text-muted leading-relaxed">
                {log}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* Confirmation Modal — Delete */}
      {showDeleteModal && report && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="glass-card max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" />
              Confirm Trashing Local Files
            </h3>
            <p className="text-sm text-text-muted">
              You are about to delete local copies of files in{" "}
              <span className="font-semibold text-text-main">
                {targetFolder ? `folder: ${targetFolder}` : "all folders"}
              </span>
              .
            </p>
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 rounded text-xs leading-relaxed space-y-1">
              <div className="font-semibold">Important Notes:</div>
              <div>1. All deleted files will be moved to the macOS Trash.</div>
              <div>2. Files are verified to exist on Google Drive prior to deletion.</div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={triggerDelete}
                className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold transition"
              >
                Proceed to Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal — Backup */}
      {showBackupModal && report && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="glass-card max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-primary-400 flex items-center gap-2">
              <HardDrive className="w-6 h-6" />
              Confirm Backup of At-Risk Files
            </h3>
            <p className="text-sm text-text-muted">
              You are about to copy all un-archived at-risk files in{" "}
              <span className="font-semibold text-text-main">
                {targetFolder ? `folder: ${targetFolder}` : "all folders"}
              </span>{" "}
              to your Google Drive mount.
            </p>
            <div className="p-3 bg-primary-500/10 border border-primary-500/20 text-primary-400 rounded text-xs">
              This will upload them in the background via the Google Drive desktop client.
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowBackupModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={triggerBackup}
                className="btn-primary"
              >
                Start Backup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal — Deep Verify */}
      {showVerifyModal && report && targetFolder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="glass-card max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-yellow-400 flex items-center gap-2">
              <Eye className="w-6 h-6" />
              Confirm Folder Deep Verification
            </h3>
            <p className="text-sm text-text-muted">
              You are starting a deep binary hash verification of the folder:{" "}
              <span className="font-semibold text-text-main">{targetFolder}</span>.
            </p>
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded text-xs leading-relaxed space-y-1">
              <div className="font-semibold">Network Download Warning:</div>
              <div>
                This check requires downloading the full files from Google Drive to compute and compare content hashes. Depending on the folder size, this may consume significant internet bandwidth.
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowVerifyModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={triggerDeepVerify}
                className="px-5 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-semibold transition"
              >
                Start Verification
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
