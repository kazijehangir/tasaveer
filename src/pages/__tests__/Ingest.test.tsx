import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Ingest } from '../Ingest';
import { load } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

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

        // Configure mock store with test data
        const mockStore = {
            get: vi.fn((key: string) => {
                const data: Record<string, string | unknown> = {
                    archivePath: '/test/archive',
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

        it('renders source type options', () => {
            renderIngest();

            expect(screen.getByText('Local')).toBeInTheDocument();
            expect(screen.getByText('Google')).toBeInTheDocument();
            expect(screen.getByText('iCloud')).toBeInTheDocument();
        });

        it('renders the status section', () => {
            renderIngest();

            expect(screen.getByText('Status')).toBeInTheDocument();
        });
    });

    describe('Source Selection', () => {
        it('starts with Local as initial source type', () => {
            renderIngest();

            const localButton = screen.getByText('Local').closest('button');
            expect(localButton).toBeInTheDocument();
        });

        it('allows switching between source types', async () => {
            const user = userEvent.setup();
            renderIngest();

            const googleBtn = screen.getByText('Google').closest('button');
            if (googleBtn) {
                await user.click(googleBtn);
            }

            await waitFor(() => {
                const googleOption = screen.getByText('Google').closest('button');
                expect(googleOption).toHaveClass('border-primary-500');
            });
        });
    });

    describe('Path Selection', () => {
        it('loads default destination from settings', async () => {
            renderIngest();

            await waitFor(() => {
                expect(mockLoad).toHaveBeenCalledWith('settings.json');
            });
        });
    });

    describe('Ingest Button State', () => {
        it('disables start button when paths are not set', () => {
            renderIngest();

            const startButton = screen.getByRole('button', { name: /start import/i });
            expect(startButton).toBeDisabled();
        });
    });

    describe('Tagging Panel', () => {
        it('renders the assign tags section', () => {
            renderIngest();

            expect(screen.getByText('Assign Tags')).toBeInTheDocument();
        });

        it('has enable tagging toggle', () => {
            renderIngest();

            expect(screen.getByText(/Enable Tagging/i)).toBeInTheDocument();
        });
    });

    describe('Preview Functionality', () => {
        it('enables preview button when paths are set', async () => {
            const user = userEvent.setup();
            mockOpen.mockResolvedValueOnce('/test/source');
            renderIngest();

            await user.click(screen.getByText(/Browse Folder/i));
            await waitFor(() => {
                expect(screen.getByText(/Preview/i)).not.toBeDisabled();
            });
        });

        it('calls preview_organize and displays summary', async () => {
            const user = userEvent.setup();
            mockOpen.mockResolvedValueOnce('/test/source');
            renderIngest();

            await user.click(screen.getByText(/Browse Folder/i));
            await waitFor(() => expect(screen.getByText(/Preview/i)).toBeInTheDocument());

            await user.click(screen.getByText(/Preview/i));

            const summaryHeading = await screen.findByText(/Preview Summary/i);
            expect(summaryHeading).toBeInTheDocument();

            expect(mockInvoke).toHaveBeenCalledWith('preview_organize', {
                sourcePath: '/test/source',
                destPath: '/test/archive'
            });

            const summaryContainer = summaryHeading.closest('div');
            expect(within(summaryContainer!).getByText('7')).toBeInTheDocument();
            expect(within(summaryContainer!).getByText('2')).toBeInTheDocument();
            expect(within(summaryContainer!).getByText('1')).toBeInTheDocument();
        });

        it('resets preview data when source path changes', async () => {
            const user = userEvent.setup();
            mockOpen.mockResolvedValueOnce('/test/source');
            renderIngest();

            await user.click(screen.getByText(/Browse Folder/i));
            await waitFor(() => expect(screen.getByText(/Preview/i)).toBeInTheDocument());
            await user.click(screen.getByText(/Preview/i));

            await screen.findByText(/Preview Summary/i);

            // Change source - this clears the path
            await user.click(screen.getByText(/Change/i));

            // Re-select source to trigger the update
            mockOpen.mockResolvedValueOnce('/test/source-new');
            await user.click(screen.getByText(/Browse Folder/i));

            // Wait for UI to update path
            await waitFor(() => {
                expect(screen.getByTestId('source-path-display')).toHaveTextContent(/source-new/);
            });

            await waitFor(() => {
                expect(screen.queryByText(/Preview Summary/i)).not.toBeInTheDocument();
            });
        });

        it('resets preview data when destination path changes', async () => {
            const user = userEvent.setup();
            mockOpen.mockResolvedValueOnce('/test/source');
            renderIngest();

            await user.click(screen.getByText(/Browse Folder/i));
            await waitFor(() => expect(screen.getByText(/Preview/i)).toBeInTheDocument());
            await user.click(screen.getByText(/Preview/i));

            await screen.findByText(/Preview Summary/i);

            // Change destination
            mockOpen.mockResolvedValueOnce('/test/archive-new');
            const destButtons = screen.getAllByText('...');
            await user.click(destButtons[0]);

            // Wait for UI to update path
            await waitFor(() => {
                expect(screen.getByTestId('dest-path-display')).toHaveTextContent(/archive-new/);
            });

            await waitFor(() => {
                expect(screen.queryByText(/Preview Summary/i)).not.toBeInTheDocument();
            });
        });
    });
});
