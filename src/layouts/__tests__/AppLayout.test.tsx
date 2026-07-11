import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

        it('syncs active tab with pathname on load', () => {
            const { unmount } = renderWithRouter('/ingest');
            expect(screen.getByText('Ingest')).toHaveClass('bg-primary-100');
            unmount();

            const { unmount: unmountClean } = renderWithRouter('/clean');
            expect(screen.getByText('Clean & Dedup')).toHaveClass('bg-primary-100');
            unmountClean();

            const { unmount: unmountReconcile } = renderWithRouter('/reconcile');
            expect(screen.getByText('Free Space')).toHaveClass('bg-primary-100');
            unmountReconcile();

            const { unmount: unmountSync } = renderWithRouter('/sync');
            expect(screen.getByText('Export')).toHaveClass('bg-primary-100');
            unmountSync();

            const { unmount: unmountSettings } = renderWithRouter('/settings');
            expect(screen.getByText('Settings')).toHaveClass('bg-primary-100');
            unmountSettings();
        });

        it('navigates when clicking tabs', () => {
            renderWithRouter();

            // Click Ingest
            fireEvent.click(screen.getByText('Ingest'));
            expect(screen.getByText('Ingest')).toHaveClass('bg-primary-100');

            // Click Clean & Dedup
            fireEvent.click(screen.getByText('Clean & Dedup'));
            expect(screen.getByText('Clean & Dedup')).toHaveClass('bg-primary-100');

            // Click Free Space
            fireEvent.click(screen.getByText('Free Space'));
            expect(screen.getByText('Free Space')).toHaveClass('bg-primary-100');

            // Click Settings
            fireEvent.click(screen.getByText('Settings'));
            expect(screen.getByText('Settings')).toHaveClass('bg-primary-100');

            // Click Home
            fireEvent.click(screen.getByText('Home'));
            expect(screen.getByText('Home')).toHaveClass('bg-primary-100');
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
