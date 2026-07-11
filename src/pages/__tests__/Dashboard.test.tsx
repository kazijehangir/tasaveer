import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, Mock } from 'vitest';
import { Dashboard } from '../Dashboard';
import * as tauriCore from '@tauri-apps/api/core';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tauri-apps/api/core')>();
    return {
        ...actual,
        invoke: vi.fn(),
    };
});

describe('Dashboard', () => {
    const mockInvoke = tauriCore.invoke as Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        mockInvoke.mockResolvedValue([]);
    });

    const renderDashboard = () => {
        return render(
            <BrowserRouter>
                <Dashboard />
            </BrowserRouter>
        );
    };

    it('renders welcome message', async () => {
        renderDashboard();
        expect(screen.getByText(/Welcome to/i)).toBeInTheDocument();
        expect(screen.getByText('Tasaveer')).toBeInTheDocument();
    });

    it('renders all workflow steps', () => {
        renderDashboard();
        expect(screen.getByText('Ingest')).toBeInTheDocument();
        expect(screen.getByText('Clean & Dedup')).toBeInTheDocument();
        expect(screen.getByText('Sync')).toBeInTheDocument();
    });

    it('renders correct links for workflow steps', () => {
        renderDashboard();

        const ingestLink = screen.getByRole('link', { name: /ingest/i });
        expect(ingestLink).toHaveAttribute('href', '/ingest');

        const cleanLink = screen.getByRole('link', { name: /clean/i });
        expect(cleanLink).toHaveAttribute('href', '/clean');

        const syncLink = screen.getByRole('link', { name: /sync/i });
        expect(syncLink).toHaveAttribute('href', '/sync');
    });

    it('displays empty state when no recent sessions exist', async () => {
        mockInvoke.mockResolvedValue([]);
        renderDashboard();

        await waitFor(() => {
            expect(screen.getByText('No recent activity')).toBeInTheDocument();
            expect(screen.getByText('Your import and sync history will appear here')).toBeInTheDocument();
        });
    });

    it('displays list of recent sessions', async () => {
        const mockSessions = [
            {
                id: 'session_1',
                started_at: '2026-07-11T12:00:00Z',
                finished_at: '2026-07-11T12:05:00Z',
                source_path: '/test/source1',
                source_label: 'Nikon SD Card',
                dest_path: '/test/dest1',
                backup_path: null,
                total_files: 10,
                imported: 8,
                skipped_duplicates: 2,
                skipped_no_date: 0,
                errors: 0,
                status: 'completed'
            }
        ];

        mockInvoke.mockResolvedValue(mockSessions);
        renderDashboard();

        await waitFor(() => {
            expect(screen.getByText('Import from Nikon SD Card')).toBeInTheDocument();
            expect(screen.getByText('/test/source1')).toBeInTheDocument();
            expect(screen.getByText('/test/dest1')).toBeInTheDocument();
            expect(screen.getByText('Imported')).toBeInTheDocument();
            expect(screen.getByText('8')).toBeInTheDocument();
            expect(screen.getByText('Duplicates')).toBeInTheDocument();
            expect(screen.getByText('2')).toBeInTheDocument();
        });
    });
});
