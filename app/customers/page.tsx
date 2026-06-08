'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { insforge } from '@/lib/insforge';
import { AppShell } from '@/components/layout';
import {
  CustomerTable,
  CustomerFilters,
  EditCustomerModal,
  DeleteCustomerModal,
  type Contact,
} from '@/components/customers';

export default function CustomersPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [customers, setCustomers] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'email' | 'phone'>('all');

  // Modal state
  const [editingCustomer, setEditingCustomer] = useState<Contact | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await insforge.database
        .from('contacts')
        .select('id,name,email,phone,created_at,updated_at')
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

  // Client-side filter
  const filteredCustomers = customers.filter((c) => {
    if (channelFilter === 'email' && !c.email) return false;
    if (channelFilter === 'phone' && !c.phone) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!c.name?.toLowerCase().includes(q) && !c.email?.toLowerCase().includes(q) && !c.phone?.includes(q)) return false;
    }
    return true;
  });

  // Loading / auth guards
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
        {/* Header */}
        <div>
          <h1 className="text-headline-sm text-gray-900">Customers</h1>
          <p className="mt-1 text-body-md text-gray-500">
            Manage your user base and view conversation history.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 rounded bg-red-50 p-3" role="alert">
            <p className="text-body-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Filters */}
        <CustomerFilters
          search={search}
          onSearchChange={setSearch}
          channelFilter={channelFilter}
          onChannelChange={setChannelFilter}
          filteredCount={filteredCustomers.length}
          totalCount={customers.length}
        />

        {/* Table */}
        <CustomerTable
          customers={filteredCustomers}
          totalCount={customers.length}
          onViewConversations={(id) => router.push(`/inbox?contact=${id}`)}
          onEdit={(customer) => setEditingCustomer(customer)}
          onDelete={(id) => setDeletingId(id)}
        />

        {/* Edit modal */}
        {editingCustomer && (
          <EditCustomerModal
            customerId={editingCustomer.id}
            initialName={editingCustomer.name ?? ''}
            initialEmail={editingCustomer.email ?? ''}
            initialPhone={editingCustomer.phone ?? ''}
            onClose={() => setEditingCustomer(null)}
            onSaved={() => { setEditingCustomer(null); fetchCustomers(); }}
          />
        )}

        {/* Delete modal */}
        {deletingId && (
          <DeleteCustomerModal
            customerId={deletingId}
            onClose={() => setDeletingId(null)}
            onDeleted={() => { setDeletingId(null); fetchCustomers(); }}
          />
        )}
      </div>
    </AppShell>
  );
}
