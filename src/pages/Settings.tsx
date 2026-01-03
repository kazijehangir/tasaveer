import { FolderOpen, Server, Key, Package, CheckCircle2, XCircle } from "lucide-react";

export function Settings() {
  return (
    <div className="space-y-8 animate-fade-in max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold mb-2">
          <span className="gradient-text">Settings</span>
        </h1>
        <p className="text-slate-400 text-lg">
          Configure your archive and Immich connection
        </p>
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
              />
              <button className="btn-secondary whitespace-nowrap px-6">
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
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Key className="w-5 h-5 text-slate-500" />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Generate an API key from your Immich server settings
            </p>
          </div>

          <button className="btn-secondary w-full mt-4">
            Test Connection
          </button>
        </div>
      </div>

      {/* Dependencies Status */}
      <div className="glass-card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-green-500/20">
            <Package className="w-5 h-5 text-green-400" />
          </div>
          <h2 className="text-2xl font-bold">Dependencies</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/20">
                <Package className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <h3 className="font-semibold">Phockup</h3>
                <p className="text-sm text-slate-400">Media organization tool</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-yellow-500" />
              <span className="text-sm text-yellow-500 font-medium">Not Found</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/20">
                <Package className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <h3 className="font-semibold">Immich-Go</h3>
                <p className="text-sm text-slate-400">Immich upload utility</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-yellow-500" />
              <span className="text-sm text-yellow-500 font-medium">Not Found</span>
            </div>
          </div>

          <div className="mt-4 p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
            <p className="text-sm text-blue-300">
              <strong>Note:</strong> Install these dependencies to enable full functionality.
              Check the documentation for installation instructions.
            </p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end gap-4">
        <button className="btn-secondary px-8">
          Reset
        </button>
        <button className="btn-primary px-8">
          Save Settings
        </button>
      </div>
    </div>
  );
}
