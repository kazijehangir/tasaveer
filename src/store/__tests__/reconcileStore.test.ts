import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useReconcileStore, ensureReconcileListeners } from '../reconcileStore';
import { listen } from '@tauri-apps/api/event';

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(),
}));

describe('reconcileStore', () => {
    const eventListeners: Record<string, Function> = {};

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Reset the store state manually since Zustand state persists across tests
        useReconcileStore.setState({
            laptopRoot: null,
            driveRoot: null,
            sdRoot: null,
            status: 'idle',
            operationId: null,
            logs: [],
            progress: null,
            report: null,
        });

        // Set up listen mock to collect registered event handlers
        vi.mocked(listen).mockImplementation((event, callback) => {
            eventListeners[event] = callback;
            return Promise.resolve(() => {});
        });
    });

    it('initializes with default values', () => {
        const state = useReconcileStore.getState();
        expect(state.laptopRoot).toBeNull();
        expect(state.driveRoot).toBeNull();
        expect(state.sdRoot).toBeNull();
        expect(state.status).toBe('idle');
        expect(state.operationId).toBeNull();
        expect(state.logs).toEqual([]);
        expect(state.progress).toBeNull();
        expect(state.report).toBeNull();
    });

    it('sets config paths correctly', () => {
        const store = useReconcileStore.getState();
        
        store.setLaptopRoot('/laptop');
        store.setDriveRoot('/drive');
        store.setSdRoot('/sd');

        const state = useReconcileStore.getState();
        expect(state.laptopRoot).toBe('/laptop');
        expect(state.driveRoot).toBe('/drive');
        expect(state.sdRoot).toBe('/sd');
    });

    it('handles basic actions', () => {
        const store = useReconcileStore.getState();
        
        store.setStatus('scanning');
        expect(useReconcileStore.getState().status).toBe('scanning');

        store.clearLogs();
        store.addLog('Test log message');
        expect(useReconcileStore.getState().logs[0]).toContain('Test log message');

        store.clearLogs();
        expect(useReconcileStore.getState().logs).toEqual([]);
    });

    it('handles operation state transitions', () => {
        const store = useReconcileStore.getState();
        
        store.beginOperation('backing_up', 'op-123');
        expect(useReconcileStore.getState().status).toBe('backing_up');
        expect(useReconcileStore.getState().operationId).toBe('op-123');
        expect(useReconcileStore.getState().progress).toBeNull();
        expect(useReconcileStore.getState().report).toBeNull();

        store.endOperation('success');
        expect(useReconcileStore.getState().status).toBe('success');
        expect(useReconcileStore.getState().operationId).toBeNull();
    });

    it('sets report correctly', () => {
        const mockReport = {
            folders: [],
            files: [],
            total_reclaimable_bytes: 100,
            total_at_risk_bytes: 200,
            laptop_root: '/laptop',
            drive_root: '/drive',
            sd_root: '/sd',
            warnings: [],
            sd_total_files: 0,
            sd_archived_files: 0,
            sd_pending_files: 0,
        };

        useReconcileStore.getState().setReport(mockReport);
        expect(useReconcileStore.getState().report).toEqual(mockReport);
    });

    it('registers tauri event listener and maps reconcile progress', () => {
        ensureReconcileListeners();
        expect(listen).toHaveBeenCalledWith('reconcile-progress', expect.any(Function));

        // Start operation so progress payload is accepted
        useReconcileStore.setState({ operationId: 'op-456' });

        const listener = eventListeners['reconcile-progress'];
        expect(listener).toBeDefined();

        // Send progress event for an unrelated operation (should be ignored)
        listener({
            payload: {
                id: 'op-unrelated',
                phase: 'backing_up',
                current: 2,
                total: 5,
                current_file: 'somefile.jpg',
            },
        });

        expect(useReconcileStore.getState().progress).toBeNull();

        // Send progress event for active operation (backing_up phase)
        listener({
            payload: {
                id: 'op-456',
                phase: 'backing_up',
                current: 2,
                total: 5,
                current_file: 'somefile.jpg',
            },
        });

        const state1 = useReconcileStore.getState();
        expect(state1.progress).toEqual({
            current: 2,
            total: 5,
            phase: 'backing_up',
            currentFile: 'somefile.jpg',
        });
        expect(state1.logs[0]).toContain('Backing up [3/5]: somefile.jpg');

        // Send progress event for active operation (deleting phase)
        listener({
            payload: {
                id: 'op-456',
                phase: 'deleting',
                current: 1,
                total: 10,
                current_file: 'old.jpg',
            },
        });

        const state2 = useReconcileStore.getState();
        expect(state2.progress?.phase).toBe('deleting');
        expect(state2.logs[1]).toContain('Trashing [2/10]: old.jpg');

        // Send progress event for active operation (deep_verifying phase)
        listener({
            payload: {
                id: 'op-456',
                phase: 'deep_verifying',
                current: 0,
                total: 2,
                current_file: 'verify.jpg',
            },
        });
        expect(useReconcileStore.getState().logs[2]).toContain('Verifying [1/2]: verify.jpg');

        // Send progress event for active operation (seeding phase)
        listener({
            payload: {
                id: 'op-456',
                phase: 'seeding',
                current: 0,
                total: 1,
                current_file: 'seed.jpg',
            },
        });
        expect(useReconcileStore.getState().logs[3]).toContain('Seeding [1/1]: seed.jpg');

        // Send scan state update (without count/index mapped logs)
        listener({
            payload: {
                id: 'op-456',
                phase: 'scanning',
                current: 0,
                total: 0,
                current_file: 'Scanning Laptop...',
            },
        });
        expect(useReconcileStore.getState().logs[4]).toContain('Scanning Laptop...');
    });
});
