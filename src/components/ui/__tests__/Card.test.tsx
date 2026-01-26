import { render, screen, fireEvent } from '@testing-library/react';
import { Card } from '../Card';
import { describe, it, expect, vi } from 'vitest';

describe('Card', () => {
    it('renders with children', () => {
        render(<Card>Card Content</Card>);
        expect(screen.getByText('Card Content')).toBeInTheDocument();
    });

    it('handles click events if provided', () => {
        const handleClick = vi.fn();
        render(<Card onClick={handleClick}>Clickable Card</Card>);
        fireEvent.click(screen.getByText('Clickable Card'));
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('applies variant classes correctly', () => {
        const { rerender, container } = render(<Card variant="glass">Glass Card</Card>);
        expect(container.firstChild).toHaveClass('glass-card');

        rerender(<Card variant="default">Default Card</Card>);
        expect(container.firstChild).toHaveClass('bg-surface');
        expect(container.firstChild).toHaveClass('border-border');
    });

    it('applies custom className', () => {
        const { container } = render(<Card className="custom-class">Content</Card>);
        expect(container.firstChild).toHaveClass('custom-class');
    });
});
