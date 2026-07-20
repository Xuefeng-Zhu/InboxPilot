/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KanbanDrawer } from '@/app/inbox/kanban/_components/KanbanDrawer';

vi.mock('@/components/inbox/RightPanel', () => ({
  RightPanel: () => <button type="button">Panel action</button>,
}));

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open details
      </button>
      <KanbanDrawer
        conversationId="conversation-1"
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

describe('KanbanDrawer keyboard behavior', () => {
  it('traps focus, closes on Escape, and restores focus to the trigger', async () => {
    render(<DrawerHarness />);
    const trigger = screen.getByRole('button', { name: 'Open details' });

    trigger.focus();
    fireEvent.click(trigger);

    const close = screen.getByRole('button', { name: 'Close details' });
    const panelAction = screen.getByRole('button', { name: 'Panel action' });
    await waitFor(() => expect(close).toHaveFocus());
    const background = trigger.closest('[aria-hidden="true"]');
    expect(background).not.toBeNull();
    expect(background).toHaveAttribute('inert');

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(panelAction).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(background).not.toHaveAttribute('aria-hidden');
    expect(background).not.toHaveAttribute('inert');
    expect(trigger).toHaveFocus();
  });
});
