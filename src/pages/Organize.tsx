import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
    Tag,
    Camera,
    Plus,
    Trash2,
    Search,
    CheckCircle2,
    AlertCircle,
    FolderOpen,
    Save,
    Edit2,
} from "lucide-react";

// Types for source tagging
interface SourceTag {
    id: string;
    name: string;
    color: string;
    cameraAliases: string[]; // Camera models that map to this tag
}

interface CameraModelGroup {
    model: string;
    count: number;
    assignedTag: string | null;
}

// Matches Rust's FileMetadataInfo (snake_case serialization)
interface FileMetadataInfo {
    file_path: string;
    has_date: boolean;
    extracted_date: { date: string; time: string | null; source: string } | null;
    camera_model: string | null;
}

// Predefined colors for tags
const TAG_COLORS = [
    "#ef4444", // red
    "#f97316", // orange
    "#eab308", // yellow
    "#22c55e", // green
    "#14b8a6", // teal
    "#3b82f6", // blue
    "#8b5cf6", // violet
    "#ec4899", // pink
];

export function Organize() {
    const [archivePath, setArchivePath] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Source tags state
    const [sourceTags, setSourceTags] = useState<SourceTag[]>([]);
    const [newTagName, setNewTagName] = useState("");
    const [editingTag, setEditingTag] = useState<string | null>(null);

    // Camera model scan results
    const [cameraModels, setCameraModels] = useState<CameraModelGroup[]>([]);
    const [scannedFiles, setScannedFiles] = useState<FileMetadataInfo[]>([]);

    // Load settings and tags on mount
    useEffect(() => {
        async function loadData() {
            try {
                const settingsStr = await invoke<string>("load_settings");
                if (settingsStr) {
                    const settings = JSON.parse(settingsStr);
                    if (settings.archivePath) {
                        setArchivePath(settings.archivePath);
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

    // Save tags when they change
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

    const handleAddTag = () => {
        if (!newTagName.trim()) return;

        const newTag: SourceTag = {
            id: `tag_${Date.now()}`,
            name: newTagName.trim(),
            color: TAG_COLORS[sourceTags.length % TAG_COLORS.length],
            cameraAliases: [],
        };

        const updatedTags = [...sourceTags, newTag];
        setSourceTags(updatedTags);
        saveTags(updatedTags);
        setNewTagName("");
    };

    const handleDeleteTag = (tagId: string) => {
        const updatedTags = sourceTags.filter((t) => t.id !== tagId);
        setSourceTags(updatedTags);
        saveTags(updatedTags);
    };

    const handleUpdateTagName = (tagId: string, newName: string) => {
        const updatedTags = sourceTags.map((t) =>
            t.id === tagId ? { ...t, name: newName } : t
        );
        setSourceTags(updatedTags);
        saveTags(updatedTags);
        setEditingTag(null);
    };

    const handleScanCameraModels = async () => {
        if (!archivePath) return;
        setIsScanning(true);
        setError(null);
        setCameraModels([]);

        try {
            console.log("Scanning camera models in:", archivePath);
            const results = await invoke<FileMetadataInfo[]>("scan_missing_dates", {
                path: archivePath,
            });
            console.log("Scan returned", results.length, "files");

            setScannedFiles(results);

            // Group by camera model
            const modelCounts = new Map<string, number>();
            for (const file of results) {
                const model = file.camera_model || "Unknown";
                modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
            }
            console.log("Found camera models:", Array.from(modelCounts.keys()));

            // Convert to array and find existing tag assignments
            const groups: CameraModelGroup[] = [];
            modelCounts.forEach((count, model) => {
                // Check if this model is already aliased to a tag
                const assignedTag = sourceTags.find((t) =>
                    t.cameraAliases.includes(model)
                );
                groups.push({
                    model,
                    count,
                    assignedTag: assignedTag?.name || null,
                });
            });

            // Sort by count descending
            groups.sort((a, b) => b.count - a.count);
            setCameraModels(groups);
        } catch (err) {
            console.error("Camera model scan failed:", err);
            setError(`Scan failed: ${err}`);
        } finally {
            setIsScanning(false);
        }
    };

    const handleAssignModelToTag = (model: string, tagId: string | null) => {
        // Remove model from all tags first
        let updatedTags = sourceTags.map((t) => ({
            ...t,
            cameraAliases: t.cameraAliases.filter((m) => m !== model),
        }));

        // Add to the selected tag
        if (tagId) {
            updatedTags = updatedTags.map((t) =>
                t.id === tagId
                    ? { ...t, cameraAliases: [...t.cameraAliases, model] }
                    : t
            );
        }

        setSourceTags(updatedTags);
        saveTags(updatedTags);

        // Update camera models display
        setCameraModels((prev) =>
            prev.map((cm) =>
                cm.model === model
                    ? {
                        ...cm,
                        assignedTag: tagId
                            ? updatedTags.find((t) => t.id === tagId)?.name || null
                            : null,
                    }
                    : cm
            )
        );
    };

    const handleApplyTags = async () => {
        if (scannedFiles.length === 0) return;
        setIsScanning(true);
        setError(null);

        let applied = 0;
        let errors = 0;

        for (const file of scannedFiles) {
            const model = file.camera_model || "Unknown";
            const tag = sourceTags.find((t) => t.cameraAliases.includes(model));

            if (tag) {
                try {
                    await invoke("write_exif_keywords", {
                        filePath: file.file_path,
                        keywords: [tag.name],
                    });
                    applied++;
                } catch (err) {
                    console.error(`Failed to tag ${file.file_path}:`, err);
                    errors++;
                }
            }
        }

        setIsScanning(false);

        if (errors > 0) {
            setError(`Applied ${applied} tags, ${errors} errors`);
        } else {
            setError(null);
            // Show success somehow
            alert(`Successfully applied tags to ${applied} files!`);
        }
    };

    const filesWithAssignedTags = scannedFiles.filter((f) => {
        const model = f.camera_model || "Unknown";
        return sourceTags.some((t) => t.cameraAliases.includes(model));
    }).length;

    return (
        <div className="space-y-8 animate-fade-in pb-20">
            {/* Header */}
            <div>
                <h1 className="text-4xl font-bold mb-2">
                    Tag & <span className="gradient-text">Categorize</span>
                </h1>
                <p className="text-slate-400 text-lg">
                    Organize your photos by source using camera model detection and EXIF keywords
                </p>
            </div>

            {/* Error Display */}
            {error && (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                    <div className="flex-1">
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
                        <div className="p-3 rounded-lg bg-pink-500/20">
                            <FolderOpen className="w-6 h-6 text-pink-400" />
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
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Source Tags Management */}
                <div className="glass-card p-6">
                    <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                        <Tag className="w-5 h-5 text-pink-400" />
                        Source Tags
                    </h2>
                    <p className="text-sm text-slate-500 mb-4">
                        Define categories for organizing your media (e.g., "Family Camera", "Personal Phone")
                    </p>

                    {/* Add new tag */}
                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                            placeholder="New tag name..."
                            className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:border-pink-500 focus:outline-none"
                        />
                        <button
                            onClick={handleAddTag}
                            disabled={!newTagName.trim()}
                            className="px-3 py-2 rounded-lg bg-pink-500/20 text-pink-400 hover:bg-pink-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Plus className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Tag list */}
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                        {sourceTags.length === 0 ? (
                            <div className="text-center py-8 text-slate-500">
                                <Tag className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                <p className="text-sm">No tags yet. Add one above!</p>
                            </div>
                        ) : (
                            sourceTags.map((tag) => (
                                <div
                                    key={tag.id}
                                    className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 border border-slate-700"
                                >
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="w-4 h-4 rounded-full"
                                            style={{ backgroundColor: tag.color }}
                                        />
                                        {editingTag === tag.id ? (
                                            <input
                                                type="text"
                                                defaultValue={tag.name}
                                                autoFocus
                                                onBlur={(e) =>
                                                    handleUpdateTagName(tag.id, e.target.value)
                                                }
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        handleUpdateTagName(
                                                            tag.id,
                                                            e.currentTarget.value
                                                        );
                                                    } else if (e.key === "Escape") {
                                                        setEditingTag(null);
                                                    }
                                                }}
                                                className="px-2 py-1 rounded bg-slate-700 border border-slate-600 text-sm"
                                            />
                                        ) : (
                                            <>
                                                <span className="font-medium">{tag.name}</span>
                                                {tag.cameraAliases.length > 0 && (
                                                    <span className="text-xs text-slate-500">
                                                        ({tag.cameraAliases.length} models)
                                                    </span>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setEditingTag(tag.id)}
                                            className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteTag(tag.id)}
                                            className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Camera Model Detection */}
                <div className="glass-card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <Camera className="w-5 h-5 text-teal-400" />
                                Camera Models
                            </h2>
                            <p className="text-sm text-slate-500 mt-1">
                                Scan your archive to detect camera models and assign them to tags
                            </p>
                        </div>
                        <button
                            onClick={handleScanCameraModels}
                            disabled={!archivePath || isScanning}
                            className="btn-primary px-4 py-2 flex items-center gap-2"
                        >
                            <Search className="w-4 h-4" />
                            {isScanning ? "Scanning..." : "Scan"}
                        </button>
                    </div>

                    {/* Scan summary */}
                    {scannedFiles.length > 0 && (
                        <div className="text-sm text-slate-400 mb-2">
                            Found <span className="text-white font-medium">{scannedFiles.length.toLocaleString()}</span> media files across{" "}
                            <span className="text-white font-medium">{cameraModels.length}</span> camera models
                        </div>
                    )}

                    {/* Camera models list */}
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                        {cameraModels.length === 0 ? (
                            <div className="text-center py-8 text-slate-500">
                                <Camera className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                <p className="text-sm">
                                    {archivePath
                                        ? "Click Scan to detect camera models"
                                        : "Select an archive path first"}
                                </p>
                            </div>
                        ) : (
                            cameraModels.map((cm) => (
                                <div
                                    key={cm.model}
                                    className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 border border-slate-700"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate" title={cm.model}>
                                            {cm.model}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {cm.count} files
                                        </p>
                                    </div>
                                    <select
                                        value={
                                            sourceTags.find((t) =>
                                                t.cameraAliases.includes(cm.model)
                                            )?.id || ""
                                        }
                                        onChange={(e) =>
                                            handleAssignModelToTag(
                                                cm.model,
                                                e.target.value || null
                                            )
                                        }
                                        className="px-3 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-sm focus:border-teal-500 focus:outline-none"
                                    >
                                        <option value="">Unassigned</option>
                                        {sourceTags.map((tag) => (
                                            <option key={tag.id} value={tag.id}>
                                                {tag.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Apply Tags Section */}
            {cameraModels.length > 0 && (
                <div className="glass-card p-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-green-500/20">
                                <CheckCircle2 className="w-6 h-6 text-green-400" />
                            </div>
                            <div>
                                <p className="font-medium">
                                    Ready to Apply Tags
                                </p>
                                <p className="text-sm text-slate-500">
                                    {filesWithAssignedTags} of {scannedFiles.length} files
                                    have assigned tags
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleApplyTags}
                            disabled={filesWithAssignedTags === 0 || isScanning}
                            className="btn-primary px-6 py-2 flex items-center gap-2"
                        >
                            <Save className="w-4 h-4" />
                            Apply Tags to EXIF
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
