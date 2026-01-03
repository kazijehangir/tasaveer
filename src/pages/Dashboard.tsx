export function Dashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-neutral-800 p-6 rounded-xl border border-neutral-700">
          <h3 className="text-lg font-medium text-neutral-400">Total Media</h3>
          <p className="text-4xl font-bold mt-2">0</p>
        </div>
        <div className="bg-neutral-800 p-6 rounded-xl border border-neutral-700">
          <h3 className="text-lg font-medium text-neutral-400">Last Sync</h3>
          <p className="text-xl font-bold mt-2 text-yellow-500">Never</p>
        </div>
        <div className="bg-neutral-800 p-6 rounded-xl border border-neutral-700">
          <h3 className="text-lg font-medium text-neutral-400">Storage Used</h3>
          <p className="text-4xl font-bold mt-2">0 GB</p>
        </div>
      </div>
    </div>
  );
}
