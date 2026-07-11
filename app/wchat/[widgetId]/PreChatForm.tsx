'use client';

import { useState, type FormEvent } from 'react';

export function PreChatForm({ color, error, submitting, onSubmit }: {
  color: string;
  error?: string | null;
  submitting?: boolean;
  onSubmit: (data: { name: string; email: string }) => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    if (submitting) return;
    void onSubmit({ name: name.trim(), email: email.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="wchat-prechat-form">
      <p className="wchat-prechat-title">Before we start, tell us about yourself:</p>
      <input
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Your name"
        className="wchat-prechat-input"
        aria-label="Your name"
        disabled={submitting}
      />
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Your email *"
        required
        className="wchat-prechat-input"
        aria-label="Your email"
        disabled={submitting}
      />
      {error && (
        <div className="wchat-error" role="alert">
          {error}
        </div>
      )}
      <button
        type="submit"
        className="wchat-prechat-btn"
        style={{ background: color }}
        disabled={submitting}
        aria-busy={submitting || undefined}
      >
        {submitting ? 'Starting…' : 'Start Chat'}
      </button>
    </form>
  );
}
