import { Link, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, Import, RefreshCw, Sparkles, FolderHeart } from "lucide-react";
import { clsx } from "clsx";

const NAV_ITEMS = [
  {
    path: "/",
    label: "Home",
    icon: LayoutDashboard,
  },
  {
    path: "/ingest",
    label: "Ingest",
    icon: Import,
    step: 1
  },
  {
    path: "/clean",
    label: "Clean",
    icon: Sparkles,
    step: 2
  },
  {
    path: "/organize",
    label: "Organize",
    icon: FolderHeart,
    step: 3
  },
  {
    path: "/sync",
    label: "Sync",
    icon: RefreshCw,
    step: 4
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
            <nav className="flex flex-row items-center gap-2">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={clsx(
                      "group relative px-4 py-2 rounded-lg transition-all duration-300 flex items-center gap-3",
                      isActive
                        ? "bg-slate-700/50 text-white shadow-sm ring-1 ring-white/10"
                        : "hover:bg-slate-800/50 text-slate-300 hover:text-white"
                    )}
                  >
                    {/* Badge for Step Number */}
                    {item.step && (
                      <div className={clsx(
                        "flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold font-mono transition-colors",
                        isActive
                          ? "bg-blue-500/20 text-blue-300"
                          : "bg-slate-800 text-slate-400 group-hover:bg-slate-700 group-hover:text-slate-300"
                      )}>
                        {item.step}
                      </div>
                    )}

                    <Icon className={clsx(
                      "w-4 h-4 transition-colors",
                      isActive ? "text-purple-400" : "text-slate-500 group-hover:text-purple-400/70"
                    )} />

                    <span className="font-medium text-sm">
                      {item.label}
                    </span>

                    {isActive && (
                      <div className="absolute inset-x-0 -bottom-[17px] h-0.5 bg-gradient-to-r from-purple-500 to-blue-500" />
                    )}
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
