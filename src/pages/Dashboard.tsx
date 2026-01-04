import { Import, RefreshCw, Sparkles, FolderHeart } from "lucide-react";
import { Link } from "react-router-dom";
import { Settings } from "./Settings";

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



      {/* Workflow Section */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-6">Workflow</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Step 1: Ingest */}
          <Link
            to="/ingest"
            className="group flex flex-col gap-4 p-6 rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20 hover:border-purple-500/40 transition-all hover:scale-[1.02]"
          >
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-purple-500/20 group-hover:bg-purple-500/30 transition-colors">
                <Import className="w-6 h-6 text-purple-400" />
              </div>
              <span className="text-xs font-mono text-purple-400/60 uppercase tracking-wider">Step 1</span>
            </div>
            <div>
              <h3 className="font-semibold text-lg text-white mb-1">Ingest</h3>
              <p className="text-sm text-slate-400">Import media from external devices</p>
            </div>
          </Link>

          {/* Step 2: Clean & Dedup */}
          <Link
            to="/clean"
            className="group flex flex-col gap-4 p-6 rounded-xl bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 hover:border-blue-500/40 transition-all hover:scale-[1.02]"
          >
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-blue-500/20 group-hover:bg-blue-500/30 transition-colors">
                <Sparkles className="w-6 h-6 text-blue-400" />
              </div>
              <span className="text-xs font-mono text-blue-400/60 uppercase tracking-wider">Step 2</span>
            </div>
            <div>
              <h3 className="font-semibold text-lg text-white mb-1">Clean & Dedup</h3>
              <p className="text-sm text-slate-400">Fix metadata and remove duplicates</p>
            </div>
          </Link>

          {/* Step 3: Tag & Categorize */}
          <Link
            to="/organize"
            className="group flex flex-col gap-4 p-6 rounded-xl bg-gradient-to-br from-cyan-500/10 to-pink-500/10 border border-cyan-500/20 hover:border-cyan-500/40 transition-all hover:scale-[1.02]"
          >
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-pink-500/20 group-hover:bg-pink-500/30 transition-colors">
                <FolderHeart className="w-6 h-6 text-pink-400" />
              </div>
              <span className="text-xs font-mono text-pink-400/60 uppercase tracking-wider">Step 3</span>
            </div>
            <div>
              <h3 className="font-semibold text-lg text-white mb-1">Tag & Categorize</h3>
              <p className="text-sm text-slate-400">Organize into family & personal</p>
            </div>
          </Link>

          {/* Step 4: Sync */}
          <Link
            to="/sync"
            className="group flex flex-col gap-4 p-6 rounded-xl bg-gradient-to-br from-pink-500/10 to-purple-500/10 border border-pink-500/20 hover:border-pink-500/40 transition-all hover:scale-[1.02]"
          >
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-green-500/20 group-hover:bg-green-500/30 transition-colors">
                <RefreshCw className="w-6 h-6 text-green-400" />
              </div>
              <span className="text-xs font-mono text-green-400/60 uppercase tracking-wider">Step 4</span>
            </div>
            <div>
              <h3 className="font-semibold text-lg text-white mb-1">Sync</h3>
              <p className="text-sm text-slate-400">Upload organized library to Immich</p>
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

      {/* Settings Section */}
      <div className="pt-8 border-t border-slate-800">
        <Settings />
      </div>
    </div>
  );
}

