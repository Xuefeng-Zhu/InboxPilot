/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PreChatForm } from '../../app/wchat/[widgetId]/PreChatForm';

describe('PreChatForm', () => {
  it('submits trimmed visitor details', () => {
    const onSubmit = vi.fn();
    render(<PreChatForm color="#123456" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Your name'), {
      target: { value: '  Ada  ' },
    });
    fireEvent.change(screen.getByLabelText('Your email'), {
      target: { value: '  ada@example.com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start Chat' }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@example.com',
    });
  });
});
