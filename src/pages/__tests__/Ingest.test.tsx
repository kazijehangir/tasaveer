import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Ingest } from '../Ingest';
import { load } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useIngestStore } from '../../store/ingestStore';

// Get the mocked functions from the global setup
const mockLoad = vi.mocked(load);
const mockInvoke = invoke as Mock;
const mockOpen = open as Mock;

const renderIngest = () => {
    return render(
        <MemoryRouter>
            <Ingest />
        </MemoryRouter>
    );
};

describe('Ingest', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // The ingest store is module-level (it deliberately survives page
        // unmounts), so tests must reset it to stay independent.
        useIngestStore.setState(useIngestStore.getInitialState(), true);

        // Configure mock store with test data
        const mockStore = {
            get: vi.fn((key: string) => {
                const data: Record<string, string | unknown> = {
                    archivePath: '/test/archive',
                    defaultSourcePath: '/test/default-source', // Mock default source
                };
                return Promise.resolve(data[key]);
            }),
            set: vi.fn(() => Promise.resolve()),
            save: vi.fn(() => Promise.resolve()),
        };

        mockLoad.mockResolvedValue(mockStore as unknown as Awaited<ReturnType<typeof load>>);
        mockInvoke.mockImplementation((cmd) => {
            if (cmd === 'preview_organize') {
                return Promise.resolve({
                    total_files: 10,
                    will_organize: 7,
                    will_skip: 2,
                    duplicates: 1,
                    already_imported: 0,
                    files: []
                });
            }
            return Promise.resolve();
        });
        mockOpen.mockResolvedValue(null);
    });

    describe('Rendering', () => {
        it('renders the ingest header', () => {
            renderIngest();

            expect(screen.getByText('Media')).toBeInTheDocument();
            expect(screen.getByText(/Import photos and videos/i)).toBeInTheDocument();
        });
    });

    describe('Path Selection', () => {
        it('loads default destination from settings', async () => {
            renderIngest();

            await waitFor(() => {
                expect(screen.getByTestId('dest-path-display')).toHaveTextContent('/test/archive');
            });
        });

        it('loads default source path from settings', async () => {
            renderIngest();

            await waitFor(() => {
                expect(screen.getByTestId('source-path-display')).toHaveTextContent('/test/default-source');
                expect(mockLoad).toHaveBeenCalledWith('settings.json');
            });
        });

        it('allows manually changing source path overriding default', async () => {
            const user = userEvent.setup();
            renderIngest();

            await waitFor(() => {
                expect(screen.getByTestId('source-path-display')).toHaveTextContent('/test/default-source');
            });

            // Click change source
            mockOpen.mockResolvedValueOnce('/test/new-source');
            // Find the "Change" button in the source card
            const changeBtn = screen.getByRole('button', { name: /Change/i });
            await user.click(changeBtn);

            await waitFor(() => {
                expect(screen.getByTestId('source-path-display')).toHaveTextContent('/test/new-source');
                expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({
                    title: 'Select Source Folder'
                }));
            });
        });
    });

    describe('Operation persistence across navigation', () => {
        it('keeps a running import visible after unmount and remount', async () => {
            let resolveIngest!: (value: unknown) => void;
            mockInvoke.mockImplementation((cmd) => {
                if (cmd === 'run_unified_ingest') {
                    return new Promise((resolve) => { resolveIngest = resolve; });
                }
                return Promise.resolve();
            });

            const user = userEvent.setup();
            const { unmount } = renderIngest();

            await waitFor(() => {
                expect(screen.getByTestId('source-path-display')).toHaveTextContent('/test/default-source');
                expect(screen.getByTestId('dest-path-display')).toHaveTextContent('/test/archive');
            });

            await user.click(screen.getByRole('button', { name: /Start Import/i }));
            await waitFor(() => {
                expect(screen.getByText(/Processing/)).toBeInTheDocument();
            });

            // Simulate navigating to another tab and back: the page unmounts,
            // but the backend operation keeps running.
            unmount();
            renderIngest();

            // The remounted page must still show the running operation.
            expect(screen.getByText(/Processing/)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Cancel Operation/i })).toBeInTheDocument();
            expect(screen.getByText(/Starting unified ingest/)).toBeInTheDocument();

            // When the backend finishes, the remounted page shows the result
            // even though the original invoking component is long gone.
            resolveIngest({ total_files: 3, organized: 3, skipped: 0, duplicates: 0, errors: 0 });
            await waitFor(() => {
                expect(screen.getByText(/All operations completed/)).toBeInTheDocument();
            });
        });

        it('does not allow starting a second import while one is running after remount', async () => {
            mockInvoke.mockImplementation((cmd) => {
                if (cmd === 'run_unified_ingest') {
                    return new Promise(() => { /* never resolves */ });
                }
                return Promise.resolve();
            });

            const user = userEvent.setup();
            const { unmount } = renderIngest();

            await waitFor(() => {
                expect(screen.getByTestId('dest-path-display')).toHaveTextContent('/test/archive');
            });

            await user.click(screen.getByRole('button', { name: /Start Import/i }));
            await waitFor(() => expect(screen.getByText(/Processing/)).toBeInTheDocument());

            unmount();
            renderIngest();

            // The import button must still be disabled on the fresh mount,
            // and exactly one ingest must have been started.
            expect(screen.getByRole('button', { name: /Processing/i })).toBeDisabled();
            const ingestCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'run_unified_ingest');
            expect(ingestCalls).toHaveLength(1);
        });

        it('preserves scan results across unmount and remount', async () => {
            mockInvoke.mockImplementation((cmd) => {
                if (cmd === 'scan_missing_dates') {
                    return Promise.resolve([
                        { file_path: '/test/default-source/DSC_0001.NEF', has_date: true, extracted_date: null, camera_model: 'NIKON Z6' },
                        { file_path: '/test/default-source/DSC_0002.NEF', has_date: true, extracted_date: null, camera_model: 'NIKON Z6' },
                    ]);
                }
                return Promise.resolve();
            });

            const user = userEvent.setup();
            const { unmount } = renderIngest();

            await waitFor(() => {
                expect(screen.getByTestId('source-path-display')).toHaveTextContent('/test/default-source');
            });

            await user.click(screen.getByRole('button', { name: /Scan for Tags/i }));
            await waitFor(() => {
                expect(screen.getByText('NIKON Z6')).toBeInTheDocument();
                expect(screen.getByText(/Scanned/)).toBeInTheDocument();
            });

            unmount();
            renderIngest();

            expect(screen.getByText('NIKON Z6')).toBeInTheDocument();
            expect(screen.getByText(/Scanned/)).toBeInTheDocument();
        });
    });
});