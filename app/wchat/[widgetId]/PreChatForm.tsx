'use client';

import { useState, type FormEvent } from 'react';

export function PreChatForm({ color, onSubmit }: {
  color: string;
  onSubmit: (data: { name: string; email: string }) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    onSubmit({ name: name.trim(), email: email.trim() });
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
      />
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Your email *"
        required
        className="wchat-prechat-input"
        aria-label="Your email"
      />
      <button type="submit" className="wchat-prechat-btn" style={{ background: color }}>
        Start Chat
      </button>
    </form>
  );
}
