import { Archive } from "lucide-react";

export function Organize() {
    return (
        <div className="flex flex-col items-center justify-center h-full text-slate-400 animate-fade-in">
            <div className="p-4 rounded-full bg-slate-800 mb-6">
                <Archive className="w-12 h-12 text-slate-600" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-4">Tag & Categorize</h1>
            <div className="bg-slate-800/50 p-8 rounded-xl border border-slate-700 max-w-lg text-center backdrop-blur-sm">
                <p className="mb-4 text-lg">
                    This feature has been consolidated into the <span className="text-purple-400 font-bold">Ingest</span> workflow.
                </p>
                <p className="text-sm text-slate-500">
                    You can now Scan, Tag, and Categorize your media directly during the import process. This ensures your source files remain untouched and tags are applied before organization.
                </p>
            </div>
        </div>
    );
}
