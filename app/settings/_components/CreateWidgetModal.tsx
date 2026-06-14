'use client';

import { useState } from 'react';
import { insforge } from '@/lib/insforge';

interface CreateWidgetModalProps {
  orgId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateWidgetModal({ orgId, onClose, onCreated }: CreateWidgetModalProps) {
  const [name, setName] = useState('');
  const [domains, setDomains] = useState('');
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>('bottom-right');
  const [color, setColor] = useState('#2563eb');
  const [greeting, setGreeting] = useState('Hi! How can we help you today?');
  const [preChatEnabled, setPreChatEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setSubmitting(true);
    setError(null);

    const widgetToken = `wt_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const hmacSecret = crypto.randomUUID() + crypto.randomUUID();

    const allowedDomains = domains
      .split('\n')
      .map((d) => d.trim())
      .filter(Boolean);

    const { error: err } = await insforge.database
      .from('webchat_widgets')
      .insert([{
        organization_id: orgId,
        name: name.trim(),
        widget_token: widgetToken,
        hmac_secret: hmacSecret,
        allowed_domains: allowedDomains,
        position,
        primary_color: color,
        greeting: greeting.trim() || null,
        pre_chat_enabled: preChatEnabled,
      }]);

    if (err) {
      setError(err.message);
      setSubmitting(false);
    } else {
      onCreated();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-lg border border-[var(--m03-line)] bg-white p-6 shadow-level-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="m-0 mb-4 text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">Create Widget</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="widget-name" className="mb-1 block text-[12px] font-medium text-[var(--m03-fg-2)]">Name</label>
            <input
              id="widget-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing site"
              className="w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
            />
          </div>

          <div>
            <label htmlFor="widget-domains" className="mb-1 block text-[12px] font-medium text-[var(--m03-fg-2)]">Allowed Domains (one per line)</label>
            <textarea
              id="widget-domains"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder={"example.com\n*.example.com"}
              rows={3}
              className="w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
            />
            <p className="mt-1 font-mono text-[10px] text-[var(--m03-fg-3)]">Leave empty to allow all origins (dev only)</p>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="widget-position" className="mb-1 block text-[12px] font-medium text-[var(--m03-fg-2)]">Position</label>
              <select
                id="widget-position"
                value={position}
                onChange={(e) => setPosition(e.target.value as 'bottom-right' | 'bottom-left')}
                className="w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
              >
                <option value="bottom-right">Bottom Right</option>
                <option value="bottom-left">Bottom Left</option>
              </select>
            </div>
            <div>
              <label htmlFor="widget-color" className="mb-1 block text-[12px] font-medium text-[var(--m03-fg-2)]">Color</label>
              <input
                id="widget-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-md border border-[var(--m03-line)]"
              />
            </div>
          </div>

          <div>
            <label htmlFor="widget-greeting" className="mb-1 block text-[12px] font-medium text-[var(--m03-fg-2)]">Greeting</label>
            <input
              id="widget-greeting"
              type="text"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="Hi! How can we help?"
              className="w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="widget-prechat"
              type="checkbox"
              checked={preChatEnabled}
              onChange={(e) => setPreChatEnabled(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-[var(--m03-line)] accent-[var(--m03-fg)]"
            />
            <label htmlFor="widget-prechat" className="text-[12px] text-[var(--m03-fg-2)]">Ask for name/email before first message</label>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3 text-[13px] text-[var(--m03-red)]">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[13px] font-medium text-[var(--m03-fg)] transition-colors hover:bg-[var(--m03-line-2)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-3 py-1.5 text-[13px] font-medium text-[var(--m03-bg)] transition-colors hover:bg-[var(--m03-fg-2)] disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create Widget'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
