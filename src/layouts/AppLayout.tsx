import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { useEffect, useState } from "react";
import { useUIStore } from "../store/uiStore";

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("dashboard");
  const { theme, initTheme } = useUIStore();

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  // Sync route with active tab
  useEffect(() => {
    const path = location.pathname;
    if (path === "/") setActiveTab("dashboard");
    else if (path === "/ingest") setActiveTab("ingest");
    else if (path === "/organize") setActiveTab("organize");
    else if (path === "/clean") setActiveTab("cleanup");
    else if (path === "/sync") setActiveTab("sync");
    else if (path === "/settings") setActiveTab("settings");
  }, [location.pathname]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId === "dashboard") navigate("/");
    else if (tabId === "cleanup") navigate("/clean");
    else if (tabId === "settings") navigate("/settings");
    else navigate(`/${tabId}`);
  };

  return (
    <div className="flex min-h-screen bg-background text-text-main font-sans selection:bg-primary-500/30">
      {/* Sidebar - Fixed Position */}
      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Main Content Area */}
      <main className="flex-1 ml-64 p-8 relative">
        {/* Background Ambient Glow - Removed for cleaner Tahoe look */}
        {/* <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-primary-600/20 rounded-full blur-[128px] opacity-50" />
          <div className="absolute bottom-[-10%] left-[20%] w-[400px] h-[400px] bg-accent-600/10 rounded-full blur-[128px] opacity-40" />
        </div> */}

        {/* Content Container */}
        <div className="relative z-10 max-w-7xl mx-auto animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

