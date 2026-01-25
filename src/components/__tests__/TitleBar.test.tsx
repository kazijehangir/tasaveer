import { render, screen, fireEvent } from '@testing-library/react';
import { TitleBar } from '../TitleBar';
import { vi } from 'vitest';

// Mock the Tauri window API
const mockMinimize = vi.fn();
const mockToggleMaximize = vi.fn();
const mockClose = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        minimize: mockMinimize,
        toggleMaximize: mockToggleMaximize,
        close: mockClose,
    }),
}));

describe('TitleBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders correctly with title', () => {
        render(<TitleBar />);
        expect(screen.getByText('Tasaveer')).toBeInTheDocument();
    });

    it('calls minimize when minimize button is clicked', () => {
        render(<TitleBar />);
        const minimizeButton = screen.getByLabelText('Minimize');
        fireEvent.click(minimizeButton);
        expect(mockMinimize).toHaveBeenCalledTimes(1);
    });

    it('calls toggleMaximize when maximize button is clicked', () => {
        render(<TitleBar />);
        const maximizeButton = screen.getByLabelText('Maximize');
        fireEvent.click(maximizeButton);
        expect(mockToggleMaximize).toHaveBeenCalledTimes(1);
    });

    it('calls close when close button is clicked', () => {
        render(<TitleBar />);
        const closeButton = screen.getByLabelText('Close');
        fireEvent.click(closeButton);
        expect(mockClose).toHaveBeenCalledTimes(1);
    });
});
