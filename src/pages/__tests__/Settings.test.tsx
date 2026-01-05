import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '../Settings';
import { invoke } from '@tauri-apps/api/core';

// Get the mocked functions from the global setup
const mockInvoke = vi.mocked(invoke);

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

        // Configure mock implementations for settings tests
        mockInvoke.mockImplementation((cmd: string) => {
            switch (cmd) {
                case 'load_settings':
                    return Promise.resolve(JSON.stringify({
                        archivePath: '/test/archive',
                        immichUrl: 'http://localhost:2283',
                        immichApiKey: 'test-api-key',
                        phockupPath: '',
                        immichGoPath: '',
                    }));
                case 'save_settings':
                    return Promise.resolve(undefined);
                case 'validate_immich':
                    return Promise.resolve('Connected successfully!');
                default:
                    return Promise.resolve(undefined);
            }
        });
    });

    describe('Rendering', () => {
        it('renders the settings header', async () => {
            renderSettings();

            expect(screen.getByText('Settings')).toBeInTheDocument();
        });

        it('renders system prerequisites section', async () => {
            renderSettings();

            expect(screen.getByText('System Prerequisites')).toBeInTheDocument();
        });

        it('renders archive configuration section', async () => {
            renderSettings();

            expect(screen.getByText('Archive Configuration')).toBeInTheDocument();
        });

        it('renders immich server section', async () => {
            renderSettings();

            expect(screen.getByText('Immich Server')).toBeInTheDocument();
        });

        it('loads and displays saved settings', async () => {
            renderSettings();

            await waitFor(() => {
                const archiveInput = screen.getByDisplayValue('/test/archive');
                expect(archiveInput).toBeInTheDocument();
            });
        });
    });

    describe('Form Interactions', () => {
        it('calls invoke with load_settings on mount', async () => {
            renderSettings();

            await waitFor(() => {
                expect(mockInvoke).toHaveBeenCalledWith('load_settings');
            });
        });

        it('updates input values when typing', async () => {
            const user = userEvent.setup();
            renderSettings();

            await waitFor(() => {
                expect(screen.getByDisplayValue('http://localhost:2283')).toBeInTheDocument();
            });

            const urlInput = screen.getByDisplayValue('http://localhost:2283');
            await user.clear(urlInput);
            await user.type(urlInput, 'http://new-server:2283');

            expect(screen.getByDisplayValue('http://new-server:2283')).toBeInTheDocument();
        });
    });

    describe('Save Functionality', () => {
        it('renders save button', async () => {
            renderSettings();

            const saveButton = screen.getByRole('button', { name: /save/i });
            expect(saveButton).toBeInTheDocument();
        });

        it('calls save_settings when save button is clicked', async () => {
            const user = userEvent.setup();
            renderSettings();

            await waitFor(() => {
                expect(screen.getByDisplayValue('/test/archive')).toBeInTheDocument();
            });

            const saveButton = screen.getByRole('button', { name: /save/i });
            await user.click(saveButton);

            await waitFor(() => {
                expect(mockInvoke).toHaveBeenCalledWith('save_settings', expect.any(Object));
            });
        });
    });

    describe('Edge Cases', () => {
        it('handles empty settings gracefully', async () => {
            mockInvoke.mockImplementation((cmd: string) => {
                switch (cmd) {
                    case 'load_settings':
                        return Promise.resolve('{}');
                    default:
                        return Promise.resolve(undefined);
                }
            });

            renderSettings();

            // Should render without errors even with empty settings
            expect(screen.getByText('Settings')).toBeInTheDocument();
            expect(screen.getByText('Archive Configuration')).toBeInTheDocument();
        });
    });
});
