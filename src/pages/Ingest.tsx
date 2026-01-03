import { Upload, FolderOpen, HardDrive, Copy, Move } from "lucide-react";
import { useState } from "react";

export function Ingest() {
  const [selectedStrategy, setSelectedStrategy] = useState<'copy' | 'move'>('copy');

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold mb-2">
          <span className="gradient-text">Ingest</span> Media
        </h1>
        <p className="text-slate-400 text-lg">
          Import photos and videos into your canonical archive
        </p>
      </div>

      {/* Drag and Drop Zone */}
      <div className="relative group">
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-2xl opacity-20 blur-xl group-hover:opacity-30 transition-opacity" />
        <div className="relative glass-card p-16 border-2 border-dashed border-slate-600 hover:border-purple-500 transition-all cursor-pointer group-hover:scale-[1.01]">
          <div className="flex flex-col items-center justify-center text-center space-y-6">
            <div className="p-6 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 animate-float">
              <Upload className="w-12 h-12 text-purple-400" />
            </div>
            <div>
              <h3 className="text-2xl font-bold mb-2">Drop files or folders here</h3>
              <p className="text-slate-400">
                or click to browse from your computer
              </p>
            </div>
            <div className="flex gap-2 text-xs text-slate-500">
              <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700">
                Images
              </span>
              <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700">
                Videos
              </span>
              <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700">
                RAW Files
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Source Selection */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-6">Or choose a source</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button className="group flex items-center gap-4 p-6 rounded-xl bg-gradient-to-r from-slate-800/50 to-slate-800/30 border border-slate-700 hover:border-purple-500/50 transition-all hover:scale-[1.02]">
            <div className="p-3 rounded-lg bg-purple-500/20 group-hover:bg-purple-500/30 transition-colors">
              <HardDrive className="w-6 h-6 text-purple-400" />
            </div>
            <div className="text-left">
              <h3 className="font-semibold text-lg text-white">External Device</h3>
              <p className="text-sm text-slate-400">SD Card, USB Drive, Camera</p>
            </div>
          </button>

          <button className="group flex items-center gap-4 p-6 rounded-xl bg-gradient-to-r from-slate-800/50 to-slate-800/30 border border-slate-700 hover:border-blue-500/50 transition-all hover:scale-[1.02]">
            <div className="p-3 rounded-lg bg-blue-500/20 group-hover:bg-blue-500/30 transition-colors">
              <FolderOpen className="w-6 h-6 text-blue-400" />
            </div>
            <div className="text-left">
              <h3 className="font-semibold text-lg text-white">Browse Folder</h3>
              <p className="text-sm text-slate-400">Select from file system</p>
            </div>
          </button>
        </div>
      </div>

      {/* Import Strategy */}
      <div className="glass-card p-8">
        <h2 className="text-2xl font-bold mb-6">Import Strategy</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => setSelectedStrategy('copy')}
            className={`group flex items-start gap-4 p-6 rounded-xl border-2 transition-all ${selectedStrategy === 'copy'
                ? 'bg-purple-500/10 border-purple-500'
                : 'bg-slate-800/30 border-slate-700 hover:border-slate-600'
              }`}
          >
            <div className={`p-3 rounded-lg transition-colors ${selectedStrategy === 'copy'
                ? 'bg-purple-500/20'
                : 'bg-slate-700 group-hover:bg-slate-600'
              }`}>
              <Copy className={`w-6 h-6 ${selectedStrategy === 'copy' ? 'text-purple-400' : 'text-slate-400'
                }`} />
            </div>
            <div className="text-left flex-1">
              <h3 className="font-semibold text-lg text-white mb-1">Copy</h3>
              <p className="text-sm text-slate-400">
                Keeps original files at source (safe option)
              </p>
              {selectedStrategy === 'copy' && (
                <div className="mt-3 flex items-center gap-2 text-xs text-purple-400">
                  <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse-glow" />
                  Selected
                </div>
              )}
            </div>
          </button>

          <button
            onClick={() => setSelectedStrategy('move')}
            className={`group flex items-start gap-4 p-6 rounded-xl border-2 transition-all ${selectedStrategy === 'move'
                ? 'bg-blue-500/10 border-blue-500'
                : 'bg-slate-800/30 border-slate-700 hover:border-slate-600'
              }`}
          >
            <div className={`p-3 rounded-lg transition-colors ${selectedStrategy === 'move'
                ? 'bg-blue-500/20'
                : 'bg-slate-700 group-hover:bg-slate-600'
              }`}>
              <Move className={`w-6 h-6 ${selectedStrategy === 'move' ? 'text-blue-400' : 'text-slate-400'
                }`} />
            </div>
            <div className="text-left flex-1">
              <h3 className="font-semibold text-lg text-white mb-1">Move</h3>
              <p className="text-sm text-slate-400">
                Removes files from source (clears space)
              </p>
              {selectedStrategy === 'move' && (
                <div className="mt-3 flex items-center gap-2 text-xs text-blue-400">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse-glow" />
                  Selected
                </div>
              )}
            </div>
          </button>
        </div>

        <button className="btn-primary w-full mt-8 text-lg py-4 flex items-center justify-center gap-3">
          <Upload className="w-5 h-5" />
          Start Import
        </button>
      </div>
    </div>
  );
}
