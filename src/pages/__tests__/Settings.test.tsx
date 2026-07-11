import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '../Settings';
import { load } from '@tauri-apps/plugin-store';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

// Get the mocked functions
const mockLoad = vi.mocked(load);
const mockOpen = openDialog as Mock;
const mockInvoke = invoke as Mock;
const mockRevealItemInDir = revealItemInDir as Mock;

vi.mock("@tauri-apps/plugin-dialog", () => ({
    open: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
}));

const defaultInvokeImpl = (cmd: string) => {
    if (cmd === 'verify_binary') {
        return Promise.resolve({ found: true, source: 'path', version: '1.0.0' });
    }
    if (cmd === 'validate_immich') {
        return Promise.resolve('Connected successfully!');
    }
    if (cmd === 'get_catalog_path') {
        return Promise.resolve('/Users/test/Library/Application Support/dev.kazi.tasaveer/catalog.sqlite');
    }
    if (cmd === 'get_catalog_stats') {
        return Promise.resolve({ total_files: 0, pending_backups: 0, last_import_at: null });
    }
    if (cmd === 'get_recent_sessions') {
        return Promise.resolve([]);
    }
    return Promise.resolve();
};

const renderSettings = () => {
    return render(
        <MemoryRouter>
            <Settings />
        </MemoryRouter>
    );
};

describe('Settings', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Configure mock store with test data
        const mockStore = {
            get: vi.fn((key: string) => {
                const data: Record<string, string> = {
                    archivePath: '/test/archive',
                    defaultSourcePath: '/test/source',
                    immichUrl: 'http://localhost:2283',
                    immichApiKey: 'test-api-key',
                    exiftoolPath: '',
                    immichGoPath: '',
                    czkawkaPath: '',
                };
                return Promise.resolve(data[key]);
            }),
            set: vi.fn(() => Promise.resolve()),
            save: vi.fn(() => Promise.resolve()),
        };

        mockLoad.mockResolvedValue(mockStore as unknown as Awaited<ReturnType<typeof load>>);
        mockOpen.mockResolvedValue(null);
        mockInvoke.mockImplementation(defaultInvokeImpl);
    });

    describe('Rendering', () => {
        it('renders the settings header', async () => {
            renderSettings();

            expect(screen.getByText('Settings')).toBeInTheDocument();
        });

        it('renders source configuration section', async () => {
            renderSettings();
            await waitFor(() => {
                expect(screen.getByText('Source Configuration')).toBeInTheDocument();
                expect(screen.getByText('Default Source Path')).toBeInTheDocument();
            });
        });

        it('renders archive configuration section', async () => {
            renderSettings();
            expect(screen.getByText('Archive Configuration')).toBeInTheDocument();
        });

        it('loads and displays saved settings', async () => {
            renderSettings();

            await waitFor(() => {
                expect(screen.getByDisplayValue('/test/archive')).toBeInTheDocument();
                expect(screen.getByDisplayValue('/test/source')).toBeInTheDocument();
            });
        });
    });

    describe('Form Interactions', () => {
        it('allows browsing for default source path', async () => {
            const user = userEvent.setup();
            mockOpen.mockResolvedValueOnce('/new/source/path');
            renderSettings();

            // Click Browse button for Source Configuration
            // There are multiple Browse buttons. The Source one is likely the first one after Source Config header.
            // Or we can find by associated label/input.
            // Let's use the layout order. Source is before Archive.
            await waitFor(() => expect(screen.getByDisplayValue('/test/source')).toBeInTheDocument());
            
            const buttons = screen.getAllByText('Browse');
            await user.click(buttons[0]); // Source is first now

            await waitFor(() => {
                expect(screen.getByDisplayValue('/new/source/path')).toBeInTheDocument();
                expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({
                    title: 'Select Default Source Folder'
                }));
            });
        });

        it('allows browsing for archive path', async () => {
            const user = userEvent.setup();
            mockOpen.mockResolvedValueOnce('/new/archive/path');
            renderSettings();

            await waitFor(() => expect(screen.getByDisplayValue('/test/archive')).toBeInTheDocument());
            
            const buttons = screen.getAllByText('Browse');
            await user.click(buttons[1]); // Archive is second

            await waitFor(() => {
                expect(screen.getByDisplayValue('/new/archive/path')).toBeInTheDocument();
                expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({
                    title: 'Select Archive Folder'
                }));
            });
        });
    });

    describe('Import Catalog Inspector', () => {
        it('is collapsed by default and does not fetch catalog data', async () => {
            renderSettings();

            await waitFor(() => expect(screen.getByText('Advanced: Import Catalog')).toBeInTheDocument());

            expect(screen.queryByTestId('catalog-path')).not.toBeInTheDocument();
            expect(mockInvoke).not.toHaveBeenCalledWith('get_catalog_stats', undefined);
        });

        it('lazily loads and displays stats and sessions on first expand', async () => {
            mockInvoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_catalog_stats') {
                    return Promise.resolve({ total_files: 42, pending_backups: 5, last_import_at: '2024-06-01T10:00:00Z' });
                }
                if (cmd === 'get_recent_sessions') {
                    return Promise.resolve([{
                        id: 'session-1',
                        started_at: '2024-06-01T10:00:00Z',
                        finished_at: '2024-06-01T10:05:00Z',
                        source_path: '/Volumes/NIKON/DCIM',
                        source_label: 'NIKON Z6',
                        dest_path: '/archive',
                        backup_path: null,
                        total_files: 10,
                        imported: 8,
                        skipped_duplicates: 2,
                        skipped_no_date: 0,
                        errors: 0,
                        status: 'complete',
                    }]);
                }
                return defaultInvokeImpl(cmd);
            });

            const user = userEvent.setup();
            renderSettings();

            await waitFor(() => expect(screen.getByText('Advanced: Import Catalog')).toBeInTheDocument());
            await user.click(screen.getByTestId('catalog-toggle'));

            await waitFor(() => {
                expect(screen.getByTestId('catalog-total-files')).toHaveTextContent('42');
                expect(screen.getByText('NIKON Z6')).toBeInTheDocument();
                expect(screen.getByText('complete')).toBeInTheDocument();
            });

            expect(mockInvoke).toHaveBeenCalledWith('get_recent_sessions', { limit: 10 });
        });

        it('reveals the catalog file in the system file manager', async () => {
            const user = userEvent.setup();
            renderSettings();

            await waitFor(() => expect(screen.getByText('Advanced: Import Catalog')).toBeInTheDocument());
            await user.click(screen.getByTestId('catalog-toggle'));

            await waitFor(() => expect(screen.getByTestId('catalog-path')).toHaveTextContent('catalog.sqlite'));

            await user.click(screen.getByText('Reveal in Finder'));

            await waitFor(() => {
                expect(mockRevealItemInDir).toHaveBeenCalledWith(
                    '/Users/test/Library/Application Support/dev.kazi.tasaveer/catalog.sqlite'
                );
            });
        });

        it('shows an error message if the catalog fails to load', async () => {
            mockInvoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_catalog_stats') {
                    return Promise.reject('Failed to open catalog db: disk full');
                }
                return defaultInvokeImpl(cmd);
            });

            const user = userEvent.setup();
            renderSettings();

            await waitFor(() => expect(screen.getByText('Advanced: Import Catalog')).toBeInTheDocument());
            await user.click(screen.getByTestId('catalog-toggle'));

            await waitFor(() => {
                expect(screen.getByText(/Failed to load catalog/)).toBeInTheDocument();
            });
        });
    });
});