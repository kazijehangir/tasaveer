import { Archive } from "lucide-react";

export function Organize() {
    return (
        <div className="flex flex-col items-center justify-center h-full text-text-muted animate-fade-in">
            <div className="p-4 rounded-full bg-neutral-200 dark:bg-slate-800 mb-6">
                <Archive className="w-12 h-12 text-neutral-500 dark:text-slate-600" />
            </div>
            <h1 className="text-3xl font-bold text-text-main mb-4">Tag & Categorize</h1>
            <div className="glass-card p-8 max-w-lg text-center backdrop-blur-sm">
                <p className="mb-4 text-lg text-text-main">
                    This feature has been consolidated into the <span className="text-primary-500 font-bold">Ingest</span> workflow.
                </p>
                <p className="text-sm text-text-muted">
                    You can now Scan, Tag, and Categorize your media directly during the import process. This ensures your source files remain untouched and tags are applied before organization.
                </p>
            </div>
        </div>
    );
}
