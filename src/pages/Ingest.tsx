import { Upload, FolderOpen, HardDrive, Copy, Move, CheckCircle2, ChevronDown, ChevronUp, XCircle } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Command } from "@tauri-apps/plugin-shell";

export function Ingest() {
  const [selectedStrategy, setSelectedStrategy] = useState<'copy' | 'move'>('copy');
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [destPath, setDestPath] = useState<string | null>(null);
  const [defaultArchivePath, setDefaultArchivePath] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [isLogsExpanded, setIsLogsExpanded] = useState(false);
  const runningCommandsRef = useRef<Array<{ kill: () => Promise<void> }>>([]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    async function loadDefaults() {
      try {
        const settingsStr = await invoke<string>("load_settings");
        if (settingsStr) {
          const settings = JSON.parse(settingsStr);
          if (settings.archivePath) {
            setDefaultArchivePath(settings.archivePath);
            setDestPath(settings.archivePath);
          }
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    }
    loadDefaults();
  }, []);

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

  const handleCancel = async () => {
    setLogs(prev => [...prev, 'Canceling operations...']);
    cancelledRef.current = true;

    // Kill all running commands
    for (const cmd of runningCommandsRef.current) {
      try {
        await cmd.kill();
        setLogs(prev => [...prev, 'Killed running process.']);
      } catch (err) {
        console.error('Failed to kill command:', err);
        setLogs(prev => [...prev, `Failed to kill process: ${err}`]);
      }
    }

    runningCommandsRef.current = [];
    setLogs(prev => [...prev, 'Operation canceled by user.']);
    setStatus('idle'); // Reset to idle so user can start again
  };

  const handleIngest = async () => {
    if (!sourcePath || !destPath) return;

    setStatus('running');
    setLogs([]);
    setIsLogsExpanded(true); // Auto-expand logs to show progress of multiple steps
    runningCommandsRef.current = []; // Reset commands
    cancelledRef.current = false; // Reset cancellation flag

    try {
      // Helper to spawn phockup with specific file type
      const runPhockup = (type: 'image' | 'video') => {
        return new Promise<void>(async (resolve, reject) => {
          const args = [sourcePath, destPath, '--date', 'YYYY/YYYY-MM-DD', '--progress', '--file-type', type];

          if (selectedStrategy === 'move') {
            args.push('--move');
          }

          setLogs(prev => [...prev, `Starting ingest for ${type}s...`]);

          const command = Command.create('phockup', args);

          let cancelled = false;
          let child: Awaited<ReturnType<typeof command.spawn>> | null = null;

          command.on('close', (data) => {
            if (cancelled) return;

            // Remove this command from the running list
            if (child) {
              runningCommandsRef.current = runningCommandsRef.current.filter(c => c !== child);
            }

            if (data.code === 0) {
              setLogs(prev => [...prev, `Finished ${type}s successfully.`]);
              resolve();
            } else if (data.code === null) {
              // Process was killed (e.g., by cancel button)
              setLogs(prev => [...prev, `Process for ${type}s was terminated.`]);
              resolve();
            } else {
              setLogs(prev => [...prev, `Process for ${type}s exited with code ${data.code}`]);
              // We don't necessarily want to reject here if one fails, maybe? 
              // But for now let's assume strict success needed.
              // Actually, if no images found it might exit 0? 
              resolve();
            }
          });

          command.on('error', (error) => {
            if (cancelled) return;

            // Remove this command from the running list
            if (child) {
              runningCommandsRef.current = runningCommandsRef.current.filter(c => c !== child);
            }

            setLogs(prev => [...prev, `Error processing ${type}s: ${error}`]);
            reject(error);
          });

          command.stdout.on('data', (line) => {
            if (cancelled) return;
            setLogs(prev => [...prev, line]);
          });

          command.stderr.on('data', (line) => {
            if (cancelled) return;
            setLogs(prev => [...prev, line]);
          });

          try {
            child = await command.spawn();

            // Check if we were cancelled while spawning
            if (cancelledRef.current) {
              cancelled = true;
              await child.kill();
              reject(new Error('Cancelled'));
              return;
            }

            runningCommandsRef.current.push(child);
          } catch (err) {
            setLogs(prev => [...prev, `Failed to spawn process for ${type}s: ${err}`]);
            reject(err);
          }
        });
      };

      // Run sequentially
      await runPhockup('image');

      // Check if we should continue
      if (cancelledRef.current) {
        return;
      }

      await runPhockup('video');

      // Only set success if we're still running (not cancelled)
      if (!cancelledRef.current) {
        setStatus('success');
        setLogs(prev => [...prev, `All operations completed!`]);
      }

    } catch (err) {
      // Only update status if not cancelled
      if (!cancelledRef.current) {
        setStatus('error');
        setLogs(prev => [...prev, `Failed to execute ingest: ${err}`]);
      }
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
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">Destination</p>
                        {destPath === defaultArchivePath && (
                          <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30">Default</span>
                        )}
                      </div>
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
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Status</h2>
              <button
                onClick={() => setIsLogsExpanded(!isLogsExpanded)}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-xs uppercase font-bold tracking-wider"
              >
                {isLogsExpanded ? (
                  <>Hide Logs <ChevronUp className="w-4 h-4" /></>
                ) : (
                  <>Show All <ChevronDown className="w-4 h-4" /></>
                )}
              </button>
            </div>

            <div className={`bg-slate-950/50 rounded-xl font-mono text-xs border border-slate-800/50 overflow-hidden transition-all duration-300 ${isLogsExpanded ? 'flex-1 p-4 overflow-y-auto max-h-[400px]' : 'p-4'}`}>
              {logs.length === 0 ? (
                <div className={`flex flex-col items-center justify-center text-slate-600 ${isLogsExpanded ? 'h-full' : ''}`}>
                  <p>Ready to ingest</p>
                </div>
              ) : (
                  isLogsExpanded ? (
                    logs.map((log, i) => (
                      <div key={i} className="mb-1 text-slate-300 break-all border-b border-transparent hover:border-slate-800/50">{log}</div>
                    ))
                  ) : (
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-slate-300 truncate font-medium">
                        <span className="text-slate-500 mr-2">[{new Date().toLocaleTimeString()}]</span>
                        {logs[logs.length - 1]}
                      </div>
                      <div className="flex gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-500/50 animate-pulse" />
                      </div>
                    </div>
                  )
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

            {status === 'running' && (
              <button
                onClick={handleCancel}
                className="btn-secondary w-full mt-4 text-lg py-4 flex items-center justify-center gap-3 border-red-500/30 hover:border-red-500/50 hover:bg-red-500/10 text-red-400 hover:text-red-300"
              >
                <XCircle className="w-5 h-5" />
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
