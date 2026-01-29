import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '../Settings';
import { load } from '@tauri-apps/plugin-store';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

// Get the mocked functions
const mockLoad = vi.mocked(load);
const mockOpen = openDialog as Mock;

vi.mock("@tauri-apps/plugin-dialog", () => ({
    open: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn((cmd: string) => {
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
});