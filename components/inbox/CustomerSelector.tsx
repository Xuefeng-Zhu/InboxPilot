'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { insforge } from '@/lib/insforge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CustomerOption {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

// ---------------------------------------------------------------------------
// CustomerSelector — searchable dropdown for picking a contact
// ---------------------------------------------------------------------------

interface CustomerSelectorProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
}

function getLabel(c: CustomerOption) {
  return c.name || c.email || c.phone || 'Unknown';
}

function getSublabel(c: CustomerOption) {
  if (c.name && c.email) return c.email;
  if (c.name && c.phone) return c.phone;
  return null;
}

export function CustomerSelector({ selectedId, onSelect, onClear }: CustomerSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedLabel, setResolvedLabel] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve label from ID when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setResolvedLabel(null);
      return;
    }

    // Check if we already have it in options
    const cached = options.find((o) => o.id === selectedId);
    if (cached) {
      setResolvedLabel(getLabel(cached));
      return;
    }

    // Fetch just this contact
    let cancelled = false;
    insforge.database
      .from('contacts')
      .select('id,name,email,phone')
      .eq('id', selectedId)
      .limit(1)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : data ? [data] : [];
        const contact = rows[0] as CustomerOption | undefined;
        if (contact) {
          setResolvedLabel(getLabel(contact));
          setOptions((prev) => prev.some((o) => o.id === contact.id) ? prev : [...prev, contact]);
        } else {
          setResolvedLabel('Unknown');
        }
      });

    return () => { cancelled = true; };
  }, [selectedId, options]);

  const fetchCustomers = useCallback(async (search: string) => {
    setLoading(true);
    try {
      let q = insforge.database
        .from('contacts')
        .select('id,name,email,phone')
        .limit(20);

      if (search.trim()) {
        q = q.ilike('name', `%${search.trim()}%`);
      }

      const { data } = await q;
      setOptions(Array.isArray(data) ? (data as CustomerOption[]) : []);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchCustomers(query);
    }
  }, [open, query, fetchCustomers]);

  // Selected state — show chip
  if (selectedId) {
    return (
      <div className="flex items-center gap-2 rounded border border-surface-border bg-white py-1.5 px-2.5">
        <svg className="h-3.5 w-3.5 text-gray-400 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
        </svg>
        <span className="text-body-sm text-gray-900 truncate flex-1">
          {resolvedLabel ?? 'Loading…'}
        </span>
        <button
          onClick={onClear}
          className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Clear customer filter"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </div>
    );
  }

  // Unselected state — searchable input
  return (
    <div className="relative">
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          placeholder="Select a customer..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          className="w-full rounded border border-surface-border bg-white py-1.5 pl-8 pr-3 text-body-sm placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setQuery(''); }} />
          <div className="absolute left-0 right-0 top-9 z-20 max-h-48 overflow-y-auto rounded border border-surface-border bg-white py-1 shadow-level-2">
            {loading ? (
              <div className="px-3 py-2 text-body-sm text-gray-500">Searching…</div>
            ) : options.length === 0 ? (
              <div className="px-3 py-2 text-body-sm text-gray-500">No customers found</div>
            ) : (
              options.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onSelect(c.id);
                    setResolvedLabel(getLabel(c));
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <span className="block text-body-sm text-gray-900 truncate">{getLabel(c)}</span>
                    {getSublabel(c) && (
                      <span className="block text-label-sm text-gray-500 truncate">{getSublabel(c)}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
