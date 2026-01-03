import { HardDrive, Calendar, TrendingUp, Import, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

export function Dashboard() {
  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero Section */}
      <div className="glass-card p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-600/20 via-transparent to-blue-600/20" />
        <div className="relative z-10">
          <h1 className="text-4xl font-bold mb-2">
            Welcome to <span className="gradient-text">Tasaveer</span>
          </h1>
          <p className="text-slate-400 text-lg">
            Your media archive management companion
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card-hover p-6 group">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-1">Total Media</h3>
              <p className="text-4xl font-bold group-hover:gradient-text transition-all">
                0
              </p>
              <p className="text-xs text-slate-500 mt-2">Photos & Videos</p>
            </div>
            <div className="p-3 rounded-xl bg-purple-500/10 group-hover:bg-purple-500/20 transition-colors">
              <HardDrive className="w-6 h-6 text-purple-400" />
            </div>
          </div>
        </div>

        <div className="glass-card-hover p-6 group">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-1">Last Sync</h3>
              <p className="text-2xl font-bold text-yellow-500 group-hover:text-yellow-400 transition-colors">
                Never
              </p>
              <p className="text-xs text-slate-500 mt-2">Sync with Immich</p>
            </div>
            <div className="p-3 rounded-xl bg-yellow-500/10 group-hover:bg-yellow-500/20 transition-colors">
              <Calendar className="w-6 h-6 text-yellow-400" />
            </div>
          </div>
        </div>

        <div className="glass-card-hover p-6 group">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-1">Storage Used</h3>
              <p className="text-4xl font-bold group-hover:gradient-text transition-all">
                0 <span className="text-lg text-slate-500">GB</span>
              </p>
              <p className="text-xs text-slate-500 mt-2">Local archive size</p>
            </div>
            <div className="p-3 rounded-xl bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors">
              <TrendingUp className="w-6 h-6 text-blue-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-6">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            to="/ingest"
            className="group flex items-center gap-4 p-6 rounded-xl bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 hover:border-purple-500/40 transition-all hover:scale-[1.02]"
          >
            <div className="p-3 rounded-lg bg-purple-500/20 group-hover:bg-purple-500/30 transition-colors">
              <Import className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-white">Import Media</h3>
              <p className="text-sm text-slate-400">Add photos and videos to your archive</p>
            </div>
          </Link>

          <Link
            to="/sync"
            className="group flex items-center gap-4 p-6 rounded-xl bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/20 hover:border-blue-500/40 transition-all hover:scale-[1.02]"
          >
            <div className="p-3 rounded-lg bg-blue-500/20 group-hover:bg-blue-500/30 transition-colors">
              <RefreshCw className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-white">Sync to Immich</h3>
              <p className="text-sm text-slate-400">Upload your archive to Immich server</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-6">Recent Activity</h2>
        <div className="space-y-4">
          <div className="text-center py-8 text-slate-500">
            <p>No recent activity</p>
            <p className="text-sm mt-2">Your import and sync history will appear here</p>
          </div>
        </div>
      </div>
    </div>
  );
}
