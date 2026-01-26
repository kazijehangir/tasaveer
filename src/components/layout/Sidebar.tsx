import React, { useEffect, useState } from 'react';
import { Home, Layers, Folder, HardDrive, Settings, Upload, Sun, Moon } from 'lucide-react';

interface SidebarProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
    const menuItems = [
        { id: 'dashboard', label: 'Home', icon: Home },
        { id: 'ingest', label: 'Ingest', icon: HardDrive },
        { id: 'organize', label: 'Organize', icon: Folder },
        { id: 'cleanup', label: 'Clean & Dedup', icon: Layers },
        { id: 'sync', label: 'Export', icon: Upload },
    ];

    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    });

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    return (
        <div className="w-64 h-screen flex flex-col bg-surface backdrop-blur-xl border-r border-border fixed left-0 top-0 z-50">
            <div className="p-6">
                <div className="flex items-center gap-3 mb-8 px-2">
                    <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold shadow-md shadow-primary-500/20">
                        T
                    </div>
                    <span className="text-xl font-bold text-text-main tracking-tight">
                        Tasaveer
                    </span>
                </div>

                <div className="space-y-6">
                    <div>
                        <div className="text-xs font-bold text-text-main uppercase tracking-widest mb-4 px-3 opacity-80">
                            Workflow
                        </div>
                        <nav className="space-y-1">
                            {menuItems.map((item) => {
                                const isActive = activeTab === item.id;
                                const Icon = item.icon;

                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => onTabChange(item.id)}
                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group text-sm font-medium relative
                      ${isActive
                                                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
                                                : 'text-text-muted hover:text-text-main hover:bg-surface-hover'
                                            }`}
                                    >
                                        {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary-500 rounded-r-full" />}
                                        <Icon size={18} className={isActive ? 'text-primary-500' : 'text-text-muted group-hover:text-text-main'} />
                                        {item.label}
                                    </button>
                                );
                            })}
                        </nav>
                    </div>
                </div>
            </div>

            <div className="mt-auto p-4 border-t border-border">
                <button
                    onClick={() => onTabChange('settings')}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium mb-1
                        ${activeTab === 'settings'
                            ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
                            : 'text-text-muted hover:text-text-main hover:bg-surface-hover'
                        }`}
                >
                    <Settings size={18} className={activeTab === 'settings' ? 'text-primary-500' : 'text-text-muted group-hover:text-text-main'} />
                    Settings
                </button>

                <button
                    onClick={toggleTheme}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-hover transition-all text-sm font-medium"
                >
                    {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
                    <span className="ml-2">{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
                </button>
            </div>
        </div>
    );
};
