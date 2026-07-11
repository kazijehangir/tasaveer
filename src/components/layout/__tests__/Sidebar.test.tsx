import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { useIngestStore } from '../../../store/ingestStore';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('Sidebar', () => {
    const mockOnTabChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset the ingest store
        useIngestStore.setState({ status: 'idle' });
    });

    it('renders navigation items and branding', () => {
        render(<Sidebar activeTab="dashboard" onTabChange={mockOnTabChange} />);
        
        expect(screen.getByText('Tasaveer')).toBeInTheDocument();
        expect(screen.getByText('Workflow')).toBeInTheDocument();
        
        expect(screen.getByText('Home')).toBeInTheDocument();
        expect(screen.getByText('Ingest')).toBeInTheDocument();
        expect(screen.getByText('Clean & Dedup')).toBeInTheDocument();
        expect(screen.getByText('Free Space')).toBeInTheDocument();
        expect(screen.getByText('Export')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('triggers onTabChange when navigation links are clicked', () => {
        render(<Sidebar activeTab="dashboard" onTabChange={mockOnTabChange} />);
        
        // Click Ingest tab
        fireEvent.click(screen.getByText('Ingest'));
        expect(mockOnTabChange).toHaveBeenCalledWith('ingest');
        
        // Click Clean & Dedup tab
        fireEvent.click(screen.getByText('Clean & Dedup'));
        expect(mockOnTabChange).toHaveBeenCalledWith('cleanup');

        // Click Free Space tab
        fireEvent.click(screen.getByText('Free Space'));
        expect(mockOnTabChange).toHaveBeenCalledWith('reconcile');

        // Click Export tab
        fireEvent.click(screen.getByText('Export'));
        expect(mockOnTabChange).toHaveBeenCalledWith('sync');

        // Click Settings tab
        fireEvent.click(screen.getByText('Settings'));
        expect(mockOnTabChange).toHaveBeenCalledWith('settings');
    });

    it('displays running indicator when ingest is processing', () => {
        // Set store state to copying
        useIngestStore.setState({ status: 'copying' });

        render(<Sidebar activeTab="dashboard" onTabChange={mockOnTabChange} />);

        const indicator = screen.getByTestId('ingest-running-indicator');
        expect(indicator).toBeInTheDocument();
        expect(indicator).toHaveAttribute('title', 'An ingest operation is running');
    });

    it('hides running indicator when ingest is idle', () => {
        useIngestStore.setState({ status: 'idle' });

        render(<Sidebar activeTab="dashboard" onTabChange={mockOnTabChange} />);

        expect(screen.queryByTestId('ingest-running-indicator')).not.toBeInTheDocument();
    });
});
