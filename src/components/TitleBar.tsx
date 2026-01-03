import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar() {
  const appWindow = getCurrentWindow();

  const handleMinimize = () => {
    appWindow.minimize();
  };

  const handleMaximize = () => {
    appWindow.toggleMaximize();
  };

  const handleClose = () => {
    appWindow.close();
  };

  return (
    <div
      data-tauri-drag-region
      className="h-12 flex items-center justify-between px-4 select-none bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border-b border-slate-700/50 relative overflow-hidden"
    >
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-purple-600/5 via-blue-600/5 to-purple-600/5 pointer-events-none" />
      
      {/* App Title */}
      <div className="relative z-10 flex items-center gap-3">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
          <span className="text-xs font-bold">T</span>
        </div>
        <span className="text-sm font-semibold gradient-text">Tasaveer</span>
      </div>

      {/* Window Controls */}
      <div className="relative z-10 flex items-center gap-2">
        <button
          onClick={handleMinimize}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-700/50 transition-colors group"
          aria-label="Minimize"
        >
          <Minus className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-700/50 transition-colors group"
          aria-label="Maximize"
        >
          <Square className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-colors" />
        </button>
        <button
          onClick={handleClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-500/80 transition-colors group"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
        </button>
      </div>
    </div>
  );
}
