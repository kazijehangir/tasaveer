import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Clean } from '../Clean';
import { vi, Mock, describe, it, beforeEach, expect } from 'vitest';
import * as tauriCore from '@tauri-apps/api/core';
import * as tauriDialog from '@tauri-apps/plugin-dialog';

// Helper to mock invoke responses
const mockInvoke = tauriCore.invoke as Mock;
const mockOpen = tauriDialog.open as Mock;

// Mock convertFileSrc
vi.mock('@tauri-apps/api/core', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        convertFileSrc: (path: string) => `asset://${path}`,
        invoke: vi.fn(),
    };
});

describe('Clean Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default mock implementations
        const invoke = tauriCore.invoke as Mock;
        invoke.mockImplementation((cmd) => {
            switch (cmd) {
                case 'check_czkawka':
                    return Promise.resolve('czkawka_cli found: 0.0.1');
                case 'scan_missing_dates':
                    return Promise.resolve([]);
                case 'find_duplicates':
                    return Promise.resolve({ duplicates: [], total_groups: 0, total_wasted_space: 0 });
                case 'find_similar_images':
                    return Promise.resolve({ similar_groups: [], total_groups: 0 });
                default:
                    return Promise.resolve();
            }
        });

        mockOpen.mockResolvedValue(null);
    });

    it('renders initial state correctly', () => {
        render(<Clean />);
        expect(screen.getByText(/Clean &/i)).toBeInTheDocument();
        expect(screen.getByText(/Dedup/i)).toBeInTheDocument();
        // Check new tab names
        expect(screen.getByText(/Fix Dates/i)).toBeInTheDocument();
        // Find Duplicates appears as Tab and Action button
        const dupTexts = screen.getAllByText(/Find Duplicates/i);
        expect(dupTexts.length).toBeGreaterThan(0);
        expect(screen.getByText(/Similar Images/i)).toBeInTheDocument();
        
        // Check "Find Duplicates" is default (Exact Duplicates header should be visible)
        expect(screen.getByRole('heading', { name: /Exact Duplicates/i })).toBeInTheDocument();

        // Verify czkawka status is NOT visible in the path selection area
        expect(screen.queryByText(/czkawka_cli found/i)).not.toBeInTheDocument();
    });

    it('switches tabs correctly', () => {
        render(<Clean />);

        // Duplicates is default
        expect(screen.getByRole('heading', { name: /Exact Duplicates/i })).toBeInTheDocument();

        // Switch to Similar - Tab button
        fireEvent.click(screen.getByRole('button', { name: /Similar Images/i }));
        expect(screen.getByRole('heading', { name: /Similar Images/i })).toBeInTheDocument();

        // Switch to Fix Dates - Tab button
        fireEvent.click(screen.getByRole('button', { name: /Fix Dates/i }));
        expect(screen.getByRole('heading', { name: /Dates Fixer/i })).toBeInTheDocument();
    });

    it('enables scan button when path is selected', async () => {
        mockOpen.mockResolvedValue('/test/path');

        render(<Clean />);

        const changeButton = screen.getByText('Change');
        fireEvent.click(changeButton);

        await waitFor(() => {
            expect(screen.getByText('/test/path')).toBeInTheDocument();
        });

        // Scan button should be enabled
        const buttons = screen.getAllByRole('button', { name: /Find Duplicates/i });
        // The second one is the action button in the content area
        expect(buttons[1]).not.toBeDisabled();
    });

    it('displays metadata scan results', async () => {
        const mockResults = [
            {
                file_path: '/test/photo1.jpg',
                has_date: false,
                extracted_date: { date: '2023:01:01', time: '12:00:00', source: 'filename' },
                camera_model: null
            }
        ];

        mockInvoke.mockImplementation((cmd) => {
            if (cmd === 'check_czkawka') return Promise.resolve('found');
            if (cmd === 'scan_missing_dates') return Promise.resolve(mockResults);
            return Promise.resolve();
        });

        mockOpen.mockResolvedValue('/test/path');

        render(<Clean />);

        // Switch to Fix Dates
        fireEvent.click(screen.getByRole('button', { name: /Fix Dates/i }));

        // Select path
        fireEvent.click(screen.getByText('Change'));
        await waitFor(() => expect(screen.getByText('/test/path')).toBeInTheDocument());

        // Scan
        fireEvent.click(screen.getByText('Scan'));

        await waitFor(() => {
            expect(screen.getByText('photo1.jpg')).toBeInTheDocument();
            expect(screen.getByText('2023:01:01 12:00:00')).toBeInTheDocument();
        });
    });

    it('displays duplicate scan results', async () => {
        const mockDupResults = {
            total_groups: 1,
            total_wasted_space: 1024,
            duplicates: [
                {
                    size_bytes: 1024,
                    files: [
                        { path: '/test/file1.jpg', size: 1024, modified: '2023-01-01' },
                        { path: '/test/file1_copy.jpg', size: 1024, modified: '2023-01-01' }
                    ]
                }
            ]
        };

        mockInvoke.mockImplementation((cmd) => {
            if (cmd === 'check_czkawka') return Promise.resolve('czkawka_cli found');
            if (cmd === 'find_duplicates') return Promise.resolve(mockDupResults);
            return Promise.resolve();
        });

        mockOpen.mockResolvedValue('/test/path');

        render(<Clean />);

        // Default tab is duplicates

        // Select path
        fireEvent.click(screen.getByText('Change'));
        await waitFor(() => expect(screen.getByText('/test/path')).toBeInTheDocument());

        // Scan
        // We have two "Find Duplicates" buttons. The tab and the action button.
        // The action button is inside the card.
        // We can query by the text content specifically inside the main content area or just click all enabled ones?
        // Or finding the button that is NOT the active tab (which has specific classes).
        // Let's use `getAllByText` and click the last one (rendered later in DOM).
        const buttons = screen.getAllByText('Find Duplicates');
        fireEvent.click(buttons[buttons.length - 1]);

        await waitFor(() => {
            expect(screen.getByText('Found 1 duplicate groups')).toBeInTheDocument();
            expect(screen.getByText('/test/file1.jpg')).toBeInTheDocument();
            expect(screen.getByText('/test/file1_copy.jpg')).toBeInTheDocument();
        });
    });

    it('allows fixing metadata', async () => {
        const mockResults = [
            {
                file_path: '/test/photo1.jpg',
                has_date: false,
                extracted_date: { date: '2023-01-01', time: '12:00:00', source: 'filename' },
                camera_model: null
            }
        ];

        const invoke = tauriCore.invoke as Mock;
        invoke.mockImplementation((cmd) => {
            if (cmd === 'scan_missing_dates') return Promise.resolve(mockResults);
            if (cmd === 'write_exif_date_if_missing') return Promise.resolve('Success');
            return Promise.resolve();
        });

        mockOpen.mockResolvedValue('/test/path');
        render(<Clean />);

        // Switch to Fix Dates
        fireEvent.click(screen.getByRole('button', { name: /Fix Dates/i }));

        // Select path and scan
        fireEvent.click(screen.getByText('Change'));
        await waitFor(() => expect(screen.getByText('/test/path')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Scan'));

        await waitFor(() => expect(screen.getByText('photo1.jpg')).toBeInTheDocument());

        // Select the file
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[1]);

        const fixBtn = screen.getByText(/Fix 1 Selected/i);
        fireEvent.click(fixBtn);

        await waitFor(() => {
            expect(invoke).toHaveBeenCalledWith('write_exif_date_if_missing', expect.objectContaining({
                filePath: '/test/photo1.jpg',
                date: '2023-01-01'
            }));
        });
    });

    it('allows deleting selected duplicates', async () => {
        const mockDupResults = {
            total_groups: 1,
            total_wasted_space: 1024,
            duplicates: [
                {
                    size_bytes: 1024,
                    files: [
                        { path: '/test/file1.jpg', size: 1024, modified: '2023-01-01' },
                        { path: '/test/file1_copy.jpg', size: 1024, modified: '2023-01-01' }
                    ]
                }
            ]
        };

        const invoke = tauriCore.invoke as Mock;
        invoke.mockImplementation((cmd) => {
            if (cmd === 'check_czkawka') return Promise.resolve('found');
            if (cmd === 'find_duplicates') return Promise.resolve(mockDupResults);
            if (cmd === 'delete_to_trash') return Promise.resolve('Deleted 1 files');
            return Promise.resolve();
        });

        mockOpen.mockResolvedValue('/test/path');
        render(<Clean />);

        // Default tab is duplicates
        fireEvent.click(screen.getByText('Change'));
        await waitFor(() => expect(screen.getByText('/test/path')).toBeInTheDocument());
        
        const scanButtons = screen.getAllByText('Find Duplicates');
        fireEvent.click(scanButtons[scanButtons.length - 1]);

        await waitFor(() => expect(screen.getByText('/test/file1_copy.jpg')).toBeInTheDocument());

        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]); 

        const deleteBtn = screen.getByText(/Delete 1 to Trash/i);
        fireEvent.click(deleteBtn);

        await waitFor(() => {
            expect(invoke).toHaveBeenCalledWith('delete_to_trash', {
                files: ['/test/file1_copy.jpg']
            });
        });
    });

    it('displays similar images scan results', async () => {
        const mockSimilarResults = {
            total_groups: 1,
            similar_groups: [
                {
                    similarity: 95.5,
                    files: [
                        { path: '/test/img1.jpg', size: 2000, width: 1920, height: 1080, similarity: 0 },
                        { path: '/test/img1_small.jpg', size: 500, width: 640, height: 480, similarity: 5 }
                    ]
                }
            ]
        };

        const invoke = tauriCore.invoke as Mock;
        invoke.mockImplementation((cmd) => {
            if (cmd === 'check_czkawka') return Promise.resolve('found');
            if (cmd === 'find_similar_images') return Promise.resolve(mockSimilarResults);
            return Promise.resolve();
        });

        mockOpen.mockResolvedValue('/test/path');
        render(<Clean />);

        // Switch to similar
        fireEvent.click(screen.getByText(/Similar Images/i));
        fireEvent.click(screen.getByText('Change'));
        await waitFor(() => expect(screen.getByText('/test/path')).toBeInTheDocument());

        const scanButtons = screen.getAllByText(/Find Similar/i);
        fireEvent.click(scanButtons[0]); 

        await waitFor(() => {
            expect(screen.getByText('Found 1 groups of similar images')).toBeInTheDocument();
        });
    });
});