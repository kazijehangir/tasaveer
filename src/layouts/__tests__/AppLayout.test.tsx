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

            expect(screen.getByText('Home')).toBeInTheDocument();
            expect(screen.getByText('Ingest')).toBeInTheDocument();
            expect(screen.getByText('Clean')).toBeInTheDocument();
            expect(screen.getByText('Organize')).toBeInTheDocument();
            expect(screen.getByText('Sync')).toBeInTheDocument();
        });

        it('renders step badges for workflow steps', () => {
            renderWithRouter();

            // Step numbers 1-4 should be visible
            expect(screen.getByText('1')).toBeInTheDocument();
            expect(screen.getByText('2')).toBeInTheDocument();
            expect(screen.getByText('3')).toBeInTheDocument();
            expect(screen.getByText('4')).toBeInTheDocument();
        });

        it('renders branding elements', () => {
            renderWithRouter();

            expect(screen.getByText('Tasaveer')).toBeInTheDocument();
            expect(screen.getByText('Media Archive Manager')).toBeInTheDocument();
            expect(screen.getByAltText('Tasaveer Logo')).toBeInTheDocument();
        });

        it('renders version badge', () => {
            renderWithRouter();

            expect(screen.getByText('v0.1.0')).toBeInTheDocument();
        });

        it('highlights the active route', () => {
            renderWithRouter('/ingest');

            const ingestLink = screen.getByRole('link', { name: /Ingest/i });
            // Active link should have different styling (ring-1 ring-white/10)
            expect(ingestLink).toHaveClass('ring-1');
        });
    });

    describe('Routing', () => {
        it('links to correct paths', () => {
            renderWithRouter();

            expect(screen.getByRole('link', { name: /Home/i })).toHaveAttribute('href', '/');
            expect(screen.getByRole('link', { name: /1.*Ingest/i })).toHaveAttribute('href', '/ingest');
            expect(screen.getByRole('link', { name: /2.*Clean/i })).toHaveAttribute('href', '/clean');
            expect(screen.getByRole('link', { name: /3.*Organize/i })).toHaveAttribute('href', '/organize');
            expect(screen.getByRole('link', { name: /4.*Sync/i })).toHaveAttribute('href', '/sync');
        });
    });
});
