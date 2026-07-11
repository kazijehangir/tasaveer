import { Import, RefreshCw, Sparkles, Activity, CheckCircle2, AlertCircle, ArrowRight, Calendar } from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

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

export function Dashboard() {
  const [sessions, setSessions] = useState<ImportSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<ImportSession[]>("get_recent_sessions", { limit: 5 })
      .then((data) => {
        setSessions(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load recent sessions:", err);
        setLoading(false);
      });
  }, []);

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

          {/* Step 3: Sync */}
          <Link
            to="/sync"
            className="group flex flex-col gap-4 p-6 rounded-xl bg-pink-50/50 dark:bg-pink-500/10 border border-pink-200 dark:border-pink-500/20 hover:border-pink-300 dark:hover:border-pink-500/40 transition-all hover:scale-[1.02]"
          >
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-green-100 dark:bg-green-500/20 group-hover:bg-green-200 dark:group-hover:bg-green-500/30 transition-colors">
                <RefreshCw className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <span className="text-xs font-mono text-green-700 dark:text-green-300 uppercase tracking-wider">Step 3</span>
            </div>
            <div>
              <h3 className="font-semibold text-lg text-text-main mb-1">Sync</h3>
              <p className="text-sm text-text-muted">Upload organized library to Immich</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Recent Activity Section */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-6 text-text-main flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary-500" />
          Recent Activity
        </h2>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
          </div>
        ) : sessions.length > 0 ? (
          <div className="space-y-4">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="p-4 rounded-xl bg-surface-secondary/50 border border-border hover:border-primary-500/20 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-1">
                    {session.status === "completed" ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : session.status === "running" ? (
                      <div className="w-5 h-5 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-yellow-500" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-text-main text-sm">
                        Import from {session.source_label || session.source_path.split("/").pop() || "Source"}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          session.status === "completed"
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : session.status === "running"
                            ? "bg-primary-500/10 text-primary-500 animate-pulse"
                            : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                        }`}
                      >
                        {session.status}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted mt-1 truncate flex items-center gap-1">
                      <span className="truncate max-w-[150px] md:max-w-[250px]" title={session.source_path}>{session.source_path}</span>
                      <ArrowRight className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate max-w-[150px] md:max-w-[250px]" title={session.dest_path}>{session.dest_path}</span>
                    </p>
                    <div className="text-[10px] text-text-muted mt-2 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>{new Date(session.started_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-xs border-t md:border-t-0 pt-3 md:pt-0 border-border">
                  <div className="text-center">
                    <p className="font-semibold text-text-main">{session.imported}</p>
                    <p className="text-[10px] text-text-muted">Imported</p>
                  </div>
                  {session.skipped_duplicates > 0 && (
                    <div className="text-center">
                      <p className="font-semibold text-yellow-600 dark:text-yellow-400">{session.skipped_duplicates}</p>
                      <p className="text-[10px] text-text-muted">Duplicates</p>
                    </div>
                  )}
                  {session.skipped_no_date > 0 && (
                    <div className="text-center">
                      <p className="font-semibold text-text-muted">{session.skipped_no_date}</p>
                      <p className="text-[10px] text-text-muted">No Date</p>
                    </div>
                  )}
                  {session.errors > 0 && (
                    <div className="text-center">
                      <p className="font-semibold text-red-500">{session.errors}</p>
                      <p className="text-[10px] text-text-muted">Errors</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-text-main font-medium">No recent activity</p>
            <p className="text-text-muted text-sm mt-2">Your import and sync history will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}
