import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useUIStore } from '../uiStore';
import { load } from '@tauri-apps/plugin-store';

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(),
}));

describe('uiStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset the store state manually since zustand state persists across tests
        useUIStore.setState({ theme: 'light' });
    });

    it('initializes with default theme', () => {
        const state = useUIStore.getState();
        expect(state.theme).toBe('light');
    });

    it('updates theme and saves to store', async () => {
        const mockStore = {
            set: vi.fn(),
            save: vi.fn(),
        };
        (load as any).mockResolvedValue(mockStore);

        await useUIStore.getState().setTheme('dark');

        expect(useUIStore.getState().theme).toBe('dark');
        expect(mockStore.set).toHaveBeenCalledWith('theme', 'dark');
        expect(mockStore.save).toHaveBeenCalled();
    });

    it('initializes theme from store', async () => {
        const mockStore = {
            get: vi.fn().mockResolvedValue('dark'),
        };
        (load as any).mockResolvedValue(mockStore);

        await useUIStore.getState().initTheme();

        expect(useUIStore.getState().theme).toBe('dark');
        expect(mockStore.get).toHaveBeenCalledWith('theme');
    });

    it('falls back to system preference if no saved theme', async () => {
        const mockStore = {
            get: vi.fn().mockResolvedValue(null),
        };
        (load as any).mockResolvedValue(mockStore);

        // Mock matchMedia
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation(query => ({
                matches: query === '(prefers-color-scheme: dark)',
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });

        await useUIStore.getState().initTheme();

        expect(useUIStore.getState().theme).toBe('dark');
    });

    it('handles theme saving errors gracefully', async () => {
        (load as any).mockRejectedValue(new Error('Failed to load store'));
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await useUIStore.getState().setTheme('dark');

        expect(useUIStore.getState().theme).toBe('dark');
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });

    it('handles theme initialization errors and falls back to system preference', async () => {
        (load as any).mockRejectedValue(new Error('Failed to load store'));
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock matchMedia for dark mode fallback
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation(query => ({
                matches: query === '(prefers-color-scheme: dark)',
                media: query,
            })),
        });

        await useUIStore.getState().initTheme();

        expect(useUIStore.getState().theme).toBe('dark');
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });
});
