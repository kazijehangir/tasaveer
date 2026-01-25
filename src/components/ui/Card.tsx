import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    variant?: 'glass' | 'gradient' | 'default';
    onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
    children,
    className = '',
    variant = 'glass',
    onClick
}) => {
    const baseStyles = "rounded-2xl p-6 transition-all duration-300";

    const variants = {
        glass: "glass-card hover:glass-card-hover",
        gradient: "gradient-border-card bg-surface backdrop-blur-md",
        default: "bg-surface border border-border"
    };

    return (
        <div
            className={`${baseStyles} ${variants[variant]} ${className}`}
            onClick={onClick}
        >
            {children}
        </div>
    );
};
