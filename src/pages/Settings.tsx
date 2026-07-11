import { FolderOpen, HardDrive, Server, Key, Package, XCircle, CheckCircle2, Save, RefreshCw, AlertTriangle, ExternalLink, Sun, Moon, Database, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { load, type Store } from "@tauri-apps/plugin-store";
import { useUIStore } from "../store/uiStore";

interface CatalogStats {
  total_files: number;
  pending_backups: number;
  last_import_at: string | null;
}

interface ImportSession {
  id: string;
  started_at: string;
  finished_at: string | null;
  source_path: string;
  source_label: string | null;
  dest_path: string;
  backup_path: string | null;
  total_files: number;
  imported: number;
  skipped_duplicates: number;
  skipped_no_date: number;
  errors: number;
  status: string;
}

interface SettingsData {
  archivePath: string;
  defaultSourcePath: string;
  immichUrl: string;
  immichApiKey: string;
  // Custom binary path overrides (empty = use bundled/PATH)
  exiftoolPath: string;
  immichGoPath: string;
  czkawkaPath: string;
}

interface ValidationStatus {
  exiftool: boolean;
  exiftoolSource: 'custom' | 'path' | 'none';
  czkawka: boolean;
  czkawkaSource: 'custom' | 'path' | 'none';
  immichGo: boolean;
  immichGoSource: 'custom' | 'bundled' | 'path' | 'none';
  checking: boolean;
}

export function Settings() {
  const { theme, setTheme } = useUIStore();
  const [settings, setSettings] = useState<SettingsData>({
    archivePath: "",
    defaultSourcePath: "",
    immichUrl: "",
    immichApiKey: "",
    exiftoolPath: "",
    immichGoPath: "",
    czkawkaPath: "",
  });
  const [validation, setValidation] = useState<ValidationStatus>({
    exiftool: false,
    exiftoolSource: 'none',
    czkawka: false,
    czkawkaSource: 'none',
    immichGo: false,
    immichGoSource: 'none',
    checking: true,
  });
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const storeRef = useRef<Store | null>(null);

  useEffect(() => {
    initStore();
    checkPrerequisites();
  }, []);

  const initStore = async () => {
    try {
      // Load store with auto-save enabled (default behavior)
      const store = await load('settings.json');
      storeRef.current = store;
      await loadSettings();
    } catch (err) {
      console.error('Failed to initialize settings store:', err);
    }
  };

  const loadSettings = async () => {
    const store = storeRef.current;
    if (!store) return;

    try {
      const loaded: Partial<SettingsData> = {};
      for (const key of Object.keys(settings) as (keyof SettingsData)[]) {
        const value = await store.get<string>(key);
        if (value !== undefined && value !== null) {
          loaded[key] = value;
        }
      }
      if (Object.keys(loaded).length > 0) {
        setSettings(prev => ({ ...prev, ...loaded }));
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const checkPrerequisites = async () => {
    setValidation(prev => ({ ...prev, checking: true }));

    const check = async (name: string) => {
      try {
        return await invoke<{ found: boolean, source: string, version: string | null }>("verify_binary", { name });
      } catch (e) {
        console.error(`Failed to check ${name}:`, e);
        return { found: false, source: 'none', version: null };
      }
    };

    const exiftoolRes = await check("exiftool");
    const czkawkaRes = await check("czkawka");
    const immichGoRes = await check("immich-go");

    setValidation({
      exiftool: exiftoolRes.found,
      exiftoolSource: exiftoolRes.source as any,
      czkawka: czkawkaRes.found,
      czkawkaSource: czkawkaRes.source as any,
      immichGo: immichGoRes.found,
      immichGoSource: immichGoRes.source as any,
      checking: false,
    });
  };

  const handleBrowsePath = async (key: keyof SettingsData, title: string) => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title,
      });
      if (selected) {
        setSettings(prev => ({ ...prev, [key]: selected as string }));
      }
    } catch (err) {
      console.error("Failed to select directory", err);
    }
  };

  const handleChange = (key: keyof SettingsData, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const store = storeRef.current;
    if (!store) {
      setSaveMessage({ type: 'error', text: "Settings store not initialized." });
      return;
    }

    setSaving(true);
    setSaveMessage(null);
    try {
      // Save each setting as individual key
      for (const [key, value] of Object.entries(settings)) {
        await store.set(key, value);
      }
      await store.save(); // Force immediate save
      setSaveMessage({ type: 'success', text: "Settings saved successfully!" });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
      setSaveMessage({ type: 'error', text: "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  };

  // Import catalog inspector - collapsed by default, loaded lazily on first expand
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogPath, setCatalogPath] = useState<string | null>(null);
  const [catalogStats, setCatalogStats] = useState<CatalogStats | null>(null);
  const [catalogSessions, setCatalogSessions] = useState<ImportSession[]>([]);

  const loadCatalogInfo = async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [path, stats, sessions] = await Promise.all([
        invoke<string>("get_catalog_path"),
        invoke<CatalogStats>("get_catalog_stats"),
        invoke<ImportSession[]>("get_recent_sessions", { limit: 10 }),
      ]);
      setCatalogPath(path);
      setCatalogStats(stats);
      setCatalogSessions(sessions);
    } catch (err) {
      console.error("Failed to load catalog info:", err);
      setCatalogError(err as string);
    } finally {
      setCatalogLoading(false);
    }
  };

  const handleToggleCatalog = () => {
    const next = !catalogExpanded;
    setCatalogExpanded(next);
    if (next && !catalogStats) {
      loadCatalogInfo();
    }
  };

  const handleRevealCatalog = async () => {
    if (!catalogPath) return;
    try {
      await revealItemInDir(catalogPath);
    } catch (err) {
      console.error("Failed to reveal catalog file:", err);
    }
  };

  const [connectionStatus, setConnectionStatus] = useState<{ type: 'success' | 'error' | 'idle', message: string }>({ type: 'idle', message: '' });

  const handleTestConnection = async () => {
    if (!settings.immichUrl || !settings.immichApiKey) {
      setConnectionStatus({ type: 'error', message: "Please enter both URL and API Key." });
      return;
    }

    setConnectionStatus({ type: 'idle', message: 'Testing connection...' });

    try {
      const result = await invoke<string>("validate_immich", {
        url: settings.immichUrl,
        apiKey: settings.immichApiKey
      });
      setConnectionStatus({ type: 'success', message: result });
    } catch (err) {
      setConnectionStatus({ type: 'error', message: err as string });
    }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold mb-2">
          Settings
        </h2>
        <p className="text-text-muted font-medium">
          Configure external tools and connections
        </p>
      </div>

      {/* Appearance Configuration */}
      <div className="glass-card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary-500/20">
            <Sun className="w-5 h-5 text-primary-400" />
          </div>
          <h2 className="text-2xl font-bold">Appearance</h2>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-muted">
              Application Theme
            </label>
            <p className="text-sm text-text-muted mb-4">
              Choose between light and dark mode for the interface
            </p>

            <div className="flex gap-4">
              <button
                onClick={() => setTheme('light')}
                className={`flex-1 flex items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all
                  ${theme === 'light'
                    ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20 text-text-main'
                    : 'border-border bg-surface hover:border-text-muted text-text-muted hover:text-text-main'}`}
              >
                <Sun className="w-5 h-5" />
                <span className="font-semibold">Light Mode</span>
              </button>

              <button
                onClick={() => setTheme('dark')}
                className={`flex-1 flex items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all
                  ${theme === 'dark'
                    ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20 text-text-main'
                    : 'border-border bg-surface hover:border-text-muted text-text-muted hover:text-text-main'}`}
              >
                <Moon className="w-5 h-5" />
                <span className="font-semibold">Dark Mode</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Dependencies Section (Moved to Top) */}
      <div className="glass-card p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <Package className="w-5 h-5 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold">System Prerequisites</h2>
          </div>
          <button
            onClick={checkPrerequisites}
            disabled={validation.checking}
            className="p-2 hover:bg-surface-hover rounded-lg text-text-muted hover:text-text-main transition-colors"
            title="Recheck dependencies"
          >
            <RefreshCw className={`w-5 h-5 ${validation.checking ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-4">
          {/* ExifTool Status */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-secondary">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/20">
                <Package className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">ExifTool</h3>
                  <button
                    onClick={() => openUrl("https://exiftool.org/")}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-0.5"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Website
                  </button>
                </div>
                <p className="text-sm text-text-muted font-medium">Metadata read/write utility (Required)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {validation.checking ? (
                <span className="text-text-muted text-sm">Checking...</span>
              ) : validation.exiftool ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-green-500 font-medium">
                    {validation.exiftoolSource === 'custom' ? 'Custom' : 'PATH'}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-500" />
                  <span className="text-sm text-red-500 font-medium">Not Found</span>
                </>
              )}
            </div>
          </div>

          {/* Czkawka Status */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-secondary">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Package className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">Czkawka</h3>
                  <button
                    onClick={() => openUrl("https://github.com/qarmin/czkawka")}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-0.5"
                  >
                    <ExternalLink className="w-3 h-3" />
                    GitHub
                  </button>
                </div>
                <p className="text-sm text-text-muted font-medium">Duplicate file finder (Required for Dedup)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {validation.checking ? (
                <span className="text-text-muted text-sm">Checking...</span>
              ) : validation.czkawka ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-green-500 font-medium">
                    {validation.czkawkaSource === 'custom' ? 'Custom' : 'PATH'}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-500" />
                  <span className="text-sm text-red-500 font-medium">Not Found</span>
                </>
              )}
            </div>
          </div>

          {/* Immich-Go Status */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-secondary">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${validation.immichGoSource === 'bundled' ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
                <Package className={`w-5 h-5 ${validation.immichGoSource === 'bundled' ? 'text-green-400' : 'text-yellow-400'}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">Immich-Go</h3>
                  <button
                    onClick={() => openUrl("https://github.com/simulot/immich-go")}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-0.5"
                  >
                    <ExternalLink className="w-3 h-3" />
                    GitHub
                  </button>
                </div>
                <p className="text-sm text-text-muted font-medium">
                  {validation.immichGoSource === 'bundled'
                    ? 'Bundled with app (ready to use)'
                    : 'Immich upload utility'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {validation.checking ? (
                <span className="text-text-muted text-sm">Checking...</span>
              ) : validation.immichGo ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-green-500 font-medium">
                    {validation.immichGoSource === 'custom' ? 'Custom' :
                      validation.immichGoSource === 'bundled' ? 'Bundled' : 'PATH'}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-500" />
                  <span className="text-sm text-red-500 font-medium">Not Found</span>
                </>
              )}
            </div>
          </div>

          {(!validation.exiftool || !validation.czkawka) && !validation.checking && (
            <div className="mt-4 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-bold mb-1">Missing Dependencies:</p>
                <ul className="list-disc list-inside space-y-1">
                  {!validation.exiftool && <li>ExifTool is required for metadata and organization.</li>}
                  {!validation.czkawka && <li>Czkawka-cli is required for duplicate detection.</li>}
                </ul>
                <p className="mt-2">
                  Please install the missing tools or set custom paths in Advanced Settings below.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Source Configuration */}
      <div className="glass-card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-green-500/20">
            <HardDrive className="w-5 h-5 text-green-400" />
          </div>
          <h2 className="text-2xl font-bold">Source Configuration</h2>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-muted">
              Default Source Path
            </label>
            <p className="text-sm text-text-muted mb-2">
              The default folder to ingest media from (e.g. SD card, Phone backup)
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                className="input-field flex-1"
                placeholder="/Volumes/SD_CARD"
                value={settings.defaultSourcePath}
                onChange={(e) => handleChange('defaultSourcePath', e.target.value)}
              />
              <button
                onClick={() => handleBrowsePath('defaultSourcePath', 'Select Default Source Folder')}
                className="btn-secondary whitespace-nowrap px-6"
              >
                Browse
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Archive Configuration */}
      <div className="glass-card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-purple-500/20">
            <FolderOpen className="w-5 h-5 text-purple-400" />
          </div>
          <h2 className="text-2xl font-bold">Archive Configuration</h2>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-muted">
              Canonical Archive Path
            </label>
            <p className="text-sm text-text-muted mb-2">
              The master folder where your organized media will be stored
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                className="input-field flex-1"
                placeholder="/Users/username/Pictures/Archive"
                value={settings.archivePath}
                onChange={(e) => handleChange('archivePath', e.target.value)}
              />
              <button
                onClick={() => handleBrowsePath('archivePath', 'Select Archive Folder')}
                className="btn-secondary whitespace-nowrap px-6"
              >
                Browse
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Immich Configuration */}
      <div className="glass-card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-blue-500/20">
            <Server className="w-5 h-5 text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold">Immich Server</h2>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-muted">
              Server URL
            </label>
            <input
              type="text"
              className="input-field w-full"
              placeholder="http://192.168.1.100:2283"
              value={settings.immichUrl}
              onChange={(e) => handleChange('immichUrl', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-muted">
              API Key
            </label>
            <div className="relative">
              <input
                type="password"
                className="input-field w-full pr-12"
                placeholder="Enter your Immich API key"
                value={settings.immichApiKey}
                onChange={(e) => handleChange('immichApiKey', e.target.value)}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Key className="w-5 h-5 text-text-tertiary" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4">
            <button
              onClick={handleTestConnection}
              className="btn-secondary whitespace-nowrap"
              disabled={connectionStatus.message === 'Testing connection...'}
            >
              {connectionStatus.message === 'Testing connection...' ? 'Testing...' : 'Test Connection'}
            </button>

            {connectionStatus.message && connectionStatus.message !== 'Testing connection...' && (
              <div className={`text-sm flex items-center gap-2 ${connectionStatus.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                {connectionStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {connectionStatus.message}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Advanced: Binary Paths */}
      <div className="glass-card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-orange-500/20">
            <Package className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Advanced: Custom Binary Paths</h2>
            <p className="text-sm text-text-muted">Override bundled or PATH binaries with your own</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* ExifTool Path Override */}
          <div className="space-y-2">
            <label htmlFor="exiftool-path" className="block text-sm font-medium text-text-muted">
              ExifTool Binary Path
            </label>
            <p className="text-sm text-text-muted mb-2 font-medium">
              Leave empty to use system PATH. Set path to a custom exiftool installation.
            </p>
            <div className="flex gap-3">
              <input
                id="exiftool-path"
                type="text"
                className="input-field flex-1"
                placeholder="e.g. /usr/local/bin/exiftool"
                value={settings.exiftoolPath}
                onChange={(e) => handleChange('exiftoolPath', e.target.value)}
              />
              <button
                onClick={async () => {
                  try {
                    const selected = await openDialog({
                      directory: false,
                      multiple: false,
                      title: "Select ExifTool Executable",
                      filters: navigator.platform.toLowerCase().includes('win')
                        ? [{ name: 'Executables', extensions: ['exe'] }]
                        : undefined,
                    });
                    if (selected) {
                      handleChange('exiftoolPath', selected as string);
                    }
                  } catch (err) {
                    console.error("Failed to select file", err);
                  }
                }}
                className="btn-secondary whitespace-nowrap px-6"
              >
                Browse
              </button>
              {settings.exiftoolPath && (
                <button
                  onClick={() => handleChange('exiftoolPath', '')}
                  className="btn-secondary whitespace-nowrap px-4 text-red-400 hover:text-red-300"
                  title="Clear custom path"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Czkawka Path Override */}
          <div className="space-y-2">
            <label htmlFor="czkawka-path" className="block text-sm font-medium text-text-muted">
              Czkawka Binary Path
            </label>
            <p className="text-sm text-text-muted mb-2 font-medium">
              Leave empty to use system PATH (checks for 'czkawka-cli' and 'czkawka').
            </p>
            <div className="flex gap-3">
              <input
                id="czkawka-path"
                type="text"
                className="input-field flex-1"
                placeholder="e.g. /usr/bin/czkawka-cli"
                value={settings.czkawkaPath}
                onChange={(e) => handleChange('czkawkaPath', e.target.value)}
              />
              <button
                onClick={async () => {
                  try {
                    const selected = await openDialog({
                      directory: false,
                      multiple: false,
                      title: "Select Czkawka Executable",
                      filters: navigator.platform.toLowerCase().includes('win')
                        ? [{ name: 'Executables', extensions: ['exe'] }]
                        : undefined,
                    });
                    if (selected) {
                      handleChange('czkawkaPath', selected as string);
                    }
                  } catch (err) {
                    console.error("Failed to select file", err);
                  }
                }}
                className="btn-secondary whitespace-nowrap px-6"
              >
                Browse
              </button>
              {settings.czkawkaPath && (
                <button
                  onClick={() => handleChange('czkawkaPath', '')}
                  className="btn-secondary whitespace-nowrap px-4 text-red-400 hover:text-red-300"
                  title="Clear custom path"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Immich-Go Path Override */}
          <div className="space-y-2">
            <label htmlFor="immich-go-path" className="block text-sm font-medium text-text-muted">
              Immich-Go Binary Path
            </label>
            <p className="text-sm text-text-muted mb-2 font-medium">
              Leave empty to use bundled version. Set path to override with custom installation.
            </p>
            <div className="flex gap-3">
              <input
                id="immich-go-path"
                type="text"
                className="input-field flex-1"
                placeholder="Leave empty to use bundled immich-go"
                value={settings.immichGoPath}
                onChange={(e) => handleChange('immichGoPath', e.target.value)}
              />
              <button
                onClick={async () => {
                  try {
                    const selected = await openDialog({
                      directory: false,
                      multiple: false,
                      title: "Select Immich-Go Executable",
                      filters: navigator.platform.toLowerCase().includes('win')
                        ? [{ name: 'Executables', extensions: ['exe'] }]
                        : undefined,
                    });
                    if (selected) {
                      handleChange('immichGoPath', selected as string);
                    }
                  } catch (err) {
                    console.error("Failed to select file", err);
                  }
                }}
                className="btn-secondary whitespace-nowrap px-6"
              >
                Browse
              </button>
              {settings.immichGoPath && (
                <button
                  onClick={() => handleChange('immichGoPath', '')}
                  className="btn-secondary whitespace-nowrap px-4 text-red-400 hover:text-red-300"
                  title="Clear custom path (use bundled)"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-surface-secondary border border-border">
            <p className="text-xs text-text-muted">
              <strong className="text-text-main">Note:</strong> After changing paths, click "Recheck" in the System Prerequisites section above to validate the binaries.
            </p>
          </div>
        </div>
      </div>

      {/* Advanced: Import Catalog Inspector (collapsed by default) */}
      <div className="glass-card p-8">
        <button
          onClick={handleToggleCatalog}
          className="w-full flex items-center gap-3 text-left"
          data-testid="catalog-toggle"
        >
          <div className="p-2 rounded-lg bg-indigo-500/20">
            <Database className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">Advanced: Import Catalog</h2>
            <p className="text-sm text-text-muted">Inspect the database that tracks every file ever imported</p>
          </div>
          {catalogExpanded ? <ChevronDown className="w-5 h-5 text-text-muted" /> : <ChevronRight className="w-5 h-5 text-text-muted" />}
        </button>

        {catalogExpanded && (
          <div className="mt-6 space-y-6 animate-fade-in">
            {catalogLoading ? (
              <div className="flex items-center gap-2 text-text-muted text-sm">
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                Loading catalog...
              </div>
            ) : catalogError ? (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                Failed to load catalog: {catalogError}
              </div>
            ) : (
              <>
                {/* File location */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-text-muted">Database File</label>
                  <p className="text-sm text-text-muted mb-2 font-medium">
                    Every imported file's hash, dates, and backup status live in this SQLite file.
                    Open it with any SQLite browser (e.g. "DB Browser for SQLite") for full inspection.
                  </p>
                  <div className="flex gap-3">
                    <div className="input-field flex-1 break-all font-mono text-xs flex items-center" data-testid="catalog-path">
                      {catalogPath || "Unknown"}
                    </div>
                    <button
                      onClick={handleRevealCatalog}
                      disabled={!catalogPath}
                      className="btn-secondary whitespace-nowrap px-4 disabled:opacity-50"
                    >
                      Reveal in Finder
                    </button>
                    <button
                      onClick={loadCatalogInfo}
                      className="btn-secondary whitespace-nowrap px-3"
                      title="Refresh"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-surface-secondary border border-border">
                    <p className="text-xs text-text-muted uppercase font-bold mb-1">Files Cataloged</p>
                    <p className="text-2xl font-bold text-text-main" data-testid="catalog-total-files">{catalogStats?.total_files ?? 0}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-surface-secondary border border-border">
                    <p className="text-xs text-text-muted uppercase font-bold mb-1">Pending Backups</p>
                    <p className="text-2xl font-bold text-text-main">{catalogStats?.pending_backups ?? 0}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-surface-secondary border border-border">
                    <p className="text-xs text-text-muted uppercase font-bold mb-1">Last Import</p>
                    <p className="text-sm font-semibold text-text-main mt-1">
                      {catalogStats?.last_import_at ? new Date(catalogStats.last_import_at).toLocaleString() : "Never"}
                    </p>
                  </div>
                </div>

                {/* Recent sessions */}
                <div>
                  <h3 className="text-sm font-semibold text-text-muted mb-3">Recent Import Sessions</h3>
                  {catalogSessions.length === 0 ? (
                    <p className="text-sm text-text-muted">No imports recorded yet.</p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {catalogSessions.map((session) => (
                        <div key={session.id} className="p-3 rounded-lg bg-surface-secondary border border-border text-sm">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-text-main">
                              {session.source_label || session.source_path}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                              session.status === 'complete' ? 'bg-green-500/20 text-green-500' :
                              session.status === 'cancelled' ? 'bg-yellow-500/20 text-yellow-500' :
                              session.status === 'running' ? 'bg-blue-500/20 text-blue-500' :
                              'bg-red-500/20 text-red-500'
                            }`}>
                              {session.status}
                            </span>
                          </div>
                          <p className="text-xs text-text-muted mb-2">{new Date(session.started_at).toLocaleString()}</p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                            <span>Imported: <strong className="text-text-main">{session.imported}</strong></span>
                            <span>Duplicates: <strong className="text-text-main">{session.skipped_duplicates}</strong></span>
                            <span>No date: <strong className="text-text-main">{session.skipped_no_date}</strong></span>
                            {session.errors > 0 && <span>Errors: <strong className="text-red-400">{session.errors}</strong></span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-end gap-4">
        {saveMessage && (
          <span className={`text-sm font-medium animate-fade-in ${saveMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {saveMessage.text}
          </span>
        )}
        <button
          onClick={() => loadSettings()} // Reset is basically reload
          className="btn-secondary px-8"
        >
          Reset
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary px-8 flex items-center gap-2"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  );
}
