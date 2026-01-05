import '@testing-library/jest-dom/vitest';
import { vi, beforeAll, afterAll } from 'vitest';

// Mock Tauri core API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn((cmd: string, args?: unknown) => {
        switch (cmd) {
            case 'load_settings':
                return Promise.resolve('{}');
            case 'save_settings':
                return Promise.resolve();
            case 'find_zips':
                return Promise.resolve([]);
            case 'validate_immich':
                return Promise.resolve('Connected successfully!');
            case 'greet':
                return Promise.resolve(`Hello, ${(args as { name: string })?.name}!`);
            default:
                return Promise.reject(new Error(`Unknown command: ${cmd}`));
        }
    }),
}));

// Mock Tauri dialog plugin
vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(() => Promise.resolve(null)),
    save: vi.fn(() => Promise.resolve(null)),
    message: vi.fn(() => Promise.resolve()),
    ask: vi.fn(() => Promise.resolve(false)),
    confirm: vi.fn(() => Promise.resolve(false)),
}));

// Mock Tauri shell plugin
vi.mock('@tauri-apps/plugin-shell', () => {
    const createMockCommand = () => ({
        spawn: vi.fn(() =>
            Promise.resolve({
                pid: 12345,
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn(),
                kill: vi.fn(() => Promise.resolve()),
            })
        ),
        execute: vi.fn(() =>
            Promise.resolve({
                code: 0,
                signal: null,
                stdout: 'v1.0.0',
                stderr: '',
            })
        ),
    });

    return {
        Command: {
            create: vi.fn(createMockCommand),
            sidecar: vi.fn(createMockCommand),
        },
    };
});

// Mock Tauri opener plugin
vi.mock('@tauri-apps/plugin-opener', () => ({
    openUrl: vi.fn(() => Promise.resolve()),
    openPath: vi.fn(() => Promise.resolve()),
}));

// Suppress console errors during tests unless explicitly needed
const originalError = console.error;
beforeAll(() => {
    console.error = (...args: unknown[]) => {
        // Filter out React Router and testing library noise
        if (
            typeof args[0] === 'string' &&
            (args[0].includes('React Router') || args[0].includes('act(...)'))
        ) {
            return;
        }
        originalError.apply(console, args);
    };
});

afterAll(() => {
    console.error = originalError;
});
