import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Dashboard } from '../Dashboard';
import { vi } from 'vitest';

// Mock Settings component since it's used in Dashboard
vi.mock('../Settings', () => ({
    Settings: () => <div data-testid="settings-component">Settings Component</div>,
}));

describe('Dashboard', () => {
    const renderDashboard = () => {
        return render(
            <BrowserRouter>
                <Dashboard />
            </BrowserRouter>
        );
    };

    it('renders welcome message', () => {
        renderDashboard();
        expect(screen.getByText(/Welcome to/i)).toBeInTheDocument();
        expect(screen.getByText('Tasaveer')).toBeInTheDocument();
    });

    it('renders all workflow steps', () => {
        renderDashboard();
        expect(screen.getByText('Ingest')).toBeInTheDocument();
        expect(screen.getByText('Clean & Dedup')).toBeInTheDocument();
        expect(screen.getByText('Tag & Categorize')).toBeInTheDocument();
        expect(screen.getByText('Sync')).toBeInTheDocument();
    });

    it('renders correct links for workflow steps', () => {
        renderDashboard();

        const ingestLink = screen.getByRole('link', { name: /ingest/i });
        expect(ingestLink).toHaveAttribute('href', '/ingest');

        const cleanLink = screen.getByRole('link', { name: /clean/i });
        expect(cleanLink).toHaveAttribute('href', '/clean');

        const organizeLink = screen.getByRole('link', { name: /tag/i });
        expect(organizeLink).toHaveAttribute('href', '/organize');

        const syncLink = screen.getByRole('link', { name: /sync/i });
        expect(syncLink).toHaveAttribute('href', '/sync');
    });

    it('renders settings component', () => {
        renderDashboard();
        expect(screen.getByTestId('settings-component')).toBeInTheDocument();
    });
});
