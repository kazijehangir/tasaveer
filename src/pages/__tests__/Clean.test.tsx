import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Clean } from '../Clean';
import { vi, Mock } from 'vitest';
import * as tauriCore from '@tauri-apps/api/core';
import * as tauriDialog from '@tauri-apps/plugin-dialog';

// Helper to mock invoke responses
const mockInvoke = tauriCore.invoke as Mock;
const mockOpen = tauriDialog.open as Mock;

describe('Clean Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default mock implementations
        mockInvoke.mockImplementation((cmd) => {
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
        expect(screen.getByText(/Fix Metadata/i)).toBeInTheDocument();
        expect(screen.getByText(/Find Duplicates/i)).toBeInTheDocument();
    });

    it('switches tabs correctly', () => {
        render(<Clean />);

        // Metadata is default
        expect(screen.getByText(/Metadata Fixer/i)).toBeInTheDocument();

        // Switch to Duplicates - Tab button
        fireEvent.click(screen.getByRole('button', { name: /Find Duplicates/i }));
        expect(screen.getByRole('heading', { name: /Exact Duplicates/i })).toBeInTheDocument();

        // Switch to Similar - Tab button
        fireEvent.click(screen.getByRole('button', { name: /Similar Images/i }));
        expect(screen.getByRole('heading', { name: /Similar Images/i })).toBeInTheDocument();
    });

    it('enables scan button when path is selected', async () => {
        mockOpen.mockResolvedValue('/test/path');

        render(<Clean />);

        const changeButton = screen.getByText('Change');
        fireEvent.click(changeButton);

        await waitFor(() => {
            expect(screen.getByText('/test/path')).toBeInTheDocument();
        });

        // Scan button should be enabled (it renders differently when enabled)
        const scanButton = screen.getByText('Scan');
        expect(scanButton).not.toBeDisabled();
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

        // Switch to duplicates
        fireEvent.click(screen.getByText(/Find Duplicates/i));

        // Select path
        fireEvent.click(screen.getByText('Change'));
        await waitFor(() => expect(screen.getByText('/test/path')).toBeInTheDocument());

        // Scan - use the button that is notably the action button (second occurrence) or query by specific parent
        // The first one is the tab, the second one is the scan button
        const buttons = screen.getAllByText('Find Duplicates');
        fireEvent.click(buttons[1]);

        await waitFor(() => {
            expect(screen.getByText('Found 1 duplicate groups')).toBeInTheDocument();
            expect(screen.getByText('/test/file1.jpg')).toBeInTheDocument();
            expect(screen.getByText('/test/file1_copy.jpg')).toBeInTheDocument();
        });
    });
});
