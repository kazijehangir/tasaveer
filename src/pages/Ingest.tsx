import { Upload, FolderOpen, HardDrive, Copy, Move, CheckCircle2, Image, Cloud, Archive, Camera, FolderTree, Tag, Plus, Search, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";

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

interface OrganizeResult {
  total_files: number;
  organized: number;
  skipped: number;
  duplicates: number;
  errors: number;
}

interface FileOrganizeResult {
  source_path: string;
  dest_path: string | null;
  status: string;
  message: string | null;
}

interface OrganizePreview {
  files: FileOrganizeResult[];
  total_files: number;
  will_organize: number;
  will_skip: number;
  duplicates: number;
}

interface TagProgress {
  id: string;
  current: number;
  total: number;
  message: string;
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


  const [status, setStatus] = useState<'idle' | 'scanning' | 'previewing' | 'copying' | 'tagging' | 'organizing' | 'success' | 'error'>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [isLogsExpanded, setIsLogsExpanded] = useState(false);
  const cancelledRef = useRef(false);

  // Tagging State
  const [sourceTags, setSourceTags] = useState<SourceTag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [enableTagging, setEnableTagging] = useState(true);

  const [cameraModels, setCameraModels] = useState<CameraModelGroup[]>([]);
  const [directoryGroups, setDirectoryGroups] = useState<DirectoryGroup[]>([]);

  const [isScanned, setIsScanned] = useState(false);
  const [previewData, setPreviewData] = useState<OrganizePreview | null>(null);

  // Log buffering
  const logBufferRef = useRef<string[]>([]);
  const flushIntervalRef = useRef<number | null>(null);

  // Helper to check if any operation is in progress
  const isProcessing = ['scanning', 'previewing', 'copying', 'tagging', 'organizing'].includes(status);

  useEffect(() => {
    const unlisten = listen<TagProgress>('tag-progress', (event) => {
      if (event.payload.id === 'tag_staged_files') {
        const { current, total, message } = event.payload;
        addToLogs(`[Tagging ${current}/${total}] ${message}`);
      }
    });
    return () => { unlisten.then(f => f()); };
  }, []);

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
        setPreviewData(null); // Reset preview on new source
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
        setPreviewData(null); // Reset preview on new destination
      }
    } catch (err) {
      console.error("Failed to select destination:", err);
    }
  };

  const handleCancel = async () => {
    logBufferRef.current.push('Canceling operations...');
    setLogs(prev => [...prev, 'Canceling operations...']); // Immediate feedback
    cancelledRef.current = true;

    // Cancel via Rust state management
    try {
      await invoke('cancel_operation', { operationId: 'organize_ingest' });
      logBufferRef.current.push('Cancel signal sent.');
    } catch (err) {
      console.error('Failed to cancel:', err);
    }

    logBufferRef.current.push('Operation canceled by user.');
    setStatus('idle');
  };

  // Load settings and tags
  useEffect(() => {
    async function loadData() {
      try {
        const store = await load('settings.json');
        const archivePathValue = await store.get<string>('archivePath');
        if (archivePathValue) {
          setDestPath(archivePathValue);
        }
        const savedTags = await store.get<SourceTag[]>('sourceTags');
        if (savedTags) {
          setSourceTags(savedTags);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    }
    loadData();
  }, []);

  const saveTags = async (tags: SourceTag[]) => {
    try {
      const store = await load('settings.json');
      await store.set('sourceTags', tags);
      await store.save();
    } catch (err) {
      console.error("Failed to save tags:", err);
    }
  };

  const handlePreview = async () => {
    if (!sourcePath || !destPath) return;
    setStatus('previewing');
    setPreviewData(null);
    addToLogs(`Generating preview for: ${sourcePath} -> ${destPath}`);

    try {
      const result = await invoke<OrganizePreview>('preview_organize', {
        sourcePath,
        destPath,
      });
      setPreviewData(result);
      addToLogs(`Preview complete: ${result.will_organize} to organize, ${result.will_skip} skipping, ${result.duplicates} duplicates.`);
      setStatus('idle');
    } catch (err) {
      console.error("Preview failed:", err);
      addToLogs(`Preview failed: ${err}`);
      setStatus('error');
    }
  };

  const scanSource = async () => {
    if (!sourcePath) return;
    setStatus('scanning');
    setCameraModels([]);
    setDirectoryGroups([]);

    try {
      addToLogs(`Scanning source path: ${sourcePath}`);
      const results = await invoke<FileMetadataInfo[]>("scan_missing_dates", {
        path: sourcePath,
        operationId: "scan_source",
      });


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

  const handleRemoveTag = (tagId: string) => {
    const updatedTags = sourceTags.filter(t => t.id !== tagId);
    setSourceTags(updatedTags);
    saveTags(updatedTags);
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
        setStatus('organizing');
        addToLogs('Starting unified ingest...');
        addToLogs(`Source: ${sourcePath}`);
        addToLogs(`Destination: ${destPath}`);
        addToLogs(`Strategy: ${selectedStrategy}`);
        addToLogs(`Tagging: ${enableTagging ? 'Enabled' : 'Disabled'}`);

        const rules = sourceTags.map(tag => ({
          name: tag.name,
          camera_models: tag.cameraAliases,
          directory_patterns: tag.directoryPatterns || []
        }));

        const result = await invoke<OrganizeResult>('run_unified_ingest', {
          sourcePath,
          destPath,
          rules,
          moveFiles: selectedStrategy === 'move',
          enableTagging,
          operationId: 'organize_ingest',
        });

        addToLogs(`Ingest complete:`);
        addToLogs(`  - Total files: ${result.total_files}`);
        addToLogs(`  - Organized: ${result.organized}`);
        addToLogs(`  - Skipped (no date): ${result.skipped}`);
        addToLogs(`  - Duplicates: ${result.duplicates}`);
        if (result.errors > 0) {
          addToLogs(`  - Errors: ${result.errors}`);
        }
      }
      else {
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

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold mb-2">
          <span className="gradient-text">Ingest</span> Media
        </h1>
        <p className="text-text-muted text-lg">
          Import photos and videos into your canonical archive
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-8">
          {/* Source Selection */}
          <div className="glass-card p-8">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-text-main">
              <span className="w-8 h-8 rounded-full bg-surface-secondary flex items-center justify-center text-sm font-bold text-text-main">1</span>
              Source Type
            </h2>

            <div className="grid grid-cols-3 gap-3 mb-6">
              <button
                onClick={() => { setIngestType('local'); setSourcePath(null); }}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${ingestType === 'local' ? 'bg-primary-500/10 dark:bg-primary-500/20 border-primary-500 text-primary-700 dark:text-primary-300' : 'bg-surface-secondary border-border text-text-main hover:border-text-muted'}`}
              >
                <HardDrive className="w-5 h-5" />
                <span className="text-xs font-semibold">Local</span>
              </button>
              <button
                onClick={() => { setIngestType('google-photos'); setSourcePath(null); }}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${ingestType === 'google-photos' ? 'bg-primary-500/10 dark:bg-primary-500/20 border-primary-500 text-primary-700 dark:text-primary-300' : 'bg-surface-secondary border-border text-text-main hover:border-text-muted'}`}
              >
                <Image className="w-5 h-5" />
                <span className="text-xs font-semibold">Google</span>
              </button>
              <button
                onClick={() => { setIngestType('icloud'); setSourcePath(null); }}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${ingestType === 'icloud' ? 'bg-primary-500/10 dark:bg-primary-500/20 border-primary-500 text-primary-700 dark:text-primary-300' : 'bg-surface-secondary border-border text-text-main hover:border-text-muted'}`}
              >
                <Cloud className="w-5 h-5" />
                <span className="text-xs font-semibold">iCloud</span>
              </button>
            </div>

            {!sourcePath ? (
              <div className="grid grid-cols-1 gap-4">
                <button onClick={handleSelectSource} className="group flex items-center gap-4 p-6 rounded-xl bg-surface-secondary border border-border hover:border-primary-500 transition-all hover:scale-[1.02]">
                  <div className="p-3 rounded-lg bg-primary-100 dark:bg-purple-500/20 group-hover:bg-primary-200 dark:group-hover:bg-purple-500/30 transition-colors">
                    {ingestType === 'local' ? <FolderOpen className="w-6 h-6 text-primary-600 dark:text-purple-400" /> : <Archive className="w-6 h-6 text-primary-600 dark:text-purple-400" />}
                  </div>
                  <div className="text-left">
                    <h3 className="font-semibold text-lg text-text-main">
                      {ingestType === 'local' ? 'Browse Folder' : 'Select Takeout Folder'}
                    </h3>
                    <p className="text-sm text-text-muted">
                      {ingestType === 'local' ? 'Select source directory' : 'Select folder containing zips'}
                    </p>
                  </div>
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-surface-secondary border border-green-500/30 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-2 rounded-lg bg-green-500/20 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="truncate">
                    <p className="text-xs text-text-muted uppercase tracking-wider font-bold">Source</p>
                    <p className="text-sm font-medium truncate text-text-main" title={sourcePath} data-testid="source-path-display">{sourcePath}</p>
                  </div>
                </div>
                <button onClick={() => setSourcePath(null)} className="p-2 hover:bg-neutral-200 dark:hover:bg-slate-700 rounded-lg text-text-muted hover:text-text-main transition-colors">
                  Change
                </button>
              </div>
            )}

            {sourcePath && (
              <div className="mt-4 flex gap-4">
                <button
                  onClick={scanSource}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-primary-100 dark:bg-purple-500/20 text-primary-700 dark:text-purple-300 rounded-lg hover:bg-primary-200 dark:hover:bg-purple-500/30 transition-colors flex items-center gap-2"
                >
                  {status === 'scanning' ? <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" /> : <Search className="w-4 h-4" />}
                  Scan for Tags
                </button>
                {isScanned && <span className="text-sm text-green-600 dark:text-green-400 self-center flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Scanned</span>}
              </div>
            )}
          </div>

          {/* Tagging Panel (Always Visible) */}
          <div className={`glass-card p-8 transition-opacity ${!enableTagging ? 'opacity-50 grayscale' : ''}`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2 text-text-main">
                <span className="w-8 h-8 rounded-full bg-surface-secondary flex items-center justify-center text-sm font-bold text-text-main">2</span>
                Assign Tags
              </h2>
              <label className="flex items-center gap-3 cursor-pointer">
                <span className="text-sm font-medium text-text-muted">Enable Tagging & Staging</span>
                <div className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={enableTagging} onChange={(e) => setEnableTagging(e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-neutral-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                </div>
              </label>
            </div>

            {enableTagging && (
              <>

                {/* Tag Management */}
                <div className="mb-6">
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="Create new source tag..."
                      className="input-field"
                      onKeyDown={(e) => e.key === "Enter" && handleCreateTag()}
                    />
                    <button
                      onClick={handleCreateTag}
                      disabled={!newTagName.trim()}
                      className="p-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>

                  {sourceTags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {sourceTags.map(tag => (
                        <span key={tag.id} className={`${tag.color} pl-2 pr-1 py-1 rounded-full text-xs font-medium text-white flex items-center gap-1`}>
                          <Tag className="w-3 h-3" />
                          <span className="mr-1">{tag.name}</span>
                          <button
                            onClick={() => handleRemoveTag(tag.id)}
                            className="p-0.5 hover:bg-white/20 rounded-full transition-colors"
                            title="Remove tag"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Camera Models */}
                {cameraModels.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-text-muted mb-2 flex items-center gap-2">
                      <Camera className="w-4 h-4" /> Camera Models
                    </h3>
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                      {cameraModels.map((group) => (
                        <div key={group.model} className="flex items-center justify-between p-2 rounded-lg bg-surface-secondary text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-text-main">{group.model}</span>
                            <span className="text-xs text-text-muted">({group.count} files)</span>
                          </div>
                          <select
                            value={sourceTags.find(t => t.name === group.assignedTag)?.id || ""}
                            onChange={(e) => handleAssignCameraToTag(group.model, e.target.value || null)}
                            className="bg-transparent text-text-main border-none focus:ring-0 text-xs text-right cursor-pointer"
                          >
                            <option value="">No Tag</option>
                            {sourceTags.map(tag => (
                              <option key={tag.id} value={tag.id}>{tag.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Directory Groups */}
                {directoryGroups.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-text-muted mb-2 flex items-center gap-2">
                      <FolderTree className="w-4 h-4" /> Folders
                    </h3>
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                      {directoryGroups.map((group) => (
                        <div key={group.directory} className="flex items-center justify-between p-2 rounded-lg bg-surface-secondary text-sm">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span className="font-medium text-text-main truncate max-w-[150px]" title={group.directory}>{group.directory}</span>
                            <span className="text-xs text-text-muted">({group.count})</span>
                          </div>
                          <select
                            value={sourceTags.find(t => t.name === group.assignedTag)?.id || ""}
                            onChange={(e) => handleAssignDirToTag(group.directory, e.target.value || null)}
                            className="bg-transparent text-text-main border-none focus:ring-0 text-xs text-right cursor-pointer"
                          >
                            <option value="">No Tag</option>
                            {sourceTags.map(tag => (
                              <option key={tag.id} value={tag.id}>{tag.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Column: Status & Destination */}
        <div className="space-y-8">
          {/* Status Panel */}
          <div className="glass-card p-8 h-fit">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-text-main">Status</h2>
              <button onClick={() => setIsLogsExpanded(!isLogsExpanded)} className="text-xs text-primary-500 hover:text-primary-600 font-medium">
                {isLogsExpanded ? 'HIDE LOGS' : 'SHOW ALL'}
              </button>
            </div>

            {/* Destination Selector */}
            <div className="mb-6 p-4 rounded-xl bg-surface-secondary border border-border">
              <h3 className="text-sm font-semibold text-text-muted mb-2">Archive Destination</h3>
              <div className="flex gap-2">
                <div className="flex-1 truncate text-sm font-mono text-text-main bg-surface-elevated p-2 rounded border border-border" data-testid="dest-path-display">
                  {destPath || "Not selected"}
                </div>
                <button onClick={handleSelectDest} className="p-2 bg-neutral-200 dark:bg-slate-700 hover:bg-neutral-300 dark:hover:bg-slate-600 rounded text-text-main">
                  ...
                </button>
              </div>
            </div>

            {/* Copy/Move Strategy Selector */}
            <div className="mb-6 p-4 rounded-xl bg-surface-secondary border border-border">
              <h3 className="text-sm font-semibold text-text-muted mb-2">Import Strategy</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSelectedStrategy('copy')}
                  className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${selectedStrategy === 'copy' ? 'bg-primary-500/10 dark:bg-primary-500/20 border-primary-500 text-primary-700 dark:text-primary-300' : 'bg-surface-secondary border-border text-text-main hover:border-text-muted'}`}
                >
                  <Copy className="w-4 h-4" />
                  <span className="text-sm font-semibold">Copy</span>
                </button>
                <button
                  onClick={() => setSelectedStrategy('move')}
                  className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${selectedStrategy === 'move' ? 'bg-primary-500/10 dark:bg-primary-500/20 border-primary-500 text-primary-700 dark:text-primary-300' : 'bg-surface-secondary border-border text-text-main hover:border-text-muted'}`}
                >
                  <Move className="w-4 h-4" />
                  <span className="text-sm font-semibold">Move</span>
                </button>
              </div>
              <p className="text-xs text-text-muted mt-2">
                {selectedStrategy === 'copy' ? 'Original files will be preserved in source location.' : 'Original files will be deleted after import.'}
              </p>
            </div>

            {/* Preview Action Button */}
            <div className="flex gap-4 mb-6">
              <button
                onClick={handlePreview}
                disabled={isProcessing || !sourcePath || !destPath}
                className={`flex-1 py-3 rounded-xl font-bold border transition-all flex items-center justify-center gap-2
                  ${isProcessing
                    ? 'bg-neutral-100 dark:bg-slate-800 text-text-muted border-border cursor-not-allowed'
                    : 'bg-surface-secondary border-primary-500 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-500/10'
                  }`}
              >
                {status === 'previewing' ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                    Previewing...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Preview
                  </>
                )}
              </button>

              <button
                onClick={handleIngest}
                disabled={isProcessing || !sourcePath || !destPath}
                className={`flex-[2] py-4 rounded-xl font-bold text-lg shadow-lg transition-all flex items-center justify-center gap-2
                   ${isProcessing
                    ? 'bg-neutral-100 dark:bg-slate-800 text-text-muted cursor-not-allowed'
                    : 'bg-primary-600 hover:bg-primary-500 text-white shadow-primary-500/30 hover:-translate-y-0.5'
                  }`}
              >
                {status === 'copying' || status === 'tagging' || status === 'organizing' ? (
                  <>
                    <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    Start Import
                  </>
                )}
              </button>
            </div>

            {/* Preview Summary */}
            {previewData && (
              <div className="mb-6 p-4 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/30 animate-in fade-in slide-in-from-top-2">
                <h3 className="text-sm font-bold text-primary-800 dark:text-primary-200 mb-3 flex items-center gap-2">
                  <Archive className="w-4 h-4" /> Preview Summary
                </h3>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-surface-main/50">
                    <p className="text-xs text-text-muted uppercase font-bold mb-1">Organize</p>
                    <p className="text-lg font-bold text-text-main">{previewData.will_organize}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-surface-main/50">
                    <p className="text-xs text-text-muted uppercase font-bold mb-1">Skip</p>
                    <p className="text-lg font-bold text-text-main">{previewData.will_skip}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-surface-main/50">
                    <p className="text-xs text-text-muted uppercase font-bold mb-1">Dups</p>
                    <p className="text-lg font-bold text-text-main">{previewData.duplicates}</p>
                  </div>
                </div>
                <p className="text-[10px] text-text-muted mt-3 text-center">
                  Preview based on current tags and metadata. Total files: {previewData.total_files}
                </p>
              </div>
            )}

            {/* Progress / Status Display */}
            <div className="space-y-4">
              {/* Steps Visualizer */}
              <div className="relative pt-4 pb-8">
                <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-surface-secondary" />

                {/* Step 1 */}
                <div className="relative flex items-center gap-4 mb-6">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center z-10 ${['scanning'].includes(status) || isProcessing ? 'bg-primary-500 text-white' : 'bg-surface-secondary text-text-main font-bold border border-border'}`}>
                    1
                  </div>
                  <div>
                    <p className={`font-medium ${['scanning'].includes(status) ? 'text-primary-500' : 'text-text-main'}`}>Scan Source</p>
                    {status === 'scanning' && <span className="text-xs text-primary-500 animate-pulse">Scanning...</span>}
                  </div>
                </div>

                {/* Step 2 */}
                <div className="relative flex items-center gap-4 mb-6">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center z-10 ${['copying', 'tagging'].includes(status) ? 'bg-primary-500 text-white' : 'bg-surface-secondary text-text-main font-bold border border-border'}`}>
                    2
                  </div>
                  <div>
                    <p className={`font-medium ${['copying', 'tagging'].includes(status) ? 'text-primary-500' : 'text-text-main'}`}>Tag & Stage</p>
                    {status === 'copying' && <span className="text-xs text-primary-500 animate-pulse">Copying...</span>}
                    {status === 'tagging' && <span className="text-xs text-primary-500 animate-pulse">Tagging...</span>}
                  </div>
                </div>

                {/* Step 3 */}
                <div className="relative flex items-center gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center z-10 ${['organizing'].includes(status) ? 'bg-primary-500 text-white' : 'bg-surface-secondary text-text-main font-bold border border-border'}`}>
                    3
                  </div>
                  <div>
                    <p className={`font-medium ${['organizing'].includes(status) ? 'text-primary-500' : 'text-text-main'}`}>Organize</p>
                    {status === 'organizing' && <span className="text-xs text-primary-500 animate-pulse">Organizing...</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Cancel Button */}
            {isProcessing && (
              <button
                onClick={handleCancel}
                className="w-full py-2 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors text-sm font-medium"
              >
                Cancel Operation
              </button>
            )}

            {/* Logs Area */}
            {(isLogsExpanded || isProcessing || logs.length > 0) && (
              <div className={`mt-4 rounded-xl bg-black/90 p-4 font-mono text-xs text-green-400 overflow-y-auto transition-all ${isLogsExpanded ? 'h-64' : 'h-32'}`}>
                {logs.length === 0 ? (
                  <span className="opacity-50">Waiting for logs...</span>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="mb-1 border-b border-white/5 pb-0.5 last:border-0">
                      <span className="opacity-50 mr-2">[{new Date().toLocaleTimeString()}]</span>
                      {log}
                    </div>
                  ))
                )}
                <div id="log-end" />
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
