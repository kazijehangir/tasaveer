export function Ingest() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Ingest Media</h1>
      <div className="bg-neutral-800 p-12 rounded-xl border-2 border-dashed border-neutral-700 flex flex-col items-center justify-center text-neutral-400 hover:border-blue-500 hover:text-blue-500 transition-colors cursor-pointer">
        <span className="text-lg">Drag and drop folder here</span>
        <span className="text-sm mt-2">or click to select</span>
      </div>
    </div>
  );
}
