import { FolderOpen, Server, Key, Package, XCircle, CheckCircle2, Save, RefreshCw, AlertTriangle, ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";
import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

interface SettingsData {
  archivePath: string;
  immichUrl: string;
  immichApiKey: string;
  // Custom binary path overrides (empty = use bundled/PATH)
  phockupPath: string;
  immichGoPath: string;
}

interface ValidationStatus {
  phockup: boolean;
  phockupSource: 'custom' | 'path' | 'none';
  immichGo: boolean;
  immichGoSource: 'custom' | 'bundled' | 'path' | 'none';
  checking: boolean;
}

export function Settings() {
  const [settings, setSettings] = useState<SettingsData>({
    archivePath: "",
    immichUrl: "",
    immichApiKey: "",
    phockupPath: "",
    immichGoPath: "",
  });
  const [validation, setValidation] = useState<ValidationStatus>({
    phockup: false,
    phockupSource: 'none',
    immichGo: false,
    immichGoSource: 'none',
    checking: true,
  });
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    loadSettings();
    checkPrerequisites();
  }, []);

  const loadSettings = async () => {
    try {
      const savedSettingsStr = await invoke<string>("load_settings");
      if (savedSettingsStr && savedSettingsStr !== "{}") {
        try {
          const parsed = JSON.parse(savedSettingsStr);
          setSettings(prev => ({ ...prev, ...parsed }));
        } catch (parseErr) {
          console.error("Failed to parse settings:", parseErr);
        }
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const checkPrerequisites = async () => {
    setValidation(prev => ({ ...prev, checking: true }));
    let phockupFound = false;
    let phockupSource: ValidationStatus['phockupSource'] = 'none';
    let immichGoFound = false;
    let immichGoSource: ValidationStatus['immichGoSource'] = 'none';

    // Check custom path first if specified
    if (settings.phockupPath) {
      try {
        const cmd = Command.create(settings.phockupPath, ['--help']);
        const output = await cmd.execute();
        if (output.code === 0) {
          phockupFound = true;
          phockupSource = 'custom';
        }
      } catch (e) {
        console.log('Custom phockup path check failed:', e);
      }
    }

    // Check Phockup in PATH - try multiple command variants for Windows compatibility
    if (!phockupFound) {
      for (const cmdName of ['phockup', 'phockup.bat'] as const) {
        if (phockupFound) break;
        try {
          const phockupCmd = Command.create(cmdName, ['--help']);
          const output = await phockupCmd.execute();
          if (output.code === 0) {
            phockupFound = true;
            phockupSource = 'path';
          }
        } catch (e) {
          console.log(`Phockup check failed for ${cmdName}:`, e);
        }
      }
    }

    // Check custom immich-go path first if specified
    if (settings.immichGoPath) {
      try {
        const cmd = Command.create(settings.immichGoPath, ['version']);
        const output = await cmd.execute();
        if (output.code === 0) {
          immichGoFound = true;
          immichGoSource = 'custom';
        }
      } catch (e) {
        console.log('Custom immich-go path check failed:', e);
      }
    }

    // Check bundled sidecar
    if (!immichGoFound) {
      try {
        const sidecarCmd = Command.sidecar('binaries/immich-go', ['version']);
        const output = await sidecarCmd.execute();
        console.log('Bundled immich-go sidecar check:', output);
        if (output.code === 0) {
          immichGoFound = true;
          immichGoSource = 'bundled';
        }
      } catch (e) {
        console.log('Bundled immich-go sidecar not found:', e);
      }
    }

    // Check Immich-Go in PATH - try multiple command variants for Windows compatibility
    if (!immichGoFound) {
      for (const cmdName of ['immich-go', 'immich-go.exe'] as const) {
        if (immichGoFound) break;
        try {
          const immichGoCmd = Command.create(cmdName, ['version']);
          const output = await immichGoCmd.execute();
          console.log(`Immich-go check result for ${cmdName}:`, output);
          if (output.code === 0) {
            immichGoFound = true;
            immichGoSource = 'path';
          }
        } catch (e) {
          console.log(`Immich-go check failed for ${cmdName}:`, e);
        }
      }
    }

    setValidation({
      phockup: phockupFound,
      phockupSource,
      immichGo: immichGoFound,
      immichGoSource,
      checking: false,
    });
  };

  const handleBrowse = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Select Archive Folder",
      });
      if (selected) {
        setSettings(prev => ({ ...prev, archivePath: selected as string }));
      }
    } catch (err) {
      console.error("Failed to list files", err);
    }
  };

  const handleChange = (key: keyof SettingsData, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      await invoke("save_settings", { settings: JSON.stringify(settings, null, 2) });
      setSaveMessage({ type: 'success', text: "Settings saved successfully!" });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
      setSaveMessage({ type: 'error', text: "Failed to save settings." });
    } finally {
      setSaving(false);
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
    <div className="space-y-8 animate-fade-in max-w-4xl pb-20">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold mb-2">
          <span className="gradient-text">Settings</span>
        </h1>
        <p className="text-slate-400 text-lg">
          Configure external tools and connections
        </p>
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
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            title="Recheck dependencies"
          >
            <RefreshCw className={`w-5 h-5 ${validation.checking ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Phockup Status */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/20">
                <Package className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">Phockup</h3>
                  <button
                    onClick={() => openUrl("https://github.com/ivandokov/phockup")}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                  >
                    <ExternalLink className="w-3 h-3" />
                    GitHub
                  </button>
                </div>
                <p className="text-sm text-slate-400">Media organization tool (requires manual install)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {validation.checking ? (
                <span className="text-slate-500 text-sm">Checking...</span>
              ) : validation.phockup ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-green-500 font-medium">
                    {validation.phockupSource === 'custom' ? 'Custom' : 'PATH'}
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
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${validation.immichGoSource === 'bundled' ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
                <Package className={`w-5 h-5 ${validation.immichGoSource === 'bundled' ? 'text-green-400' : 'text-yellow-400'}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">Immich-Go</h3>
                  <button
                    onClick={() => openUrl("https://github.com/simulot/immich-go")}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                  >
                    <ExternalLink className="w-3 h-3" />
                    GitHub
                  </button>
                </div>
                <p className="text-sm text-slate-400">
                  {validation.immichGoSource === 'bundled'
                    ? 'Bundled with app (ready to use)'
                    : 'Immich upload utility'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {validation.checking ? (
                <span className="text-slate-500 text-sm">Checking...</span>
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

          {!validation.phockup && !validation.checking && (
            <div className="mt-4 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-200">
                Phockup is required for local media ingest. Please install it from{' '}
                <button onClick={() => openUrl("https://github.com/ivandokov/phockup")} className="text-blue-400 hover:underline">
                  GitHub
                </button>{' '}
                and ensure it's in your system PATH, or set a custom path in Advanced Settings below.
              </p>
            </div>
          )}
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
            <label className="block text-sm font-medium text-slate-300">
              Canonical Archive Path
            </label>
            <p className="text-xs text-slate-500 mb-2">
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
                onClick={handleBrowse}
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
            <label className="block text-sm font-medium text-slate-300">
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
            <label className="block text-sm font-medium text-slate-300">
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
                <Key className="w-5 h-5 text-slate-500" />
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
            <p className="text-sm text-slate-400">Override bundled or PATH binaries with your own</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Phockup Path Override */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">
              Phockup Binary Path
            </label>
            <p className="text-xs text-slate-500 mb-2">
              Leave empty to use system PATH. Set path to a custom phockup installation.
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                className="input-field flex-1"
                placeholder="e.g. C:\Programs\phockup\phockup.bat"
                value={settings.phockupPath}
                onChange={(e) => handleChange('phockupPath', e.target.value)}
              />
              <button
                onClick={async () => {
                  try {
                    const selected = await openDialog({
                      directory: false,
                      multiple: false,
                      title: "Select Phockup Executable",
                      filters: navigator.platform.toLowerCase().includes('win')
                        ? [{ name: 'Executables', extensions: ['exe', 'bat', 'cmd'] }]
                        : undefined,
                    });
                    if (selected) {
                      handleChange('phockupPath', selected as string);
                    }
                  } catch (err) {
                    console.error("Failed to select file", err);
                  }
                }}
                className="btn-secondary whitespace-nowrap px-6"
              >
                Browse
              </button>
              {settings.phockupPath && (
                <button
                  onClick={() => handleChange('phockupPath', '')}
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
            <label className="block text-sm font-medium text-slate-300">
              Immich-Go Binary Path
            </label>
            <p className="text-xs text-slate-500 mb-2">
              Leave empty to use bundled version. Set path to override with custom installation.
            </p>
            <div className="flex gap-3">
              <input
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

          <div className="p-4 rounded-xl bg-slate-800/30 border border-slate-700/50">
            <p className="text-xs text-slate-400">
              <strong className="text-slate-300">Note:</strong> After changing paths, click "Recheck" in the System Prerequisites section above to validate the binaries.
            </p>
          </div>
        </div>
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
