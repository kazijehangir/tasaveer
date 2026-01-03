export function Settings() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      <div className="space-y-4 max-w-2xl">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-neutral-400">Canonical Archive Path</label>
          <div className="flex gap-2">
            <input 
              type="text" 
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
              placeholder="/Users/username/Pictures/Archive"
            />
            <button className="px-4 py-2 bg-neutral-700 text-white rounded-lg hover:bg-neutral-600">Browse</button>
          </div>
        </div>
        
        <div className="space-y-2">
          <label className="block text-sm font-medium text-neutral-400">Immich Server URL</label>
          <input 
            type="text" 
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            placeholder="http://192.168.1.100:2283"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-neutral-400">Immich API Key</label>
          <input 
            type="password" 
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            placeholder="API Key"
          />
        </div>
      </div>
    </div>
  );
}
