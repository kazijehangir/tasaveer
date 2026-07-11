import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';

export type ReconcileStatus =
    | 'idle'
    | 'scanning'
    | 'backing_up'
    | 'deleting'
    | 'deep_verifying'
    | 'seeding'
    | 'success'
    | 'error';

export interface FolderSummary {
    folder: string;
    laptop_count: number;
    drive_count: number;
    sd_count: number;
    safe_to_free_count: number;
    safe_to_free_bytes: number;
    at_risk_count: number;
    at_risk_bytes: number;
}

export interface FileStatus {
    rel_path: string;
    file_name: string;
    size: number;
    on_laptop: boolean;
    on_drive: boolean;
    on_sd: boolean;
    classification: 'SafeToFree' | 'AtRisk' | 'DriveOnly' | 'SdOnly';
}

export interface ReconcileReport {
    folders: FolderSummary[];
    files: FileStatus[];
    total_reclaimable_bytes: number;
    total_at_risk_bytes: number;
    laptop_root: string;
    drive_root: string | null;
    sd_root: string | null;
    warnings: string[];
}

export interface ReconcileProgress {
    current: number;
    total: number;
    phase: string;
    currentFile: string;
}

interface ReconcileProgressEvent {
    id: string;
    phase: string;
    current: number;
    total: number;
    current_file: string;
}

interface ReconcileState {
    // Config paths
    laptopRoot: string | null;
    driveRoot: string | null;
    sdRoot: string | null;

    // Operation states
    status: ReconcileStatus;
    operationId: string | null;
    logs: string[];
    progress: ReconcileProgress | null;
    report: ReconcileReport | null;

    // Actions
    setLaptopRoot: (path: string | null) => void;
    setDriveRoot: (path: string | null) => void;
    setSdRoot: (path: string | null) => void;
    setStatus: (status: ReconcileStatus) => void;
    addLog: (msg: string) => void;
    clearLogs: () => void;
    beginOperation: (status: ReconcileStatus, operationId: string) => void;
    endOperation: (status: ReconcileStatus) => void;
    setReport: (report: ReconcileReport | null) => void;
}

export const useReconcileStore = create<ReconcileState>((set) => ({
    laptopRoot: null,
    driveRoot: null,
    sdRoot: null,

    status: 'idle',
    operationId: null,
    logs: [],
    progress: null,
    report: null,

    setLaptopRoot: (laptopRoot) => set({ laptopRoot }),
    setDriveRoot: (driveRoot) => set({ driveRoot }),
    setSdRoot: (sdRoot) => set({ sdRoot }),
    setStatus: (status) => set({ status }),
    addLog: (msg) =>
        set((state) => ({
            logs: [...state.logs, `[${new Date().toLocaleTimeString()}] ${msg}`],
        })),
    clearLogs: () => set({ logs: [] }),
    beginOperation: (status, operationId) =>
        set({ status, operationId, progress: null, report: null }),
    endOperation: (status) => set({ status, operationId: null }),
    setReport: (report) => set({ report }),
}));

let listenersInitialized = false;

export function ensureReconcileListeners(): void {
    if (listenersInitialized) return;
    listenersInitialized = true;

    listen<ReconcileProgressEvent>('reconcile-progress', (event) => {
        const { operationId, addLog } = useReconcileStore.getState();
        if (!operationId || event.payload.id !== operationId) return;

        const { phase, current, total, current_file } = event.payload;

        useReconcileStore.setState({
            progress: {
                current,
                total,
                phase,
                currentFile: current_file,
            },
        });

        // Map phase status updates to log entries
        if (current_file && current_file !== 'Scanning Laptop...' && current_file !== 'Scanning Google Drive...' && current_file !== 'Scanning SD Card...') {
            if (phase === 'backing_up') {
                addLog(`Backing up [${current + 1}/${total}]: ${current_file}`);
            } else if (phase === 'deleting') {
                addLog(`Trashing [${current + 1}/${total}]: ${current_file}`);
            } else if (phase === 'deep_verifying') {
                addLog(`Verifying [${current + 1}/${total}]: ${current_file}`);
            } else if (phase === 'seeding') {
                addLog(`Seeding [${current + 1}/${total}]: ${current_file}`);
            }
        } else if (current_file) {
            addLog(current_file);
        }
    }).catch((err) => console.error('Failed to listen for reconcile-progress:', err));
}
