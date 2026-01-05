import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Ingest } from '../Ingest';
import { invoke } from '@tauri-apps/api/core';

// Get the mocked functions from the global setup
const mockInvoke = vi.mocked(invoke);

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

        mockInvoke.mockImplementation((cmd: string) => {
            switch (cmd) {
                case 'load_settings':
                    return Promise.resolve(JSON.stringify({
                        archivePath: '/test/archive',
                        phockupPath: '',
                        immichGoPath: '',
                    }));
                case 'find_zips':
                    return Promise.resolve(['takeout-1.zip', 'takeout-2.zip']);
                default:
                    return Promise.resolve(undefined);
            }
        });
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

        it('renders import strategy options when local is selected', () => {
            renderIngest();

            expect(screen.getByText('Copy')).toBeInTheDocument();
            expect(screen.getByText('Move')).toBeInTheDocument();
        });
    });

    describe('Source Selection', () => {
        it('starts with Local selected by default', () => {
            renderIngest();

            const localOption = screen.getByText('Local').closest('button');
            expect(localOption).toHaveClass('border-purple-500');
        });

        it('changes active source type when clicking different option', async () => {
            const user = userEvent.setup();
            renderIngest();

            const googleBtn = screen.getByText('Google').closest('button');
            if (googleBtn) {
                await user.click(googleBtn);
            }

            await waitFor(() => {
                const googleOption = screen.getByText('Google').closest('button');
                expect(googleOption).toHaveClass('border-blue-500');
            });
        });
    });

    describe('Import Strategy', () => {
        it('starts with Copy selected by default', () => {
            renderIngest();

            const copyBtn = screen.getByText('Copy').closest('button');
            expect(copyBtn).toHaveStyle({ borderColor: 'rgba(168, 85, 247, 1)' });
        });

        it('allows switching to Move strategy', async () => {
            const user = userEvent.setup();
            renderIngest();

            const moveBtn = screen.getByText('Move').closest('button');
            if (moveBtn) {
                await user.click(moveBtn);
            }

            await waitFor(() => {
                const moveBtnAfter = screen.getByText('Move').closest('button');
                expect(moveBtnAfter).toHaveStyle({ borderColor: 'rgba(59, 130, 246, 1)' });
            });
        });
    });

    describe('Path Selection', () => {
        it('loads default destination from settings', async () => {
            renderIngest();

            await waitFor(() => {
                expect(mockInvoke).toHaveBeenCalledWith('load_settings');
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

    describe('Log Panel', () => {
        it('renders the status section', () => {
            renderIngest();

            expect(screen.getByText('Status')).toBeInTheDocument();
        });

        it('shows ready message when idle', () => {
            renderIngest();

            expect(screen.getByText('Ready to ingest')).toBeInTheDocument();
        });
    });

    describe('Google Photos Mode', () => {
        it('hides import strategy when Google is selected', async () => {
            const user = userEvent.setup();
            renderIngest();

            const googleBtn = screen.getByText('Google').closest('button');
            if (googleBtn) {
                await user.click(googleBtn);
            }

            await waitFor(() => {
                // Import Strategy section should be replaced with Processing section
                expect(screen.getByText('Processing')).toBeInTheDocument();
            });
        });
    });
});
