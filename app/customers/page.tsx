'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { insforge } from '@/lib/insforge';
import { AppShell } from '@/components/layout';
import { Card } from '@/components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Contact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomersPage() {
  const { user, loading: authLoading } = useAuth();

  const [customers, setCustomers] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await insforge.database
        .from('contacts')
        .select('id,name,email,phone,created_at')
        .order('created_at', { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setCustomers(Array.isArray(data) ? (data as Contact[]) : []);
    } catch {
      setError('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      fetchCustomers();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [authLoading, user, fetchCustomers]);

  // Loading state
  if (authLoading || loading) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <h1 className="text-headline-sm text-gray-900">Customers</h1>
          <p className="mt-4 text-body-md text-gray-500">Loading customers…</p>
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <h1 className="text-headline-sm text-gray-900">Customers</h1>
          <p className="mt-4 text-body-md text-red-600">Please sign in to view customers.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-container-margin">
        <div>
          <h1 className="text-headline-sm text-gray-900">Customers</h1>
          <p className="mt-1 text-body-md text-gray-500">
            Manage your contacts and customer relationships.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3" role="alert">
            <p className="text-body-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Customer List */}
        <div className="mt-6 space-y-element-gap">
          {customers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-surface-border p-8 text-center">
              <p className="text-body-md text-gray-500">No customers yet.</p>
              <p className="mt-1 text-label-sm text-gray-400">
                Customers will appear here when contacts are created through conversations.
              </p>
            </div>
          ) : (
            customers.map((customer) => (
              <Card key={customer.id}>
                <div className="flex items-start justify-between gap-element-gap">
                  <div className="flex-1 min-w-0">
                    <p className="text-body-md font-medium text-gray-900 truncate">
                      {customer.name || 'Unknown Contact'}
                    </p>
                    {(customer.email || customer.phone) && (
                      <p className="mt-0.5 text-body-sm text-gray-500 truncate">
                        {customer.email}
                        {customer.email && customer.phone && ' · '}
                        {customer.phone}
                      </p>
                    )}
                    <p className="mt-1 text-label-sm text-gray-400">
                      Added {formatDate(customer.created_at)}
                    </p>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
