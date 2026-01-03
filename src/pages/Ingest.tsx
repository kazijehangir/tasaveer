import { Upload, FolderOpen, HardDrive, Copy, Move, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Command } from "@tauri-apps/plugin-shell";

export function Ingest() {
  const [selectedStrategy, setSelectedStrategy] = useState<'copy' | 'move'>('copy');
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [destPath, setDestPath] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [logs, setLogs] = useState<string[]>([]);

  const handleSelectSource = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Source Folder",
      });
      if (selected) {
        setSourcePath(selected as string);
      }
    } catch (err) {
      console.error("Failed to select source:", err);
    }
  };

  const handleSelectDest = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Destination Folder",
      });
      if (selected) {
        setDestPath(selected as string);
      }
    } catch (err) {
      console.error("Failed to select destination:", err);
    }
  };

  const handleIngest = async () => {
    if (!sourcePath || !destPath) return;

    setStatus('running');
    setLogs([]);

    try {
      const args = [sourcePath, destPath];
      if (selectedStrategy === 'move') {
        args.push('--move');
      }

      const command = Command.create('phockup', args);

      command.on('close', (data) => {
        if (data.code === 0) {
          setStatus('success');
          setLogs(prev => [...prev, `Process finished successfully!`]);
        } else {
          setStatus('error');
          setLogs(prev => [...prev, `Process exited with code ${data.code}`]);
        }
      });

      command.on('error', (error) => {
        setStatus('error');
        setLogs(prev => [...prev, `Error: ${error}`]);
      });

      command.stdout.on('data', (line) => {
        setLogs(prev => [...prev, line]);
      });

      command.stderr.on('data', (line) => {
        setLogs(prev => [...prev, line]);
      });

      await command.spawn();

    } catch (err) {
      setStatus('error');
      setLogs(prev => [...prev, `Failed to start process: ${err}`]);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold mb-2">
          <span className="gradient-text">Ingest</span> Media
        </h1>
        <p className="text-slate-400 text-lg">
          Import photos and videos into your canonical archive
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-8">
          {/* Source Selection */}
          <div className="glass-card p-8">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm">1</span>
              Select Source
            </h2>

            {!sourcePath ? (
              <div className="grid grid-cols-1 gap-4">
                <button onClick={handleSelectSource} className="group flex items-center gap-4 p-6 rounded-xl bg-gradient-to-r from-slate-800/50 to-slate-800/30 border border-slate-700 hover:border-purple-500/50 transition-all hover:scale-[1.02]">
                  <div className="p-3 rounded-lg bg-purple-500/20 group-hover:bg-purple-500/30 transition-colors">
                    <HardDrive className="w-6 h-6 text-purple-400" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-semibold text-lg text-white">Browse Folder</h3>
                    <p className="text-sm text-slate-400">Select source directory</p>
                  </div>
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-800/50 border border-green-500/30 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-2 rounded-lg bg-green-500/20 text-green-400">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="truncate">
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">Source</p>
                    <p className="text-sm font-medium truncate" title={sourcePath}>{sourcePath}</p>
                  </div>
                </div>
                  <button onClick={() => setSourcePath(null)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                    Change
                  </button>
                </div>
            )}
          </div>

          {/* Destination Selection */}
          <div className="glass-card p-8">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm">2</span>
              Select Destination
            </h2>

            {!destPath ? (
              <button onClick={handleSelectDest} className="w-full group flex items-center gap-4 p-6 rounded-xl bg-gradient-to-r from-slate-800/50 to-slate-800/30 border border-slate-700 hover:border-blue-500/50 transition-all hover:scale-[1.02]">
                <div className="p-3 rounded-lg bg-blue-500/20 group-hover:bg-blue-500/30 transition-colors">
                  <FolderOpen className="w-6 h-6 text-blue-400" />
                </div>
                <div className="text-left">
                  <h3 className="font-semibold text-lg text-white">Browse Folder</h3>
                  <p className="text-sm text-slate-400">Select destination archive</p>
                </div>
              </button>
            ) : (
              <div className="p-4 rounded-xl bg-slate-800/50 border border-green-500/30 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-2 rounded-lg bg-green-500/20 text-green-400">
                    <FolderOpen className="w-5 h-5" />
                  </div>
                  <div className="truncate">
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">Destination</p>
                    <p className="text-sm font-medium truncate" title={destPath}>{destPath}</p>
                  </div>
                </div>
                <button onClick={() => setDestPath(null)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                  Change
                  </button>
                </div>
            )}
          </div>

          {/* Import Strategy */}
          <div className="glass-card p-8">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm">3</span>
              Import Strategy
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setSelectedStrategy('copy')}
                style={selectedStrategy === 'copy' ? {
                  backgroundColor: 'rgba(168, 85, 247, 0.1)', // purple-500/10
                  borderColor: 'rgba(168, 85, 247, 1)',       // purple-500
                } : {}}
                className={`group relative z-10 cursor-pointer flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${selectedStrategy === 'copy'
                  ? '' // Handled by style
                  : 'bg-slate-800/30 border-slate-700 hover:border-slate-600'
                  }`}
              >
                <div className={`p-2 rounded-lg transition-colors ${selectedStrategy === 'copy'
                  ? 'bg-purple-500/20'
                  : 'bg-slate-700 group-hover:bg-slate-600'
                  }`}>
                  <Copy className={`w-5 h-5 ${selectedStrategy === 'copy' ? 'text-purple-400' : 'text-slate-400'
                    }`} />
                </div>
                <div className="text-left flex-1">
                  <h3 className="font-semibold text-base text-white mb-1">Copy</h3>
                  <p className="text-xs text-slate-400">
                    Keeps original files (safe)
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStrategy('move')}
                style={selectedStrategy === 'move' ? {
                  backgroundColor: 'rgba(59, 130, 246, 0.1)', // blue-500/10
                  borderColor: 'rgba(59, 130, 246, 1)',       // blue-500
                } : {}}
                className={`group relative z-10 cursor-pointer flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${selectedStrategy === 'move'
                  ? '' // Handled by style
                  : 'bg-slate-800/30 border-slate-700 hover:border-slate-600'
                  }`}
              >
                <div className={`p-2 rounded-lg transition-colors ${selectedStrategy === 'move'
                  ? 'bg-blue-500/20'
                  : 'bg-slate-700 group-hover:bg-slate-600'
                  }`}>
                  <Move className={`w-5 h-5 ${selectedStrategy === 'move' ? 'text-blue-400' : 'text-slate-400'
                    }`} />
                </div>
                <div className="text-left flex-1">
                  <h3 className="font-semibold text-base text-white mb-1">Move</h3>
                  <p className="text-xs text-slate-400">
                    Deletes source (clears space)
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Status & Action */}
        <div className="space-y-8">
          <div className="glass-card p-8 h-full flex flex-col">
            <h2 className="text-xl font-bold mb-6">Status</h2>

            <div className="flex-1 bg-slate-950/50 rounded-xl p-4 font-mono text-xs overflow-y-auto max-h-[400px] border border-slate-800/50">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600">
                  <p>Ready to ingest</p>
                </div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="mb-1 text-slate-300 break-all">{log}</div>
                ))
              )}
            </div>

            <button
              onClick={handleIngest}
              disabled={!sourcePath || !destPath || status === 'running'}
              className={`btn-primary w-full mt-8 text-lg py-4 flex items-center justify-center gap-3 ${(!sourcePath || !destPath || status === 'running') ? 'opacity-50 cursor-not-allowed grayscale' : ''
                }`}
            >
              {status === 'running' ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Ingesting...
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  Start Import
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
