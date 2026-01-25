import { render, screen, fireEvent } from '@testing-library/react';
import { Sync } from '../Sync';

describe('Sync Page', () => {
    it('renders initial state correctly', () => {
        render(<Sync />);

        expect(screen.getByText(/Sync/i, { selector: 'h1 span' })).toBeInTheDocument();
        expect(screen.getByText('Immich Server')).toBeInTheDocument();

        // Sync Options
        expect(screen.getByText('Sync All Media')).toBeInTheDocument();

        // Checkboxes rendering
        const syncAllCheckbox = screen.getByLabelText(/Sync All Media/i);
        expect(syncAllCheckbox).toBeChecked();
        expect(syncAllCheckbox).toBeEnabled();

        expect(screen.getByLabelText(/Incremental Sync/i)).toBeDisabled();
        expect(screen.getByLabelText(/Selective Sync/i)).toBeDisabled();

        // Start button disabled by default (mock logic might need checks but based on code it is disabled)
        expect(screen.getByText('Start Sync').closest('button')).toBeDisabled();
    });

    it('toggles sync all checkbox', () => {
        render(<Sync />);

        const syncAllCheckbox = screen.getByLabelText(/Sync All Media/i);
        expect(syncAllCheckbox).toBeChecked();

        fireEvent.click(syncAllCheckbox);
        expect(syncAllCheckbox).not.toBeChecked();

        fireEvent.click(syncAllCheckbox);
        expect(syncAllCheckbox).toBeChecked();
    });
});
