import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';

type Theme = 'light' | 'dark';

interface UIState {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    initTheme: () => Promise<void>;
}

export const useUIStore = create<UIState>((set) => ({
    theme: 'light',
    setTheme: async (theme) => {
        set({ theme });
        try {
            const store = await load('settings.json');
            await store.set('theme', theme);
            await store.save();
        } catch (err) {
            console.error('Failed to save theme to store:', err);
        }
    },
    initTheme: async () => {
        try {
            const store = await load('settings.json');
            const savedTheme = await store.get<Theme>('theme');
            if (savedTheme) {
                set({ theme: savedTheme });
            } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                set({ theme: 'dark' });
            }
        } catch (err) {
            console.error('Failed to initialize theme from store:', err);
            // Fallback to system preference
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                set({ theme: 'dark' });
            }
        }
    },
}));
