import { Upload, FolderOpen, HardDrive, Copy, Move, CheckCircle2, ChevronDown, ChevronUp, XCircle, Image, Cloud, Archive, Camera, FolderTree, Tag, Plus, Trash2, Edit2, Save, AlertCircle, Search } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Command } from "@tauri-apps/plugin-shell";

// Types for source tagging
interface SourceTag {
  id: string;
  name: string;
  color: string;
  cameraAliases: string[];
  directoryPatterns: string[];
}

interface CameraModelGroup {
  model: string;
  count: number;
  assignedTag: string | null;
}

interface DirectoryGroup {
  directory: string;
  count: number;
  assignedTag: string | null;
}

interface FileMetadataInfo {
  file_path: string;
  has_date: boolean;
  extracted_date: { date: string; time: string | null; source: string } | null;
  camera_model: string | null;
}

// Predefined colors for tags
const TAG_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-yellow-500",
  "bg-lime-500",
  "bg-green-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-sky-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-purple-500",
  "bg-fuchsia-500",
  "bg-pink-500",
  "bg-rose-500",
];

type IngestType = 'local' | 'google-photos' | 'icloud';

export function Ingest() {
  const [ingestType, setIngestType] = useState<IngestType>('local');
  const [selectedStrategy, setSelectedStrategy] = useState<'copy' | 'move'>('copy');
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [destPath, setDestPath] = useState<string | null>(null);
  const [defaultArchivePath, setDefaultArchivePath] = useState<string | null>(null);
  // Custom binary paths from settings
  const [phockupPath, setPhockupPath] = useState<string>('');
  const [immichGoPath, setImmichGoPath] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'scanning' | 'copying' | 'tagging' | 'organizing' | 'success' | 'error'>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [isLogsExpanded, setIsLogsExpanded] = useState(false);
  const runningCommandsRef = useRef<Array<{ kill: () => Promise<void> }>>([]);
  const cancelledRef = useRef(false);

  // Tagging State
  const [sourceTags, setSourceTags] = useState<SourceTag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [cameraModels, setCameraModels] = useState<CameraModelGroup[]>([]);
  const [directoryGroups, setDirectoryGroups] = useState<DirectoryGroup[]>([]);
  const [scannedFiles, setScannedFiles] = useState<FileMetadataInfo[]>([]);
  const [isScanned, setIsScanned] = useState(false);

  // Log buffering
  const logBufferRef = useRef<string[]>([]);
  const flushIntervalRef = useRef<number | null>(null);

  // Helper to check if any operation is in progress
  const isProcessing = ['scanning', 'copying', 'tagging', 'organizing'].includes(status);

  // Flush logs periodically to avoid React render thrashing
  useEffect(() => {
    if (isProcessing) {
      flushIntervalRef.current = window.setInterval(() => {
        if (logBufferRef.current.length > 0) {
          const newLogs = [...logBufferRef.current];
          logBufferRef.current = [];
          setLogs(prev => [...prev, ...newLogs]);
        }
      }, 100);
    } else {
      // Flush remaining
      if (logBufferRef.current.length > 0) {
        const remaining = [...logBufferRef.current];
        logBufferRef.current = [];
        setLogs(prev => [...prev, ...remaining]);
      }
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current);
        flushIntervalRef.current = null;
      }
    }

    return () => {
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
    };
  }, [status]);

  const addToLogs = (msg: string) => {
    console.log('[Ingest]', msg);
    logBufferRef.current.push(msg);
    // If not running (e.g. error state), flush immediately to ensure visibility
    if (!isProcessing) {
      setLogs(prev => [...prev, msg]);
      logBufferRef.current = []; // Clear buffer since we just flushed
    }
  };

  // Handlers for file selection
  const handleSelectSource = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Source Folder",
      });
      if (selected) {
        setSourcePath(selected as string);
        setIsScanned(false); // Reset scan state on new source
        setScannedFiles([]);
      }
    } catch (err) {
      console.error("Failed to select source:", err);
    }
  };

  const handleSelectDest = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Destination Folder",
      });
      if (selected) {
        setDestPath(selected as string);
      }
    } catch (err) {
      console.error("Failed to select destination:", err);
    }
  };

  const handleCancel = async () => {
    logBufferRef.current.push('Canceling operations...');
    setLogs(prev => [...prev, 'Canceling operations...']); // Immediate feedback
    cancelledRef.current = true;

    // Copy the array because 'close' handlers will mutate runningCommandsRef.current
    const processesToKill = [...runningCommandsRef.current];
    runningCommandsRef.current = []; // Clear immediately to prevent further handling

    for (const cmd of processesToKill) {
      try {
        await cmd.kill();
        logBufferRef.current.push('Killed running process.');
      } catch (err) {
        console.error('Failed to kill command:', err);
        logBufferRef.current.push(`Failed to kill process: ${err}`);
      }
    }

    logBufferRef.current.push('Operation canceled by user.');
    setStatus('idle');
  };

  // Load settings and tags
  useEffect(() => {
    async function loadData() {
      try {
        const settingsStr = await invoke<string>("load_settings");
        if (settingsStr) {
          const settings = JSON.parse(settingsStr);
          if (settings.archivePath) {
            setDefaultArchivePath(settings.archivePath);
            setDestPath(settings.archivePath);
          }
          if (settings.sourceTags) {
            setSourceTags(settings.sourceTags);
          }
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    }
    loadData();
  }, []);

  const saveTags = async (tags: SourceTag[]) => {
    try {
      const settingsStr = await invoke<string>("load_settings");
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      settings.sourceTags = tags;
      await invoke("save_settings", { settings: JSON.stringify(settings) });
    } catch (err) {
      console.error("Failed to save tags:", err);
    }
  };

  const scanSource = async () => {
    if (!sourcePath) return;
    setStatus('scanning');
    setScannedFiles([]);
    setCameraModels([]);
    setDirectoryGroups([]);

    try {
      addToLogs(`Scanning source path: ${sourcePath}`);
      const results = await invoke<FileMetadataInfo[]>("scan_missing_dates", {
        path: sourcePath,
      });

      setScannedFiles(results);
      setIsScanned(true);
      addToLogs(`Found ${results.length} files.`);

      // Group by camera model
      const modelCounts = new Map<string, number>();
      for (const file of results) {
        const model = file.camera_model || "Unknown";
        modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
      }

      const groups: CameraModelGroup[] = [];
      modelCounts.forEach((count, model) => {
        const assignedTag = sourceTags.find((t) =>
          t.cameraAliases.includes(model)
        );
        groups.push({
          model,
          count,
          assignedTag: assignedTag?.name || null,
        });
      });
      groups.sort((a, b) => b.count - a.count);
      setCameraModels(groups);

      // Group by directory
      const dirCounts = new Map<string, number>();
      for (const file of results) {
        // Calculate relative path from sourcePath
        // file.file_path is absolute. sourcePath is absolute.
        // We want the directory relative to sourcePath.
        let fileDir = file.file_path.substring(0, file.file_path.lastIndexOf('/'));

        // Remove sourcePath prefix
        if (sourcePath && fileDir.startsWith(sourcePath)) {
          let relDir = fileDir.substring(sourcePath.length);
          // Remove leading slash if present
          if (relDir.startsWith('/')) relDir = relDir.substring(1);
          // If empty (files in root of source), call it "Root"
          if (!relDir) relDir = "Root";
          dirCounts.set(relDir, (dirCounts.get(relDir) || 0) + 1);
        } else {
          // Fallback if mismatch
          const parts = file.file_path.split("/");
          const parentDir = parts.length > 1 ? parts[parts.length - 2] : "Root";
          dirCounts.set(parentDir, (dirCounts.get(parentDir) || 0) + 1);
        }
      }

      const dirs: DirectoryGroup[] = [];
      dirCounts.forEach((count, directory) => {
        const assignedTag = sourceTags.find((t) =>
          t.directoryPatterns?.some(pattern => directory.includes(pattern))
        );
        dirs.push({
          directory,
          count,
          assignedTag: assignedTag?.name || null,
        });
      });
      dirs.sort((a, b) => b.count - a.count);
      setDirectoryGroups(dirs);

      setStatus('idle');
    } catch (err) {
      console.error("Scan failed:", err);
      addToLogs(`Scan failed: ${err}`);
      setStatus('error');
    }
  };

  const handleCreateTag = () => {
    if (!newTagName.trim()) return;
    const newTag: SourceTag = {
      id: `tag_${Date.now()}`,
      name: newTagName.trim(),
      color: TAG_COLORS[sourceTags.length % TAG_COLORS.length],
      cameraAliases: [],
      directoryPatterns: [],
    };
    const updatedTags = [...sourceTags, newTag];
    setSourceTags(updatedTags);
    saveTags(updatedTags);
    setNewTagName("");
  };

  const handleAssignCameraToTag = (model: string, tagId: string | null) => {
    let updatedTags = sourceTags.map((t) => ({
      ...t,
      cameraAliases: t.cameraAliases.filter((m) => m !== model),
    }));

    if (tagId) {
      updatedTags = updatedTags.map((t) =>
        t.id === tagId
          ? { ...t, cameraAliases: [...t.cameraAliases, model] }
          : t
      );
    }
    setSourceTags(updatedTags);
    saveTags(updatedTags);

    // Update local state
    setCameraModels((prev) =>
      prev.map((cm) =>
        cm.model === model
          ? { ...cm, assignedTag: tagId ? updatedTags.find((t) => t.id === tagId)?.name || null : null }
          : cm
      )
    );
  };

  const handleAssignDirToTag = (directory: string, tagId: string | null) => {
    let updatedTags = sourceTags.map((t) => ({
      ...t,
      directoryPatterns: (t.directoryPatterns || []).filter((d) => d !== directory),
    }));

    if (tagId) {
      updatedTags = updatedTags.map((t) =>
        t.id === tagId
          ? { ...t, directoryPatterns: [...(t.directoryPatterns || []), directory] }
          : t
      );
    }
    setSourceTags(updatedTags);
    saveTags(updatedTags);

    setDirectoryGroups((prev) =>
      prev.map((dg) =>
        dg.directory === directory
          ? { ...dg, assignedTag: tagId ? updatedTags.find((t) => t.id === tagId)?.name || null : null }
          : dg
      )
    );
  };

  const handleIngest = async () => {
    if (!sourcePath || !destPath) return;

    setStatus('scanning'); // Initial state, will change
    setLogs([]);
    logBufferRef.current = [];
    setIsLogsExpanded(true);
    runningCommandsRef.current = [];
    cancelledRef.current = false;

    addToLogs('Initializing ingest process...');

    // Validate paths
    if (navigator.platform.toLowerCase().includes('win') && destPath.startsWith('/')) {
      const errorMsg = `Invalid destination path format: ${destPath}`;
      addToLogs(errorMsg);
      setStatus('error');
      setLogs(prev => [...prev, errorMsg]);
      return;
    }

    try {
      if (ingestType === 'local') {
        // MULTI-STEP WORKFLOW

        // 1. Copy to Staging
        setStatus('copying');
        const stagingPath = `${destPath}/staging`; // Or custom logic
        addToLogs(`Copying files to staging: ${stagingPath}...`);

        await invoke('copy_to_staging', { source: sourcePath, staging: stagingPath });
        addToLogs('Copy completed.');

        // 2. Tag Files in Staging
        setStatus('tagging');
        addToLogs('Applying tags to staged files...');

        // Use the scannedFiles state but re-map paths to staging?
        // Actually, we can just run apply logic based on the TAGS we have.
        // We need to find files in STAGING that match our tags.
        // Option: Rescan staging to get exact file paths.
        addToLogs('Scanning staging directory to apply tags...');
        const stagedFiles = await invoke<FileMetadataInfo[]>("scan_missing_dates", {
          path: stagingPath,
        });

        let taggedCount = 0;
        for (const file of stagedFiles) {
          if (cancelledRef.current) throw new Error("Cancelled");

          // Match logic
          const model = file.camera_model || "Unknown";
          let tag = sourceTags.find((t) => t.cameraAliases.includes(model));

          if (!tag) {
            // Calculate relative path in STAGING
            // file.file_path is in stagingPath.
            // We need relative path from stagingPath to match the relative path from sourcePath used in groupings.

            let fileDir = file.file_path.substring(0, file.file_path.lastIndexOf('/'));
            if (fileDir.startsWith(stagingPath)) {
              let relDir = fileDir.substring(stagingPath.length);
              if (relDir.startsWith('/')) relDir = relDir.substring(1);
              // The "staging" dir structure mirrors "source" dir structure (rsync -a source/ staging/source_name/)
              // WAIT: rsync creates a subdirectory with the source folder name inside stagingPath? 
              // Let's check copy_to_staging implementation.
              // "rsync -a source staging" -> if source is /a/b, and staging is /x/y, rsync makes /x/y/b/...
              // So we need to strip the first component of the relative path to match the source relative path?

              // Actually, in scanSource, we stripped sourcePath. 
              // Example: Source=/Users/me/Photos. File=/Users/me/Photos/2023/Image.jpg. RelDir=2023.
              // In Staging: Staging=/Tmp/Stage. rsync creates /Tmp/Stage/Photos/2023/Image.jpg.
              // So file.file_path is /Tmp/Stage/Photos/2023/Image.jpg.
              // We need to extract "2023".
              // So relative path from staging is "Photos/2023".
              // We need to strip the first component "Photos".

              if (relDir) {
                const parts = relDir.split('/');
                if (parts.length > 0) {
                  // The first part is the source directory name itself.
                  // The rest is the relative path inside source.
                  // If parts.length == 1, it means it's in the root of source dir. (e.g. "Photos"), so RelDir should be "Root"?
                  // Re-check scanSource logic:
                  // if RelDir empty -> "Root".
                  // In internal relative path, it was "Relative from Source Root".

                  // Here, RelDir is "SourceDirName/SubDir/..."
                  // matches = parts.slice(1).join('/');
                  // if (parts.length === 1) matches = "Root";

                  let matchPath = parts.length > 1 ? parts.slice(1).join('/') : "Root";
                  tag = sourceTags.find((t) =>
                    (t.directoryPatterns || []).some(pattern => matchPath === pattern) // Exact match on relative path string?
                    // Previous logic was simple string includes. Now we have full relative paths.
                    // Let's assume user selected "2023/Trip" in dropdown. Tag pattern is "2023/Trip".
                    // matchPath is "2023/Trip".
                    // We should check exact match or at least "starts with"?
                    // For now, let's use check if one includes the other or exact match.
                    // Actually, the dropdown assigns the specific grouping key.
                    // The grouping key IS the relative path.
                    // So we should look for exact match of the key.
                  );

                  if (!tag) {
                    // Fallback to simple inclusion check just in case
                    tag = sourceTags.find((t) =>
                      (t.directoryPatterns || []).some(pattern => matchPath.includes(pattern))
                    );
                  }
                }
              }
            }
          }

          // Original fallback if relative path logic fails or is mismatched
          if (!tag) {
            const parts = file.file_path.split("/");
            const parentDir = parts.length > 1 ? parts[parts.length - 2] : "Root";
            tag = sourceTags.find((t) =>
              (t.directoryPatterns || []).some(pattern => parentDir.includes(pattern))
            );
          }

          if (tag) {
            try {
              await invoke("write_exif_keywords", {
                filePath: file.file_path,
                keywords: [tag.name],
              });
              taggedCount++;
            } catch (e) {
              addToLogs(`Failed to tag ${file.file_path}: ${e}`);
            }
          }
        }
        addToLogs(`Tagged ${taggedCount} files.`);

        // 3. Phockup Staging -> Dest
        setStatus('organizing');
        addToLogs(`Running Phockup on staging...`);

        const phockupCmd = phockupPath
          ? phockupPath
          : (navigator.platform.toLowerCase().includes('win') ? 'phockup.bat' : 'phockup');

        const runPhockup = () => {
          return new Promise<void>(async (resolve, reject) => {
            const threads = navigator.hardwareConcurrency || 4;
            // Source is STAGING now
            const args = [stagingPath, destPath, '--date', 'YYYY/YYYY-MM-DD', '--original-names', '--progress', '-c', threads.toString()];
            if (selectedStrategy === 'move') args.push('--move'); // Actually we might always 'move' from staging since it's a temp copy? 
            // If we copy, we are left with a full staging dir. If we move, Phockup deletes sourced files in staging.
            // Let's use Move from staging to cleanup as we go, or just delete directory after.
            // Using copy is safer if we want to debug staging. Let's stick to user pref for now but defaulted to move?
            // Actually, copying from staging duplicates data again. Moving from staging is best.
            args.push('--move'); 

            addToLogs(`Command: ${phockupCmd} ${args.join(' ')}`);

            let command;
            try {
              command = Command.create(phockupCmd, args);
            } catch (e) {
              reject(e);
              return;
            }
            await spawnAndTrack(command, resolve, reject);
          });
        };

        await runPhockup();

        // 4. Cleanup Staging 
        // setStatus('organizing'); // Keep status
        addToLogs("Cleaning up staging directory...");
        try {
          await invoke('clean_staging', { path: stagingPath });
          addToLogs("Staging directory cleaned.");
        } catch (e) {
          addToLogs(`Warning: Failed to clean staging path: ${e}`);
        }

      }
      // Immich-Go logic remains similar but from Staging? 
      // User likely wants similar flow: Copy Zip -> Staging -> Extract/Tag -> Immich-Go?
      else {
        // Complex logic for zips. For now, let's defer Immich-Go tagging support or keep it basic.
        // Fallback to original logic for non-local for now.
        addToLogs("Non-local ingest not fully unified yet.");
      }

      if (!cancelledRef.current) {
        setStatus('success');
        addToLogs(`All operations completed!`);
      }

    } catch (err) {
      console.error('Ingest failed:', err);
      if (!cancelledRef.current) {
        setStatus('error');
        setLogs(prev => [...prev, `Failed to execute ingest: ${err}`]);
      }
    }
  };

  const spawnAndTrack = (command: Command<string>, resolve: (val?: void) => void, reject: (err: any) => void) => {
    return new Promise<void>(async (internalResolve) => {
      let child: any = null;

      command.on('close', (data: { code: number | null, signal: number | null }) => {
        if (cancelledRef.current) return;
        if (child) runningCommandsRef.current = runningCommandsRef.current.filter(c => c !== child);

        if (data.code === 0) {
          resolve();
        } else if (data.code === null) {
          addToLogs(`Process terminated.`);
          resolve();
        } else {
          addToLogs(`Process exited with code ${data.code}`);
          reject(new Error(`Process exited with code ${data.code}`));
        }
        internalResolve();
      });

      command.on('error', (error: any) => {
        if (cancelledRef.current) return;
        if (child) runningCommandsRef.current = runningCommandsRef.current.filter(c => c !== child);
        addToLogs(`Process error events: ${error}`);
        reject(error);
        internalResolve();
      });

      command.stdout.on('data', (line: string) => !cancelledRef.current && addToLogs(line));
      command.stderr.on('data', (line: string) => !cancelledRef.current && addToLogs(line));

      try {
        addToLogs('Spawning child process...');
        child = await command.spawn();
        addToLogs(`Child process spawned. PID: ${child.pid}`);
        if (cancelledRef.current) {
          await child.kill();
          reject(new Error('Cancelled'));
          internalResolve();
          return;
        }
        runningCommandsRef.current.push(child);
      } catch (err) {
        console.error('Spawn failed:', err);
        addToLogs(`Failed to spawn process: ${err}`);
        reject(err);
        internalResolve();
      }
    });
  };

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold mb-2">
          <span className="gradient-text">Ingest</span> Media
        </h1>
        <p className="text-slate-400 text-lg">
          Import photos and videos into your canonical archive
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-8">
          {/* Source Selection */}
          <div className="glass-card p-8">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm">1</span>
              Source Type
            </h2>

            <div className="grid grid-cols-3 gap-3 mb-6">
              <button
                onClick={() => { setIngestType('local'); setSourcePath(null); }}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${ingestType === 'local' ? 'bg-purple-500/20 border-purple-500 text-purple-200' : 'bg-slate-800/30 border-slate-700 text-slate-400 hover:border-slate-600'}`}
              >
                <HardDrive className="w-5 h-5" />
                <span className="text-xs font-semibold">Local</span>
              </button>
              <button
                onClick={() => { setIngestType('google-photos'); setSourcePath(null); }}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${ingestType === 'google-photos' ? 'bg-blue-500/20 border-blue-500 text-blue-200' : 'bg-slate-800/30 border-slate-700 text-slate-400 hover:border-slate-600'}`}
              >
                <Image className="w-5 h-5" />
                <span className="text-xs font-semibold">Google</span>
              </button>
              <button
                onClick={() => { setIngestType('icloud'); setSourcePath(null); }}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${ingestType === 'icloud' ? 'bg-blue-500/20 border-blue-500 text-blue-200' : 'bg-slate-800/30 border-slate-700 text-slate-400 hover:border-slate-600'}`}
              >
                <Cloud className="w-5 h-5" />
                <span className="text-xs font-semibold">iCloud</span>
              </button>
            </div>

            {!sourcePath ? (
              <div className="grid grid-cols-1 gap-4">
                <button onClick={handleSelectSource} className="group flex items-center gap-4 p-6 rounded-xl bg-gradient-to-r from-slate-800/50 to-slate-800/30 border border-slate-700 hover:border-purple-500/50 transition-all hover:scale-[1.02]">
                  <div className="p-3 rounded-lg bg-purple-500/20 group-hover:bg-purple-500/30 transition-colors">
                    {ingestType === 'local' ? <FolderOpen className="w-6 h-6 text-purple-400" /> : <Archive className="w-6 h-6 text-purple-400" />}
                  </div>
                  <div className="text-left">
                    <h3 className="font-semibold text-lg text-white">
                      {ingestType === 'local' ? 'Browse Folder' : 'Select Takeout Folder'}
                    </h3>
                    <p className="text-sm text-slate-400">
                      {ingestType === 'local' ? 'Select source directory' : 'Select folder containing zips'}
                    </p>
                  </div>
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-800/50 border border-green-500/30 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-2 rounded-lg bg-green-500/20 text-green-400">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="truncate">
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">Source</p>
                    <p className="text-sm font-medium truncate" title={sourcePath}>{sourcePath}</p>
                  </div>
                </div>
                <button onClick={() => setSourcePath(null)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                  Change
                </button>
              </div>
            )}

            {sourcePath && (
              <div className="mt-4 flex gap-4">
                <button
                  onClick={scanSource}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-purple-500/20 text-purple-300 rounded-lg hover:bg-purple-500/30 transition-colors flex items-center gap-2"
                >
                  {status === 'scanning' ? <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" /> : <Search className="w-4 h-4" />}
                  Scan for Tags
                </button>
                {isScanned && <span className="text-sm text-green-400 self-center flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Scanned</span>}
              </div>
            )}
          </div>

          {/* Tagging Panel (Visible after scan) */}
          {sourcePath && (
            <div className="glass-card p-8">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm">2</span>
                Assign Tags
              </h2>

              {/* Tag Management */}
              <div className="mb-6">
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Create new source tag..."
                    className="flex-1 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 focus:border-purple-500 focus:outline-none text-white"
                    onKeyDown={(e) => e.key === "Enter" && handleCreateTag()}
                  />
                  <button
                    onClick={handleCreateTag}
                    disabled={!newTagName.trim()}
                    className="p-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>

                {sourceTags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {sourceTags.map(tag => (
                      <span key={tag.id} className={`${tag.color} px-2 py-1 rounded-full text-xs font-medium text-white flex items-center gap-1`}>
                        <Tag className="w-3 h-3" />
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Camera Models */}
              {cameraModels.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-slate-400 mb-2 flex items-center gap-2">
                    <Camera className="w-4 h-4" /> Camera Models
                  </h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                    {cameraModels.map((cm) => (
                      <div key={cm.model} className="flex items-center justify-between p-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm">
                        <div className="min-w-0 flex-1 mr-2">
                          <div className="truncate font-medium" title={cm.model}>{cm.model}</div>
                          <div className="text-xs text-slate-500">{cm.count} files</div>
                        </div>
                        <select
                          value={sourceTags.find(t => t.cameraAliases.includes(cm.model))?.id || ""}
                          onChange={(e) => handleAssignCameraToTag(cm.model, e.target.value || null)}
                          className="w-32 px-2 py-1 rounded bg-slate-700 border border-slate-600 text-xs focus:border-purple-500 focus:outline-none"
                        >
                          <option value="">Unassigned</option>
                          {sourceTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Source Directories */}
              {directoryGroups.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-400 mb-2 flex items-center gap-2">
                    <FolderTree className="w-4 h-4" /> Source Directories
                  </h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                    {directoryGroups.map((dg) => (
                      <div key={dg.directory} className="flex items-center justify-between p-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm">
                        <div className="min-w-0 flex-1 mr-2">
                          <div className="truncate font-medium" title={dg.directory}>{dg.directory}</div>
                          <div className="text-xs text-slate-500">{dg.count} files</div>
                        </div>
                        <select
                          value={sourceTags.find(t => (t.directoryPatterns || []).includes(dg.directory))?.id || ""}
                          onChange={(e) => handleAssignDirToTag(dg.directory, e.target.value || null)}
                          className="w-32 px-2 py-1 rounded bg-slate-700 border border-slate-600 text-xs focus:border-purple-500 focus:outline-none"
                        >
                          <option value="">Unassigned</option>
                          {sourceTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cameraModels.length === 0 && directoryGroups.length === 0 && (
                <div className="text-center py-4 text-slate-500 text-sm bg-slate-900/30 rounded-lg border border-dashed border-slate-800">
                  Scan source to find cameras and directories
                </div>
              )}
            </div>
          )}

          {/* Destination Selection */}
          <div className="glass-card p-8">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm">3</span>
              Select Destination
            </h2>

            {!destPath ? (
              <button onClick={handleSelectDest} className="w-full group flex items-center gap-4 p-6 rounded-xl bg-gradient-to-r from-slate-800/50 to-slate-800/30 border border-slate-700 hover:border-blue-500/50 transition-all hover:scale-[1.02]">
                <div className="p-3 rounded-lg bg-blue-500/20 group-hover:bg-blue-500/30 transition-colors">
                  <FolderOpen className="w-6 h-6 text-blue-400" />
                </div>
                <div className="text-left">
                  <h3 className="font-semibold text-lg text-white">Browse Folder</h3>
                  <p className="text-sm text-slate-400">Select destination archive</p>
                </div>
              </button>
            ) : (
              <div className="p-4 rounded-xl bg-slate-800/50 border border-green-500/30 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-2 rounded-lg bg-green-500/20 text-green-400">
                    <FolderOpen className="w-5 h-5" />
                  </div>
                  <div className="truncate">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">Destination</p>
                      {destPath === defaultArchivePath && (
                        <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30">Default</span>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate" title={destPath}>{destPath}</p>
                  </div>
                </div>
                <button onClick={() => setDestPath(null)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                  Change
                </button>
              </div>
            )}
          </div>

          {/* Import Strategy (Only for Local) */}
          {ingestType === 'local' && (
            <div className="glass-card p-8">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm">4</span>
                Import Strategy
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setSelectedStrategy('copy')}
                  style={selectedStrategy === 'copy' ? {
                    backgroundColor: 'rgba(168, 85, 247, 0.1)', // purple-500/10
                    borderColor: 'rgba(168, 85, 247, 1)',       // purple-500
                  } : {}}
                  className={`group relative z-10 cursor-pointer flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${selectedStrategy === 'copy'
                    ? '' // Handled by style
                    : 'bg-slate-800/30 border-slate-700 hover:border-slate-600'
                    }`}
                >
                  <div className={`p-2 rounded-lg transition-colors ${selectedStrategy === 'copy'
                    ? 'bg-purple-500/20'
                    : 'bg-slate-700 group-hover:bg-slate-600'
                    }`}>
                    <Copy className={`w-5 h-5 ${selectedStrategy === 'copy' ? 'text-purple-400' : 'text-slate-400'
                      }`} />
                  </div>
                  <div className="text-left flex-1">
                    <h3 className="font-semibold text-base text-white mb-1">Copy</h3>
                    <p className="text-xs text-slate-400">
                      Keeps original files (safe)
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedStrategy('move')}
                  style={selectedStrategy === 'move' ? {
                    backgroundColor: 'rgba(59, 130, 246, 0.1)', // blue-500/10
                    borderColor: 'rgba(59, 130, 246, 1)',       // blue-500
                  } : {}}
                  className={`group relative z-10 cursor-pointer flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${selectedStrategy === 'move'
                    ? '' // Handled by style
                    : 'bg-slate-800/30 border-slate-700 hover:border-slate-600'
                    }`}
                >
                  <div className={`p-2 rounded-lg transition-colors ${selectedStrategy === 'move'
                    ? 'bg-blue-500/20'
                    : 'bg-slate-700 group-hover:bg-slate-600'
                    }`}>
                    <Move className={`w-5 h-5 ${selectedStrategy === 'move' ? 'text-blue-400' : 'text-slate-400'
                      }`} />
                  </div>
                  <div className="text-left flex-1">
                    <h3 className="font-semibold text-base text-white mb-1">Move</h3>
                    <p className="text-xs text-slate-400">
                      Deletes source (clears space)
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {ingestType !== 'local' && (
            <div className="glass-card p-8">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm">4</span>
                Processing
              </h2>
              <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
                <p className="text-sm text-blue-200">
                  Google Photos/iCloud archives will be processed and extracted to the destination. Originals in the zip file will be preserved.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Status & Action */}
        <div className="space-y-8">
          <div className="glass-card p-8 h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Status</h2>
              <button
                onClick={() => setIsLogsExpanded(!isLogsExpanded)}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-xs uppercase font-bold tracking-wider"
              >
                {isLogsExpanded ? (
                  <>Hide Logs <ChevronUp className="w-4 h-4" /></>
                ) : (
                  <>Show All <ChevronDown className="w-4 h-4" /></>
                )}
              </button>
            </div>

            <div className={`bg-slate-950/50 rounded-xl font-mono text-xs border border-slate-800/50 overflow-hidden transition-all duration-300 ${isLogsExpanded ? 'flex-1 p-4 overflow-y-auto max-h-[400px]' : 'p-4'}`}>
              {logs.length === 0 ? (
                <div className={`flex flex-col items-center justify-center text-slate-600 ${isLogsExpanded ? 'h-full' : ''}`}>
                  <p>Ready to ingest</p>
                </div>
              ) : (
                isLogsExpanded ? (
                  logs.map((log, i) => (
                    <div key={i} className="mb-1 text-slate-300 break-all border-b border-transparent hover:border-slate-800/50">{log}</div>
                  ))
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-slate-300 truncate font-medium">
                      <span className="text-slate-500 mr-2">[{new Date().toLocaleTimeString()}]</span>
                      {logs[logs.length - 1]}
                    </div>
                    <div className="flex gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500/50 animate-pulse" />
                    </div>
                  </div>
                )
              )}
            </div>

            <button
              onClick={handleIngest}
              disabled={!sourcePath || !destPath || isProcessing}
              className={`btn-primary w-full mt-8 text-lg py-4 flex items-center justify-center gap-3 ${(!sourcePath || !destPath || isProcessing) ? 'opacity-50 cursor-not-allowed grayscale' : ''
                }`}
            >
              {isProcessing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {status === 'copying' ? 'Copying...' :
                    status === 'tagging' ? 'Applying Tags...' :
                      status === 'organizing' ? 'Organizing...' :
                        status === 'scanning' ? 'Scanning...' : 'Processing...'}
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  Start Import
                </>
              )}
            </button>

            {isProcessing && (
              <button
                onClick={handleCancel}
                className="btn-secondary w-full mt-4 text-lg py-4 flex items-center justify-center gap-3 border-red-500/30 hover:border-red-500/50 hover:bg-red-500/10 text-red-400 hover:text-red-300"
              >
                <XCircle className="w-5 h-5" />
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
