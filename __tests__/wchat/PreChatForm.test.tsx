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

  it('keeps identification failures visible and blocks duplicate submission', () => {
    const onSubmit = vi.fn();
    render(
      <PreChatForm
        color="#123456"
        error="We could not identify you. Try again."
        submitting
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'We could not identify you. Try again.',
    );
    expect((screen.getByLabelText('Your name') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Your email') as HTMLInputElement).disabled).toBe(true);

    const submitButton = screen.getByRole('button', { name: 'Starting…' });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    expect(submitButton.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(submitButton);

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
