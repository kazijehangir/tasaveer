import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from '../Input';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

describe('Input', () => {
    it('renders with label', () => {
        render(<Input label="Username" />);
        expect(screen.getByText('Username')).toBeInTheDocument();
    });

    it('displays error message', () => {
        render(<Input error="Required field" />);
        expect(screen.getByText('Required field')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveClass('border-red-500/50');
    });

    it('handles value changes', () => {
        const handleChange = vi.fn();
        render(<Input onChange={handleChange} />);
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'test' } });
        expect(handleChange).toHaveBeenCalledTimes(1);
    });

    it('renders left and right icons', () => {
        render(
            <Input 
                leftIcon={<span data-testid="left-icon">L</span>}
                rightIcon={<span data-testid="right-icon">R</span>}
            />
        );
        expect(screen.getByTestId('left-icon')).toBeInTheDocument();
        expect(screen.getByTestId('right-icon')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveClass('pl-10');
        expect(screen.getByRole('textbox')).toHaveClass('pr-10');
    });

    it('forwards ref correctly', () => {
        const ref = React.createRef<HTMLInputElement>();
        render(<Input ref={ref} />);
        expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it('is disabled when the disabled prop is true', () => {
        render(<Input disabled />);
        expect(screen.getByRole('textbox')).toBeDisabled();
    });
});
