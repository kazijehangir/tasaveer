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
    <div className="flex h-screen bg-neutral-900 text-white">
      {/* Sidebar */}
      <aside className="w-64 bg-neutral-800 border-r border-neutral-700 flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-blue-500">Tasaveer</h1>
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
                  "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-neutral-400 hover:bg-neutral-700 hover:text-white"
                )}
              >
                <Icon size={20} />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-neutral-700 text-xs text-neutral-500 text-center">
          v0.1.0
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-neutral-900 p-8">
        <Outlet />
      </main>
    </div>
  );
}
