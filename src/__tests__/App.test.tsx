import { render, screen } from '@testing-library/react';
import App from '../App';
import { describe, it, expect } from 'vitest';

describe('App Component', () => {
    it('renders the complete application routing structure', () => {
        render(<App />);
        
        // AppLayout sidebar and branding should be visible
        expect(screen.getAllByText('Tasaveer')[0]).toBeInTheDocument();
        
        // Default route is Dashboard, so Home should be the active layout context
        expect(screen.getByText('Import media from external devices')).toBeInTheDocument();
    });
});
