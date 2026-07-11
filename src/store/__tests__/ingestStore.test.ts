import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useIngestStore, ensureIngestListeners, isProcessingStatus } from '../ingestStore';
import { listen } from '@tauri-apps/api/event';

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(),
}));

describe('ingestStore', () => {
    const eventListeners: Record<string, Function> = {};

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Reset store state manually since Zustand state persists across tests
        useIngestStore.setState({
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
        });

        // Set up listen mock to collect registered event handlers
        vi.mocked(listen).mockImplementation((event, callback) => {
            eventListeners[event] = callback;
            return Promise.resolve(() => {});
        });
    });

    it('identifies processing status correctly', () => {
        expect(isProcessingStatus('scanning')).toBe(true);
        expect(isProcessingStatus('previewing')).toBe(true);
        expect(isProcessingStatus('copying')).toBe(true);
        expect(isProcessingStatus('tagging')).toBe(true);
        expect(isProcessingStatus('organizing')).toBe(true);
        expect(isProcessingStatus('idle')).toBe(false);
        expect(isProcessingStatus('success')).toBe(false);
        expect(isProcessingStatus('error')).toBe(false);
    });

    it('sets session config values correctly', () => {
        const store = useIngestStore.getState();

        store.setIngestType('google-photos');
        store.setSourcePath('/src');
        store.setDestPath('/dst');
        store.setSelectedStrategy('move');
        store.setEnableTagging(false);

        const state = useIngestStore.getState();
        expect(state.ingestType).toBe('google-photos');
        expect(state.sourcePath).toBe('/src');
        expect(state.destPath).toBe('/dst');
        expect(state.selectedStrategy).toBe('move');
        expect(state.enableTagging).toBe(false);
    });

    it('manages operation state and results correctly', () => {
        const store = useIngestStore.getState();

        store.setStatus('copying');
        expect(useIngestStore.getState().status).toBe('copying');

        const mockPreview = {
            files: [],
            total_files: 5,
            will_organize: 4,
            will_skip: 1,
            duplicates: 0,
            already_imported: 0,
        };
        store.setPreviewData(mockPreview);
        expect(useIngestStore.getState().previewData).toEqual(mockPreview);

        store.setIsScanned(true);
        expect(useIngestStore.getState().isScanned).toBe(true);

        const mockModels = [{ model: 'Nikon D850', count: 10, assignedTag: 'D850' }];
        store.setCameraModels(mockModels);
        expect(useIngestStore.getState().cameraModels).toEqual(mockModels);

        const mockDirs = [{ directory: 'DCIM', count: 5, assignedTag: 'DCIM' }];
        store.setDirectoryGroups(mockDirs);
        expect(useIngestStore.getState().directoryGroups).toEqual(mockDirs);
    });

    it('handles logs operations', () => {
        const store = useIngestStore.getState();
        
        store.addLog('Log 1');
        store.addLog('Log 2');
        expect(useIngestStore.getState().logs.length).toBe(2);
        expect(useIngestStore.getState().logs[0]).toContain('Log 1');

        store.clearLogs();
        expect(useIngestStore.getState().logs).toEqual([]);
    });

    it('handles operation state transitions', () => {
        const store = useIngestStore.getState();

        store.beginOperation('copying', 'ingest-789');
        expect(useIngestStore.getState().status).toBe('copying');
        expect(useIngestStore.getState().operationId).toBe('ingest-789');
        expect(useIngestStore.getState().cancelRequested).toBe(false);
        expect(useIngestStore.getState().progress).toBeNull();

        store.requestCancel();
        expect(useIngestStore.getState().cancelRequested).toBe(true);

        store.endOperation('success');
        expect(useIngestStore.getState().status).toBe('success');
        expect(useIngestStore.getState().operationId).toBeNull();
    });

    it('registers tauri event listeners and maps progress and tags events', () => {
        ensureIngestListeners();
        expect(listen).toHaveBeenCalledWith('organize-progress', expect.any(Function));
        expect(listen).toHaveBeenCalledWith('tag-progress', expect.any(Function));

        // Start operation so progress payload is accepted
        useIngestStore.setState({ operationId: 'ingest-op' });

        const organizeListener = eventListeners['organize-progress'];
        const tagListener = eventListeners['tag-progress'];

        expect(organizeListener).toBeDefined();
        expect(tagListener).toBeDefined();

        // 1. Send organize progress event for active operation
        organizeListener({
            payload: {
                id: 'ingest-op',
                current: 2,
                total: 10,
                current_file: 'pic.jpg',
                status: 'copying',
            },
        });

        const state1 = useIngestStore.getState();
        expect(state1.progress).toEqual({
            current: 2,
            total: 10,
            currentFile: 'pic.jpg',
            phase: 'copying',
        });

        // 2. Send organize progress event for an unrelated operation (should be ignored)
        organizeListener({
            payload: {
                id: 'other-op',
                current: 5,
                total: 10,
                current_file: 'pic2.jpg',
                status: 'copying',
            },
        });
        expect(useIngestStore.getState().progress?.currentFile).toBe('pic.jpg');

        // 3. Send tag progress event for tag_staged_files operation
        tagListener({
            payload: {
                id: 'tag_staged_files',
                current: 1,
                total: 3,
                message: 'Applying tags to pic.jpg',
            },
        });
        expect(useIngestStore.getState().logs[0]).toContain('[Tagging 1/3] Applying tags to pic.jpg');

        // 4. Send tag progress event for unrelated tag id (should be ignored)
        tagListener({
            payload: {
                id: 'tag_unrelated',
                current: 2,
                total: 3,
                message: 'Applying tags to another.jpg',
            },
        });
        expect(useIngestStore.getState().logs.length).toBe(1);
    });
});
