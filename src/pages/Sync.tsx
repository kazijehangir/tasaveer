export function Sync() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Sync to Immich</h1>
      <div className="bg-neutral-800 p-6 rounded-xl border border-neutral-700">
        <p className="text-neutral-400">Sync configuration will appear here.</p>
        <button className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          Start Sync
        </button>
      </div>
    </div>
  );
}
