import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({
    className,
    label,
    error,
    leftIcon,
    rightIcon,
    ...props
}, ref) => {
    return (
        <div className="w-full">
            {label && (
                <label className="block text-sm font-medium text-text-muted mb-1.5 ml-1">
                    {label}
                </label>
            )}
            <div className="relative group">
                {leftIcon && (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted transition-colors group-focus-within:text-primary-400">
                        {leftIcon}
                    </div>
                )}
                <input
                    ref={ref}
                    className={twMerge(clsx(
                        "w-full bg-surface border border-border rounded-xl text-text-main placeholder:text-text-muted transition-all duration-300",
                        "focus:outline-none focus:border-primary-500/50 focus:ring-2 focus:ring-primary-500/20 focus:bg-surface/80",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                        "input-field",
                        leftIcon ? "pl-10" : "pl-4",
                        rightIcon ? "pr-10" : "pr-4",
                        error ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20" : "",
                        className
                    ))}
                    {...props}
                />
                {rightIcon && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">
                        {rightIcon}
                    </div>
                )}
            </div>
            {error && (
                <p className="mt-1.5 text-xs text-red-500 ml-1 animate-fade-in">
                    {error}
                </p>
            )}
        </div>
    );
});

Input.displayName = 'Input';
