import { Import, RefreshCw, Sparkles, FolderHeart } from "lucide-react";
import { Link } from "react-router-dom";
import { Settings } from "./Settings";

export function Dashboard() {
  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero Section */}
      <div className="glass-card p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-600/10 via-transparent to-blue-600/10 pointer-events-none" />
        <div className="relative z-10">
          <h1 className="text-4xl font-bold mb-2 text-text-main">
            Welcome to <span className="gradient-text">Tasaveer</span>
          </h1>
          <p className="text-text-muted text-lg">
            Your media archive management companion
          </p>
        </div>
      </div>



      {/* Workflow Section */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-6 text-text-main">Workflow</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Step 1: Ingest */}
          <Link
            to="/ingest"
            className="group flex flex-col gap-4 p-6 rounded-xl bg-purple-50/50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 hover:border-purple-300 dark:hover:border-purple-500/40 transition-all hover:scale-[1.02]"
          >
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-purple-100 dark:bg-purple-500/20 group-hover:bg-purple-200 dark:group-hover:bg-purple-500/30 transition-colors">
                <Import className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <span className="text-xs font-mono text-purple-700 dark:text-purple-300 uppercase tracking-wider">Step 1</span>
            </div>
            <div>
              <h3 className="font-semibold text-lg text-text-main mb-1">Ingest</h3>
              <p className="text-sm text-text-muted">Import media from external devices</p>
            </div>
          </Link>

          {/* Step 2: Clean & Dedup */}
          <Link
            to="/clean"
            className="group flex flex-col gap-4 p-6 rounded-xl bg-blue-50/50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 hover:border-blue-300 dark:hover:border-blue-500/40 transition-all hover:scale-[1.02]"
          >
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-500/20 group-hover:bg-blue-200 dark:group-hover:bg-blue-500/30 transition-colors">
                <Sparkles className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-xs font-mono text-blue-700 dark:text-blue-300 uppercase tracking-wider">Step 2</span>
            </div>
            <div>
              <h3 className="font-semibold text-lg text-text-main mb-1">Clean & Dedup</h3>
              <p className="text-sm text-text-muted">Fix metadata and remove duplicates</p>
            </div>
          </Link>

          {/* Step 3: Tag & Categorize */}
          <Link
            to="/organize"
            className="group flex flex-col gap-4 p-6 rounded-xl bg-cyan-50/50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 hover:border-cyan-300 dark:hover:border-cyan-500/40 transition-all hover:scale-[1.02]"
          >
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-pink-100 dark:bg-pink-500/20 group-hover:bg-pink-200 dark:group-hover:bg-pink-500/30 transition-colors">
                <FolderHeart className="w-6 h-6 text-pink-600 dark:text-pink-400" />
              </div>
              <span className="text-xs font-mono text-pink-700 dark:text-pink-300 uppercase tracking-wider">Step 3</span>
            </div>
            <div>
              <h3 className="font-semibold text-lg text-text-main mb-1">Tag & Categorize</h3>
              <p className="text-sm text-text-muted">Organize into family & personal</p>
            </div>
          </Link>

          {/* Step 4: Sync */}
          <Link
            to="/sync"
            className="group flex flex-col gap-4 p-6 rounded-xl bg-pink-50/50 dark:bg-pink-500/10 border border-pink-200 dark:border-pink-500/20 hover:border-pink-300 dark:hover:border-pink-500/40 transition-all hover:scale-[1.02]"
          >
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-green-100 dark:bg-green-500/20 group-hover:bg-green-200 dark:group-hover:bg-green-500/30 transition-colors">
                <RefreshCw className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <span className="text-xs font-mono text-green-700 dark:text-green-300 uppercase tracking-wider">Step 4</span>
            </div>
            <div>
              <h3 className="font-semibold text-lg text-text-main mb-1">Sync</h3>
              <p className="text-sm text-text-muted">Upload organized library to Immich</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-6 text-text-main">Recent Activity</h2>
        <div className="text-center py-8">
          <p className="text-text-main font-medium">No recent activity</p>
          <p className="text-text-muted text-sm mt-2">Your import and sync history will appear here</p>
        </div>
      </div>

      {/* Settings Section */}
      <div className="pt-8 border-t border-border">
        <Settings />
      </div>
    </div>
  );
}
