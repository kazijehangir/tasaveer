import { RefreshCw, Cloud, CheckCircle2, Clock, Activity, Server } from "lucide-react";
import { useState } from "react";

export function Sync() {
  const [syncAll, setSyncAll] = useState(true);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold mb-2 text-text-main">
          <span className="gradient-text">Sync</span> to Immich
        </h1>
        <p className="text-text-muted text-lg">
          Upload your media archive to your Immich server
        </p>
      </div>

      {/* Connection Status */}
      <div className="glass-card p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-green-500/10 dark:bg-green-500/20">
                <Server className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-text-main">Immich Server</h2>
                <p className="text-sm text-text-muted">Connection status</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse-glow" />
              <span className="text-sm text-yellow-600 dark:text-yellow-400 font-medium">Not Configured</span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2 text-text-muted">
              <Cloud className="w-4 h-4" />
              <span>Server: Not set</span>
            </div>
            <div className="w-1 h-1 rounded-full bg-neutral-400" />
            <div className="flex items-center gap-2 text-text-muted">
              <Activity className="w-4 h-4" />
              <span>API: Not configured</span>
            </div>
          </div>
        </div>
      </div>

      {/* Last Sync Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-5 h-5 text-primary-500" />
            <h3 className="text-sm font-medium text-text-muted">Last Sync</h3>
          </div>
          <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-500">Never</p>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <h3 className="text-sm font-medium text-text-muted">Files Synced</h3>
          </div>
          <p className="text-2xl font-bold text-text-main">0</p>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-2">
            <RefreshCw className="w-5 h-5 text-primary-500" />
            <h3 className="text-sm font-medium text-text-muted">Status</h3>
          </div>
          <p className="text-2xl font-bold text-text-muted">Idle</p>
        </div>
      </div>

      {/* Sync Options */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-6 text-text-main">Sync Options</h2>
        <div className="space-y-4">
          <label className="flex items-center gap-4 p-4 rounded-xl bg-surface-secondary hover:bg-surface-hover transition-colors cursor-pointer group border border-transparent hover:border-border">
            <input
              type="checkbox"
              checked={syncAll}
              onChange={(e) => setSyncAll(e.target.checked)}
              className="w-5 h-5 rounded border-2 border-neutral-400 text-primary-600 focus:ring-primary-500 transition-all cursor-pointer"
            />
            <div className="flex-1">
              <h3 className="font-semibold text-text-main group-hover:text-primary-600 transition-colors">
                Sync All Media
              </h3>
              <p className="text-sm text-text-muted">
                Upload all files from your archive to Immich
              </p>
            </div>
          </label>

          <label className="flex items-center gap-4 p-4 rounded-xl bg-surface-secondary opacity-50 cursor-not-allowed border border-transparent">
            <input
              type="checkbox"
              disabled
              className="w-5 h-5 rounded border-2 border-neutral-400 cursor-not-allowed"
            />
            <div className="flex-1">
              <h3 className="font-semibold text-text-main">
                Incremental Sync
              </h3>
              <p className="text-sm text-text-muted">
                Only upload new or modified files (Coming soon)
              </p>
            </div>
          </label>

          <label className="flex items-center gap-4 p-4 rounded-xl bg-surface-secondary opacity-50 cursor-not-allowed border border-transparent">
            <input
              type="checkbox"
              disabled
              className="w-5 h-5 rounded border-2 border-neutral-400 cursor-not-allowed"
            />
            <div className="flex-1">
              <h3 className="font-semibold text-text-main">
                Selective Sync
              </h3>
              <p className="text-sm text-text-muted">
                Choose specific years or months to sync (Coming soon)
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Action Button */}
      <div className="glass-card p-8">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold mb-1 text-text-main">Ready to sync?</h3>
            <p className="text-sm text-text-muted">
              Configure your Immich server in Settings first
            </p>
          </div>
          <button
            disabled
            className="btn-primary opacity-50 cursor-not-allowed flex items-center gap-3"
          >
            <RefreshCw className="w-5 h-5" />
            Start Sync
          </button>
        </div>
      </div>

      {/* Sync History */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-6 text-text-main">Sync History</h2>
        <div className="text-center py-12 text-text-muted">
          <RefreshCw className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg">No sync history yet</p>
          <p className="text-sm mt-2">Your sync operations will be logged here</p>
        </div>
      </div>
    </div>
  );
}
