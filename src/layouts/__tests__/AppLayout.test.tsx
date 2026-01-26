import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from '../AppLayout';

// Helper to render with router context
const renderWithRouter = (initialRoute = '/') => {
    return render(
        <MemoryRouter initialEntries={[initialRoute]}>
            <AppLayout />
        </MemoryRouter>
    );
};

describe('AppLayout', () => {
    describe('Navigation', () => {
        it('renders all navigation items', () => {
            renderWithRouter();

            // Sidebar uses "Home" for dashboard
            expect(screen.getByText('Home')).toBeInTheDocument();
            expect(screen.getByText('Ingest')).toBeInTheDocument();
            expect(screen.getByText('Clean & Dedup')).toBeInTheDocument();
            expect(screen.getByText('Export')).toBeInTheDocument();
        });

        it('renders branding elements', () => {
            renderWithRouter();

            expect(screen.getByText('Tasaveer')).toBeInTheDocument();
            expect(screen.getByText('Workflow')).toBeInTheDocument();
        });

        it('renders settings and theme toggle buttons', () => {
            renderWithRouter();

            expect(screen.getByText('Settings')).toBeInTheDocument();

        });
    });

    describe('Layout', () => {
        it('renders main content area', () => {
            renderWithRouter();

            // Main content area should exist
            expect(screen.getByRole('main')).toBeInTheDocument();
        });
    });
});
