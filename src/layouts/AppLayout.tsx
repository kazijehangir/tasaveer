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
    <div className="flex flex-col h-screen bg-slate-900 text-white">
      {/* Horizontal Navigation Bar */}
      <header className="relative border-b border-slate-700/50 backdrop-blur-xl bg-slate-800/50">
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-purple-600/10 via-blue-600/10 to-purple-600/10 pointer-events-none" />

        <div className="relative z-10 px-8 py-4">
          <div className="flex flex-row items-center justify-between">
            {/* Branding */}
            <div className="flex flex-row items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg">
                <span className="text-xl font-bold">T</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold gradient-text leading-none">Tasaveer</h1>
                <p className="text-xs text-slate-500">Media Archive Manager</p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex flex-row items-center gap-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={clsx(
                      "group relative px-6 py-3 rounded-xl transition-all duration-300",
                      isActive
                        ? "glass-card bg-gradient-to-r from-purple-600/20 to-blue-600/20 border-purple-500/50 shadow-lg shadow-purple-500/20"
                        : "glass-card hover:bg-slate-800/50 border-slate-700/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={clsx(
                        "p-2 rounded-lg transition-all duration-300",
                        isActive
                          ? "bg-gradient-to-br from-purple-500 to-blue-500 shadow-md"
                          : "bg-slate-700/50 group-hover:bg-slate-600/50"
                      )}>
                        <Icon className={clsx(
                          "w-4 h-4 transition-colors",
                          isActive ? "text-white" : "text-slate-400 group-hover:text-white"
                        )} />
                      </div>
                      <div>
                        <h3 className={clsx(
                          "font-semibold text-sm transition-colors leading-none",
                          isActive ? "text-white" : "text-slate-300 group-hover:text-white"
                        )}>
                          {item.label}
                        </h3>
                        <p className={clsx(
                          "text-xs transition-colors mt-0.5",
                          isActive ? "text-purple-300" : "text-slate-500 group-hover:text-slate-400"
                        )}>
                          {item.description}
                        </p>
                      </div>
                      {isActive && (
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse-glow" />
                      )}
                    </div>
                  </Link>
                );
              })}
            </nav>

            {/* Version Badge */}
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse-glow" />
              <span>v0.1.0</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-slate-900 p-8">
        <Outlet />
      </main>
    </div>
  );
}
