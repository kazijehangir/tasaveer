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

    // ... (rest of tests)
});