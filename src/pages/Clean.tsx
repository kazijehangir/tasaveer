import { Link } from "react-router-dom";
import { ArrowLeft, Sparkles } from "lucide-react";

export function Clean() {
    return (
        <div className="space-y-8 animate-fade-in text-center py-20">
            <div className="flex justify-center">
                <div className="p-4 rounded-2xl bg-purple-500/10 mb-4">
                    <Sparkles className="w-12 h-12 text-purple-400" />
                </div>
            </div>

            <h1 className="text-4xl font-bold">
                Clean & <span className="gradient-text">Dedup</span>
            </h1>

            <p className="text-xl text-slate-400 max-w-lg mx-auto">
                This feature is coming soon! It will allow you to extract missing metadata and deduplicate your media collection.
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
