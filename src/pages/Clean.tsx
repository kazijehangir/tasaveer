import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
    Sparkles,
    Calendar,
    Copy,
    Images,
    FolderOpen,
    AlertCircle,
    CheckCircle2,
    Trash2,
    Eye,
    Search,
    Camera,
} from "lucide-react";

// Types matching Rust structs
interface ExtractedDate {
    date: string;
    time: string | null;
    source: string;
}

interface FileMetadataInfo {
    file_path: string;
    has_date: boolean;
    extracted_date: ExtractedDate | null;
    camera_model: string | null;
}

interface DuplicateFile {
    path: string;
    size: number;
    modified: string | null;
}

interface DuplicateGroup {
    files: DuplicateFile[];
    size_bytes: number;
}

interface DedupResult {
    duplicates: DuplicateGroup[];
    total_groups: number;
    total_wasted_space: number;
}

interface SimilarFile {
    path: string;
    size: number;
    width: number | null;
    height: number | null;
    similarity: number;
}

interface SimilarGroup {
    files: SimilarFile[];
    similarity: number;
}

interface SimilarResult {
    similar_groups: SimilarGroup[];
    total_groups: number;
}

type TabType = "metadata" | "duplicates" | "similar";

export function Clean() {
    const [activeTab, setActiveTab] = useState<TabType>("metadata");
    const [archivePath, setArchivePath] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [czkawkaStatus, setCzkawkaStatus] = useState<string | null>(null);

    // Metadata state
    const [metadataResults, setMetadataResults] = useState<FileMetadataInfo[]>([]);
    const [showOnlyMissing, setShowOnlyMissing] = useState(true);
    const [selectedForFix, setSelectedForFix] = useState<Set<string>>(new Set());

    // Duplicate state
    const [dupResults, setDupResults] = useState<DedupResult | null>(null);
    const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());

    // Similar state
    const [similarResults, setSimilarResults] = useState<SimilarResult | null>(null);

    // Error state
    const [error, setError] = useState<string | null>(null);

    // Load settings on mount
    useEffect(() => {
        async function loadSettings() {
            try {
                const settingsStr = await invoke<string>("load_settings");
                if (settingsStr) {
                    const settings = JSON.parse(settingsStr);
                    if (settings.archivePath) {
                        setArchivePath(settings.archivePath);
                    }
                }
                // Check czkawka availability
                try {
                    const status = await invoke<string>("check_czkawka");
                    setCzkawkaStatus(status);
                } catch (e) {
                    setCzkawkaStatus(`Not available: ${e}`);
                }
            } catch (err) {
                console.error("Failed to load settings:", err);
            }
        }
        loadSettings();
    }, []);

    const handleSelectPath = async () => {
        const selected = await open({
            directory: true,
            multiple: false,
            title: "Select Archive Folder to Scan",
        });
        if (selected) {
            setArchivePath(selected as string);
        }
    };

    const handleScanMetadata = async () => {
        if (!archivePath) return;
        setIsScanning(true);
        setMetadataResults([]);
        setError(null);
        try {
            console.log("Scanning metadata for:", archivePath);
            const results = await invoke<FileMetadataInfo[]>("scan_missing_dates", {
                path: archivePath,
            });
            console.log("Metadata scan results:", results);
            setMetadataResults(results);
        } catch (err) {
            console.error("Metadata scan failed:", err);
            setError(`Metadata scan failed: ${err}`);
        } finally {
            setIsScanning(false);
        }
    };

    const handleFixSelected = async () => {
        const toFix = metadataResults.filter(
            (f) => selectedForFix.has(f.file_path) && f.extracted_date
        );

        for (const file of toFix) {
            if (file.extracted_date) {
                try {
                    await invoke("write_exif_date_if_missing", {
                        filePath: file.file_path,
                        date: file.extracted_date.date,
                        time: file.extracted_date.time,
                    });
                } catch (err) {
                    console.error(`Failed to fix ${file.file_path}:`, err);
                }
            }
        }
        // Rescan after fixing
        handleScanMetadata();
        setSelectedForFix(new Set());
    };

    const handleScanDuplicates = async () => {
        if (!archivePath) return;
        setIsScanning(true);
        setDupResults(null);
        setError(null);
        try {
            console.log("Scanning duplicates in:", archivePath);
            const results = await invoke<DedupResult>("find_duplicates", {
                path: archivePath,
                czkawkaPath: null,
            });
            console.log("Duplicate scan results:", results);
            setDupResults(results);
        } catch (err) {
            console.error("Duplicate scan failed:", err);
            setError(`Duplicate scan failed: ${err}`);
        } finally {
            setIsScanning(false);
        }
    };

    const handleScanSimilar = async () => {
        if (!archivePath) return;
        setIsScanning(true);
        setSimilarResults(null);
        setError(null);
        try {
            console.log("Scanning similar images in:", archivePath);
            const results = await invoke<SimilarResult>("find_similar_images", {
                path: archivePath,
                czkawkaPath: null,
            });
            console.log("Similar scan results:", results);
            setSimilarResults(results);
        } catch (err) {
            console.error("Similar scan failed:", err);
            setError(`Similar scan failed: ${err}`);
        } finally {
            setIsScanning(false);
        }
    };

    const handleDeleteSelected = async () => {
        const toDelete = Array.from(selectedForDelete);
        if (toDelete.length === 0) return;

        try {
            const result = await invoke<string>("delete_to_trash", { files: toDelete });
            console.log(result);
            // Rescan after deletion
            handleScanDuplicates();
            setSelectedForDelete(new Set());
        } catch (err) {
            console.error("Delete failed:", err);
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const filteredMetadata = showOnlyMissing
        ? metadataResults.filter((f) => !f.has_date)
        : metadataResults;

    const filesWithExtractedDate = filteredMetadata.filter((f) => f.extracted_date);

    return (
        <div className="space-y-8 animate-fade-in pb-20">
            {/* Header */}
            <div>
                <h1 className="text-4xl font-bold mb-2">
                    Clean & <span className="gradient-text">Dedup</span>
                </h1>
                <p className="text-slate-400 text-lg">
                    Fix missing metadata and find duplicate files in your archive
                </p>
            </div>

            {/* Error Display */}
            {error && (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-red-300 font-medium">Error</p>
                        <p className="text-red-400 text-sm">{error}</p>
                    </div>
                    <button
                        onClick={() => setError(null)}
                        className="text-red-400 hover:text-red-300 text-sm"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* Path Selection */}
            <div className="glass-card p-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-lg bg-purple-500/20">
                            <FolderOpen className="w-6 h-6 text-purple-400" />
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">
                                Archive Path
                            </p>
                            <p className="text-sm font-medium truncate max-w-md">
                                {archivePath || "No path selected"}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleSelectPath}
                        className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors text-sm font-medium"
                    >
                        Change
                    </button>
                </div>
                {czkawkaStatus && (
                    <div className="mt-4 text-xs text-slate-500 flex items-center gap-2">
                        {czkawkaStatus.includes("found") ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                            <AlertCircle className="w-4 h-4 text-yellow-500" />
                        )}
                        {czkawkaStatus}
                    </div>
                )}
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-2">
                <button
                    onClick={() => setActiveTab("metadata")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeTab === "metadata"
                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/50"
                        : "bg-slate-800/50 text-slate-400 hover:text-white border border-transparent"
                        }`}
                >
                    <Calendar className="w-4 h-4" />
                    Fix Metadata
                </button>
                <button
                    onClick={() => setActiveTab("duplicates")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeTab === "duplicates"
                        ? "bg-blue-500/20 text-blue-300 border border-blue-500/50"
                        : "bg-slate-800/50 text-slate-400 hover:text-white border border-transparent"
                        }`}
                >
                    <Copy className="w-4 h-4" />
                    Find Duplicates
                </button>
                <button
                    onClick={() => setActiveTab("similar")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeTab === "similar"
                        ? "bg-teal-500/20 text-teal-300 border border-teal-500/50"
                        : "bg-slate-800/50 text-slate-400 hover:text-white border border-transparent"
                        }`}
                >
                    <Images className="w-4 h-4" />
                    Similar Images
                </button>
            </div>

            {/* Tab Content */}
            {activeTab === "metadata" && (
                <div className="space-y-6">
                    <div className="glass-card p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-purple-400" />
                                Metadata Fixer
                            </h2>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 text-sm text-slate-400">
                                    <input
                                        type="checkbox"
                                        checked={showOnlyMissing}
                                        onChange={(e) => setShowOnlyMissing(e.target.checked)}
                                        className="rounded border-slate-600"
                                    />
                                    Show only missing dates
                                </label>
                                <button
                                    onClick={handleScanMetadata}
                                    disabled={!archivePath || isScanning}
                                    className="btn-primary px-4 py-2 flex items-center gap-2"
                                >
                                    <Search className="w-4 h-4" />
                                    {isScanning ? "Scanning..." : "Scan"}
                                </button>
                            </div>
                        </div>

                        {metadataResults.length > 0 && (
                            <>
                                <div className="text-sm text-slate-400 mb-4">
                                    Found {filteredMetadata.length} files
                                    {showOnlyMissing && ` missing dates`}
                                    {filesWithExtractedDate.length > 0 && (
                                        <span className="text-green-400 ml-2">
                                            ({filesWithExtractedDate.length} can be fixed from filename)
                                        </span>
                                    )}
                                </div>

                                <div className="max-h-80 overflow-y-auto space-y-2">
                                    {filteredMetadata.map((file) => (
                                        <div
                                            key={file.file_path}
                                            className={`p-3 rounded-lg border transition-all ${file.extracted_date
                                                ? "bg-green-500/5 border-green-500/20"
                                                : "bg-slate-800/30 border-slate-700"
                                                }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    {file.extracted_date && (
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedForFix.has(file.file_path)}
                                                            onChange={(e) => {
                                                                const newSet = new Set(selectedForFix);
                                                                if (e.target.checked) {
                                                                    newSet.add(file.file_path);
                                                                } else {
                                                                    newSet.delete(file.file_path);
                                                                }
                                                                setSelectedForFix(newSet);
                                                            }}
                                                            className="rounded border-slate-600"
                                                        />
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-sm font-medium truncate">
                                                            {file.file_path.split("/").pop()}
                                                        </p>
                                                        <div className="flex items-center gap-4 text-xs text-slate-500">
                                                            {file.camera_model && (
                                                                <span className="flex items-center gap-1">
                                                                    <Camera className="w-3 h-3" />
                                                                    {file.camera_model}
                                                                </span>
                                                            )}
                                                            {file.has_date ? (
                                                                <span className="text-green-400">Has date</span>
                                                            ) : (
                                                                <span className="text-yellow-400">Missing date</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                {file.extracted_date && (
                                                    <div className="text-right">
                                                        <p className="text-sm text-green-400 font-medium">
                                                            {file.extracted_date.date}
                                                            {file.extracted_date.time && ` ${file.extracted_date.time}`}
                                                        </p>
                                                        <p className="text-xs text-slate-500">
                                                            from {file.extracted_date.source}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {selectedForFix.size > 0 && (
                                    <div className="mt-4 flex justify-end">
                                        <button
                                            onClick={handleFixSelected}
                                            className="btn-primary px-4 py-2 flex items-center gap-2"
                                        >
                                            <CheckCircle2 className="w-4 h-4" />
                                            Fix {selectedForFix.size} Selected
                                        </button>
                                    </div>
                                )}
                            </>
                        )}

                        {metadataResults.length === 0 && !isScanning && (
                            <div className="text-center py-12 text-slate-500">
                                <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                <p>Select an archive path and click Scan to find files with missing dates</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === "duplicates" && (
                <div className="space-y-6">
                    <div className="glass-card p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <Copy className="w-5 h-5 text-blue-400" />
                                Exact Duplicates
                            </h2>
                            <button
                                onClick={handleScanDuplicates}
                                disabled={!archivePath || isScanning || !czkawkaStatus?.includes("found")}
                                className="btn-primary px-4 py-2 flex items-center gap-2"
                            >
                                <Search className="w-4 h-4" />
                                {isScanning ? "Scanning..." : "Find Duplicates"}
                            </button>
                        </div>

                        {dupResults && (
                            <>
                                <div className="flex items-center justify-between text-sm text-slate-400 mb-4">
                                    <div>
                                        Found {dupResults.total_groups} duplicate groups
                                        <span className="text-red-400 ml-2">
                                            ({formatBytes(dupResults.total_wasted_space)} wasted)
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => {
                                            // Select all non-first files from all groups
                                            const allDuplicates = new Set<string>();
                                            dupResults.duplicates.forEach(group => {
                                                group.files.slice(1).forEach(file => {
                                                    allDuplicates.add(file.path);
                                                });
                                            });
                                            setSelectedForDelete(allDuplicates);
                                        }}
                                        className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs font-medium"
                                    >
                                        Select All Duplicates
                                    </button>
                                </div>

                                <div className="max-h-96 overflow-y-auto space-y-4">
                                    {dupResults.duplicates.map((group, groupIdx) => (
                                        <div
                                            key={groupIdx}
                                            className="p-4 rounded-lg bg-slate-800/30 border border-slate-700"
                                        >
                                            <div className="text-xs text-slate-500 mb-2">
                                                {group.files.length} identical files • {formatBytes(group.size_bytes)} each
                                            </div>
                                            <div className="space-y-2">
                                                {group.files.map((file, fileIdx) => (
                                                    <div
                                                        key={file.path}
                                                        className={`flex items-center justify-between p-2 rounded ${fileIdx === 0
                                                            ? "bg-green-500/10 border border-green-500/20"
                                                            : "bg-slate-900/50"
                                                            }`}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {fileIdx > 0 && (
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selectedForDelete.has(file.path)}
                                                                    onChange={(e) => {
                                                                        const newSet = new Set(selectedForDelete);
                                                                        if (e.target.checked) {
                                                                            newSet.add(file.path);
                                                                        } else {
                                                                            newSet.delete(file.path);
                                                                        }
                                                                        setSelectedForDelete(newSet);
                                                                    }}
                                                                    className="rounded border-slate-600"
                                                                />
                                                            )}
                                                            {fileIdx === 0 && (
                                                                <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded flex-shrink-0">
                                                                    Keep
                                                                </span>
                                                            )}
                                                            <span
                                                                className="text-sm overflow-hidden text-ellipsis whitespace-nowrap flex-1"
                                                                style={{ direction: 'rtl', textAlign: 'left' }}
                                                                title={file.path}
                                                            >
                                                                {file.path}
                                                            </span>
                                                        </div>
                                                        {file.modified && (
                                                            <span className="text-xs text-slate-500">{file.modified}</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                </div>

                                {selectedForDelete.size > 0 && (
                                    <div className="mt-4 flex justify-end">
                                        <button
                                            onClick={handleDeleteSelected}
                                            className="px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 flex items-center gap-2 font-medium"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            Delete {selectedForDelete.size} to Trash
                                        </button>
                                    </div>
                                )}
                            </>
                        )}

                        {!dupResults && !isScanning && (
                            <div className="text-center py-12 text-slate-500">
                                <Copy className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                <p>Click "Find Duplicates" to scan for identical files using hash comparison</p>
                                {!czkawkaStatus?.includes("found") && (
                                    <p className="text-yellow-500 mt-2">
                                        ⚠️ czkawka_cli is required. Install it first.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === "similar" && (
                <div className="space-y-6">
                    <div className="glass-card p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <Images className="w-5 h-5 text-teal-400" />
                                    Similar Images
                                </h2>
                                <p className="text-sm text-slate-500 mt-1">
                                    Review only — these may be intentional variations (burst shots, edits)
                                </p>
                            </div>
                            <button
                                onClick={handleScanSimilar}
                                disabled={!archivePath || isScanning || !czkawkaStatus?.includes("found")}
                                className="btn-primary px-4 py-2 flex items-center gap-2"
                            >
                                <Search className="w-4 h-4" />
                                {isScanning ? "Scanning..." : "Find Similar"}
                            </button>
                        </div>

                        {similarResults && (
                            <>
                                <div className="text-sm text-slate-400 mb-4">
                                    Found {similarResults.total_groups} groups of similar images
                                </div>

                                <div className="max-h-96 overflow-y-auto space-y-4">
                                    {similarResults.similar_groups.map((group, groupIdx) => (
                                        <div
                                            key={groupIdx}
                                            className="p-4 rounded-lg bg-slate-800/30 border border-teal-500/20"
                                        >
                                            <div className="text-xs text-teal-400 mb-3">
                                                {group.files.length} similar images • {group.similarity.toFixed(0)}% match
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                                {group.files.map((file, fileIdx) => (
                                                    <div
                                                        key={file.path}
                                                        className="rounded-lg bg-slate-900/50 overflow-hidden border border-slate-700 hover:border-teal-500/50 transition-colors"
                                                    >
                                                        <div className="aspect-square bg-slate-800 relative">
                                                            <img
                                                                src={convertFileSrc(file.path)}
                                                                alt={file.path.split("/").pop() || ""}
                                                                className="w-full h-full object-cover"
                                                                loading="lazy"
                                                                onError={(e) => {
                                                                    // Hide broken image and show fallback
                                                                    e.currentTarget.style.display = 'none';
                                                                    const fallback = e.currentTarget.nextElementSibling;
                                                                    if (fallback) (fallback as HTMLElement).style.display = 'flex';
                                                                }}
                                                            />
                                                            <div
                                                                className="absolute inset-0 items-center justify-center bg-slate-800 hidden"
                                                            >
                                                                <Eye className="w-8 h-8 text-slate-600" />
                                                            </div>
                                                            {fileIdx === 0 && (
                                                                <div className="absolute top-1 left-1 text-[10px] bg-teal-500/90 text-white px-1.5 py-0.5 rounded font-medium">
                                                                    Reference
                                                                </div>
                                                            )}
                                                            {file.similarity > 0 && (
                                                                <div className="absolute top-1 right-1 text-[10px] bg-slate-900/80 text-slate-300 px-1.5 py-0.5 rounded">
                                                                    diff: {file.similarity}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="p-2">
                                                            <p className="text-xs truncate font-medium" title={file.path}>
                                                                {file.path.split("/").pop()}
                                                            </p>
                                                            <p className="text-[10px] text-slate-500">
                                                                {formatBytes(file.size)}
                                                                {file.width && file.height && ` • ${file.width}×${file.height}`}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        {!similarResults && !isScanning && (
                            <div className="text-center py-12 text-slate-500">
                                <Images className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                <p>Click "Find Similar" to scan for visually similar images</p>
                                <p className="text-xs mt-2 text-slate-600">
                                    This is for review only — burst shots may be flagged
                                </p>
                                {!czkawkaStatus?.includes("found") && (
                                    <p className="text-yellow-500 mt-2">
                                        ⚠️ czkawka_cli is required. Install it first.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
