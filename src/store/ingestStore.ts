import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';

// Ingest operation state lives in this module-level store (not component
// state) so that navigating away from the Ingest page does not lose track of
// a running operation: the Rust command keeps executing regardless of which
// tab is visible, and this store is what lets the UI reflect that when the
// user returns. The Tauri event listeners are likewise registered once for
// the app's lifetime instead of being torn down on page unmount.

export type IngestStatus =
    | 'idle'
    | 'scanning'
    | 'previewing'
    | 'copying'
    | 'tagging'
    | 'organizing'
    | 'success'
    | 'error';

export type IngestType = 'local' | 'google-photos' | 'icloud';

export const isProcessingStatus = (status: IngestStatus): boolean =>
    ['scanning', 'previewing', 'copying', 'tagging', 'organizing'].includes(status);

export interface CameraModelGroup {
    model: string;
    count: number;
    assignedTag: string | null;
}

export interface DirectoryGroup {
    directory: string;
    count: number;
    assignedTag: string | null;
}

export interface FileOrganizeResult {
    source_path: string;
    dest_path: string | null;
    status: string;
    message: string | null;
}

export interface OrganizePreview {
    files: FileOrganizeResult[];
    total_files: number;
    will_organize: number;
    will_skip: number;
    duplicates: number;
    already_imported: number;
}

export interface OrganizeResult {
    total_files: number;
    organized: number;
    skipped: number;
    duplicates: number;
    errors: number;
}

export interface IngestProgress {
    current: number;
    total: number;
    currentFile: string;
    phase: string;
}

interface OrganizeProgressEvent {
    id: string;
    current: number;
    total: number;
    current_file: string;
    status: string;
}

interface TagProgressEvent {
    id: string;
    current: number;
    total: number;
    message: string;
}

interface IngestState {
    // Session config
    ingestType: IngestType;
    sourcePath: string | null;
    destPath: string | null;
    selectedStrategy: 'copy' | 'move';
    enableTagging: boolean;

    // Operation state
    status: IngestStatus;
    operationId: string | null;
    cancelRequested: boolean;
    logs: string[];
    progress: IngestProgress | null;

    // Results
    previewData: OrganizePreview | null;
    isScanned: boolean;
    cameraModels: CameraModelGroup[];
    directoryGroups: DirectoryGroup[];

    // Actions
    setIngestType: (t: IngestType) => void;
    setSourcePath: (p: string | null) => void;
    setDestPath: (p: string | null) => void;
    setSelectedStrategy: (s: 'copy' | 'move') => void;
    setEnableTagging: (v: boolean) => void;
    setStatus: (s: IngestStatus) => void;
    setPreviewData: (p: OrganizePreview | null) => void;
    setIsScanned: (v: boolean) => void;
    setCameraModels: (groups: CameraModelGroup[]) => void;
    setDirectoryGroups: (groups: DirectoryGroup[]) => void;
    addLog: (msg: string) => void;
    clearLogs: () => void;
    /** Mark an operation as started: sets status, remembers the operation id
     *  (needed for cancellation) and resets cancel/progress state. */
    beginOperation: (status: IngestStatus, operationId: string) => void;
    /** Mark the current operation as finished with a terminal status. */
    endOperation: (status: IngestStatus) => void;
    requestCancel: () => void;
}

export const useIngestStore = create<IngestState>((set) => ({
    ingestType: 'local',
    sourcePath: null,
    destPath: null,
    selectedStrategy: 'copy',
    enableTagging: true,

    status: 'idle',
    operationId: null,
    cancelRequested: false,
    logs: [],
    progress: null,

    previewData: null,
    isScanned: false,
    cameraModels: [],
    directoryGroups: [],

    setIngestType: (ingestType) => set({ ingestType }),
    setSourcePath: (sourcePath) => set({ sourcePath }),
    setDestPath: (destPath) => set({ destPath }),
    setSelectedStrategy: (selectedStrategy) => set({ selectedStrategy }),
    setEnableTagging: (enableTagging) => set({ enableTagging }),
    setStatus: (status) => set({ status }),
    setPreviewData: (previewData) => set({ previewData }),
    setIsScanned: (isScanned) => set({ isScanned }),
    setCameraModels: (cameraModels) => set({ cameraModels }),
    setDirectoryGroups: (directoryGroups) => set({ directoryGroups }),
    addLog: (msg) =>
        set((state) => ({
            logs: [...state.logs, `[${new Date().toLocaleTimeString()}] ${msg}`],
        })),
    clearLogs: () => set({ logs: [] }),
    beginOperation: (status, operationId) =>
        set({ status, operationId, cancelRequested: false, progress: null }),
    endOperation: (status) => set({ status, operationId: null }),
    requestCancel: () => set({ cancelRequested: true }),
}));

// App-lifetime Tauri event listeners. Registered once (guarded) and never torn
// down, so progress from a backend operation reaches the store even while the
// Ingest page is unmounted.
let listenersInitialized = false;

export function ensureIngestListeners(): void {
    if (listenersInitialized) return;
    listenersInitialized = true;

    listen<OrganizeProgressEvent>('organize-progress', (event) => {
        const { operationId } = useIngestStore.getState();
        if (!operationId || event.payload.id !== operationId) return;
        const { current, total, current_file, status } = event.payload;
        useIngestStore.setState({
            progress: { current, total, currentFile: current_file, phase: status },
        });
    }).catch((err) => console.error('Failed to listen for organize-progress:', err));

    listen<TagProgressEvent>('tag-progress', (event) => {
        if (event.payload.id === 'tag_staged_files') {
            const { current, total, message } = event.payload;
            useIngestStore.getState().addLog(`[Tagging ${current}/${total}] ${message}`);
        }
    }).catch((err) => console.error('Failed to listen for tag-progress:', err));
}
