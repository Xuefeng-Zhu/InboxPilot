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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-headline-sm text-gray-900 mb-4">Create Widget</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="widget-name" className="block text-body-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              id="widget-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing site"
              className="w-full rounded border border-surface-border px-3 py-2 text-body-md focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label htmlFor="widget-domains" className="block text-body-sm font-medium text-gray-700 mb-1">Allowed Domains (one per line)</label>
            <textarea
              id="widget-domains"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder={"example.com\n*.example.com"}
              rows={3}
              className="w-full rounded border border-surface-border px-3 py-2 text-body-md focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="mt-1 text-label-sm text-gray-400">Leave empty to allow all origins (dev only)</p>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label htmlFor="widget-position" className="block text-body-sm font-medium text-gray-700 mb-1">Position</label>
              <select
                id="widget-position"
                value={position}
                onChange={(e) => setPosition(e.target.value as 'bottom-right' | 'bottom-left')}
                className="w-full rounded border border-surface-border px-3 py-2 text-body-md focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="bottom-right">Bottom Right</option>
                <option value="bottom-left">Bottom Left</option>
              </select>
            </div>
            <div>
              <label htmlFor="widget-color" className="block text-body-sm font-medium text-gray-700 mb-1">Color</label>
              <input
                id="widget-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 rounded border border-surface-border cursor-pointer"
              />
            </div>
          </div>

          <div>
            <label htmlFor="widget-greeting" className="block text-body-sm font-medium text-gray-700 mb-1">Greeting</label>
            <input
              id="widget-greeting"
              type="text"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="Hi! How can we help?"
              className="w-full rounded border border-surface-border px-3 py-2 text-body-md focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="widget-prechat"
              type="checkbox"
              checked={preChatEnabled}
              onChange={(e) => setPreChatEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="widget-prechat" className="text-body-sm text-gray-700">Ask for name/email before first message</label>
          </div>

          {error && (
            <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded px-4 py-2 text-body-sm text-gray-600 hover:bg-gray-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-primary px-4 py-2 text-body-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create Widget'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
