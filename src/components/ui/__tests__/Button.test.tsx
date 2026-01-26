import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../Button';
import { describe, it, expect, vi } from 'vitest';

describe('Button', () => {
    it('renders with children', () => {
        render(<Button>Click me</Button>);
        expect(screen.getByText('Click me')).toBeInTheDocument();
    });

    it('handles click events', () => {
        const handleClick = vi.fn();
        render(<Button onClick={handleClick}>Click me</Button>);
        fireEvent.click(screen.getByText('Click me'));
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('shows loading state and disables button', () => {
        render(<Button isLoading>Click me</Button>);
        const button = screen.getByRole('button');
        expect(button).toBeDisabled();
        expect(button.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('is disabled when the disabled prop is true', () => {
        render(<Button disabled>Click me</Button>);
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('renders left and right icons', () => {
        render(
            <Button 
                leftIcon={<span data-testid="left-icon">left</span>}
                rightIcon={<span data-testid="right-icon">right</span>}
            >
                Icon Button
            </Button>
        );
        expect(screen.getByTestId('left-icon')).toBeInTheDocument();
        expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    });

    it('applies variant classes correctly', () => {
        const { rerender } = render(<Button variant="primary">Primary</Button>);
        expect(screen.getByRole('button')).toHaveClass('btn-primary');

        rerender(<Button variant="danger">Danger</Button>);
        expect(screen.getByRole('button')).toHaveClass('text-red-600');
    });

    it('applies size classes correctly', () => {
        const { rerender } = render(<Button size="sm">Small</Button>);
        expect(screen.getByRole('button')).toHaveClass('text-xs');

        rerender(<Button size="lg">Large</Button>);
        expect(screen.getByRole('button')).toHaveClass('text-base');
    });
});
