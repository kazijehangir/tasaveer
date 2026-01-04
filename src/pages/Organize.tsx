import { Link } from "react-router-dom";
import { ArrowLeft, FolderHeart } from "lucide-react";

export function Organize() {
    return (
        <div className="space-y-8 animate-fade-in text-center py-20">
            <div className="flex justify-center">
                <div className="p-4 rounded-2xl bg-pink-500/10 mb-4">
                    <FolderHeart className="w-12 h-12 text-pink-400" />
                </div>
            </div>

            <h1 className="text-4xl font-bold">
                Tag & <span className="gradient-text">Categorize</span>
            </h1>

            <p className="text-xl text-slate-400 max-w-lg mx-auto">
                This feature is coming soon! It will help you organize your photos into meaningful categories for Immich.
            </p>

            <div className="pt-8">
                <Link
                    to="/"
                    className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Dashboard
                </Link>
            </div>
        </div>
    );
}
