import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '../Settings';
import { load } from '@tauri-apps/plugin-store';

// Get the mocked functions
const mockLoad = vi.mocked(load);

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn((cmd) => {
        if (cmd === 'verify_binary') {
            return Promise.resolve({ found: true, source: 'path', version: '1.0.0' });
        }
        if (cmd === 'validate_immich') {
            return Promise.resolve('Connected successfully!');
        }
        return Promise.resolve();
    }),
}));

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

        it('renders appearance section', async () => {
            renderSettings();

            expect(screen.getByText('Appearance')).toBeInTheDocument();
            expect(screen.getByText('Light Mode')).toBeInTheDocument();
            expect(screen.getByText('Dark Mode')).toBeInTheDocument();
        });

        it('renders dependency status cards', async () => {
            renderSettings();

            expect(screen.getByText('ExifTool')).toBeInTheDocument();
            expect(screen.getByText('Czkawka')).toBeInTheDocument();
            expect(screen.getByText('Immich-Go')).toBeInTheDocument();
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
        it('initializes store on mount', async () => {
            renderSettings();

            await waitFor(() => {
                expect(mockLoad).toHaveBeenCalledWith('settings.json');
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

        it('calls store.save when save button is clicked', async () => {
            const mockStore = {
                get: vi.fn(() => Promise.resolve('')),
                set: vi.fn(() => Promise.resolve()),
                save: vi.fn(() => Promise.resolve()),
            };
            mockLoad.mockResolvedValue(mockStore as unknown as Awaited<ReturnType<typeof load>>);

            const user = userEvent.setup();
            renderSettings();

            await waitFor(() => {
                expect(mockLoad).toHaveBeenCalled();
            });

            const saveButton = screen.getByRole('button', { name: /save/i });
            await user.click(saveButton);

            await waitFor(() => {
                expect(mockStore.save).toHaveBeenCalled();
            });
        });
    });

    describe('Edge Cases', () => {
        it('handles empty settings gracefully', async () => {
            const mockStore = {
                get: vi.fn(() => Promise.resolve(undefined)),
                set: vi.fn(() => Promise.resolve()),
                save: vi.fn(() => Promise.resolve()),
            };
            mockLoad.mockResolvedValue(mockStore as unknown as Awaited<ReturnType<typeof load>>);

            renderSettings();

            // Should render without errors even with empty settings
            expect(screen.getByText('Settings')).toBeInTheDocument();
            expect(screen.getByText('Archive Configuration')).toBeInTheDocument();
        });
    });

    describe('Appearance', () => {
        it('allows switching themes', async () => {
            const user = userEvent.setup();
            renderSettings();

            const darkBtn = screen.getByText('Dark Mode').closest('button')!;
            await user.click(darkBtn);
            expect(darkBtn).toHaveClass('border-primary-500');

            const lightBtn = screen.getByText('Light Mode').closest('button')!;
            await user.click(lightBtn);
            expect(lightBtn).toHaveClass('border-primary-500');
        });
    });

    describe('Immich Connection', () => {
        it('allows testing immich connection', async () => {
            const user = userEvent.setup();
            const { invoke } = await import('@tauri-apps/api/core');
            (invoke as Mock).mockImplementation((cmd) => {
                if (cmd === 'validate_immich') return Promise.resolve('Connected successfully!');
                if (cmd === 'verify_binary') return Promise.resolve({ found: true, source: 'path', version: '1.0.0' });
                return Promise.resolve();
            });

            renderSettings();

            await waitFor(() => expect(screen.getByDisplayValue('http://localhost:2283')).toBeInTheDocument());
            
            const testBtn = screen.getByText(/Test Connection/i);
            await user.click(testBtn);

            await waitFor(() => {
                expect(screen.getByText(/Connected successfully!/i)).toBeInTheDocument();
            });
        });

        it('shows error message if connection fails', async () => {
            const user = userEvent.setup();
            const { invoke } = await import('@tauri-apps/api/core');
            (invoke as Mock).mockImplementation((cmd) => {
                if (cmd === 'validate_immich') return Promise.reject('Network error');
                if (cmd === 'verify_binary') return Promise.resolve({ found: true, source: 'path', version: '1.0.0' });
                return Promise.resolve();
            });

            renderSettings();

            await waitFor(() => expect(screen.getByDisplayValue('http://localhost:2283')).toBeInTheDocument());
            
            const testBtn = screen.getByText(/Test Connection/i);
            await user.click(testBtn);

            await waitFor(() => {
                expect(screen.getByText(/Network error/i)).toBeInTheDocument();
            });
        });
    });

    describe('Advanced Settings', () => {
        it('renders custom binary path inputs', async () => {
            renderSettings();
            expect(screen.getByText('Advanced: Custom Binary Paths')).toBeInTheDocument();
            expect(screen.getByLabelText(/ExifTool Binary Path/i)).toBeInTheDocument();
        });

        it('allows clearing a custom path', async () => {
            const user = userEvent.setup();
            const mockStore = {
                get: vi.fn((key: string) => {
                    if (key === 'exiftoolPath') return Promise.resolve('/usr/bin/exiftool');
                    return Promise.resolve('');
                }),
                set: vi.fn(() => Promise.resolve()),
                save: vi.fn(() => Promise.resolve()),
            };
            mockLoad.mockResolvedValue(mockStore as any);

            renderSettings();

            await waitFor(() => {
                expect(screen.getByDisplayValue('/usr/bin/exiftool')).toBeInTheDocument();
            });

            const clearBtn = screen.getByTitle('Clear custom path');
            await user.click(clearBtn);

            await waitFor(() => {
                expect(screen.queryByDisplayValue('/usr/bin/exiftool')).not.toBeInTheDocument();
            });
        });
    });
});
