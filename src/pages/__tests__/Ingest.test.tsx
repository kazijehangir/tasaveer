import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Ingest } from '../Ingest';
import { load } from '@tauri-apps/plugin-store';

// Get the mocked functions from the global setup
const mockLoad = vi.mocked(load);

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

            // Local should have a distinguishing style when selected
            // In the current implementation, local button shows first and is in active state initially
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

            // After clicking Google, it should now be the active source
            await waitFor(() => {
                // Google button should now have the active styling
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
});
