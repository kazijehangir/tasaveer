import { Link, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, Import, RefreshCw, Settings } from "lucide-react";
import { clsx } from "clsx";

const NAV_ITEMS = [
  {
    path: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "Overview and stats"
  },
  {
    path: "/ingest",
    label: "Ingest",
    icon: Import,
    description: "Import media files"
  },
  {
    path: "/sync",
    label: "Sync",
    icon: RefreshCw,
    description: "Sync to Immich"
  },
  {
    path: "/settings",
    label: "Settings",
    icon: Settings,
    description: "Configure app"
  },
];

export function AppLayout() {
  const location = useLocation();

  return (
    <div className="flex h-screen bg-slate-900 text-white">
      {/* Sidebar */}
      <aside className="w-80 glass-card border-r border-slate-700/50 flex flex-col relative">
        {/* Gradient overlay for branding area */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-br from-purple-600/10 to-blue-600/10 pointer-events-none" />

        <div className="p-6 relative z-10">
          <h1 className="text-3xl font-bold gradient-text">Tasaveer</h1>
          <p className="text-xs text-slate-500 mt-1">Media Archive Manager</p>
        </div>

        <nav className="flex-1 px-4 space-y-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={clsx(
                  "group block p-4 rounded-xl transition-all duration-300",
                  isActive
                    ? "glass-card bg-gradient-to-r from-purple-600/20 to-blue-600/20 border-purple-500/50 shadow-lg shadow-purple-500/20"
                    : "glass-card hover:bg-slate-800/50 border-slate-700/50"
                )}
              >
                <div className="flex items-start gap-4">
                  <div className={clsx(
                    "p-3 rounded-lg transition-all duration-300",
                    isActive
                      ? "bg-gradient-to-br from-purple-500 to-blue-500 shadow-md"
                      : "bg-slate-700/50 group-hover:bg-slate-600/50"
                  )}>
                    <Icon className={clsx(
                      "w-5 h-5 transition-colors",
                      isActive ? "text-white" : "text-slate-400 group-hover:text-white"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className={clsx(
                      "font-semibold text-base mb-0.5 transition-colors",
                      isActive ? "text-white" : "text-slate-300 group-hover:text-white"
                    )}>
                      {item.label}
                    </h3>
                    <p className={clsx(
                      "text-xs transition-colors",
                      isActive ? "text-purple-300" : "text-slate-500 group-hover:text-slate-400"
                    )}>
                      {item.description}
                    </p>
                  </div>
                  {isActive && (
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse-glow mt-2" />
                  )}
                </div>
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
