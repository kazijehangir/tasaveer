import { render, screen } from '@testing-library/react';
import { Organize } from '../Organize';

describe('Organize Page', () => {
    it('renders correctly', () => {
        render(<Organize />);
        expect(screen.getByText('Tag & Categorize')).toBeInTheDocument();
        expect(screen.getByText(/consolidated into the/i)).toBeInTheDocument();
        expect(screen.getByText('Ingest')).toBeInTheDocument();
    });
});
