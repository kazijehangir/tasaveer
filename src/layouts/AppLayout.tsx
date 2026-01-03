import { Link, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, Import, RefreshCw, Settings } from "lucide-react";
import { clsx } from "clsx";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/ingest", label: "Ingest", icon: Import },
  { path: "/sync", label: "Sync", icon: RefreshCw },
  { path: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout() {
  const location = useLocation();

  return (
    <div className="flex h-screen bg-slate-900 text-white">
      {/* Sidebar */}
      <aside className="w-64 glass-card border-r border-slate-700/50 flex flex-col relative">
        {/* Gradient overlay for branding area */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-br from-purple-600/10 to-blue-600/10 pointer-events-none" />

        <div className="p-6 relative z-10">
          <h1 className="text-3xl font-bold gradient-text">Tasaveer</h1>
          <p className="text-xs text-slate-500 mt-1">Media Archive Manager</p>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={clsx(
                  "flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium",
                  isActive
                    ? "bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/30"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-white"
                )}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-700/50">
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse-glow" />
            <span>v0.1.0</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-slate-900 p-8">
        <Outlet />
      </main>
    </div>
  );
}
