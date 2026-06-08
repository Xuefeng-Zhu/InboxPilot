'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useContacts } from '@/lib/queries';
import { useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/layout';
import {
  CustomerTable,
  CustomerFilters,
  EditCustomerModal,
  DeleteCustomerModal,
  type Contact,
} from '@/components/customers';
import { queryKeys } from '@/lib/queries';

export default function CustomersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Filters
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'email' | 'phone'>('all');

  // Modal state
  const [editingCustomer, setEditingCustomer] = useState<Contact | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: customers = [], isLoading, error } = useContacts();

  // Client-side channel filter (contacts table doesn't have a channel column)
  const filteredCustomers = (customers as Contact[]).filter((c) => {
    if (channelFilter === 'email' && !c.email) return false;
    if (channelFilter === 'phone' && !c.phone) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!c.name?.toLowerCase().includes(q) && !c.email?.toLowerCase().includes(q) && !c.phone?.includes(q)) return false;
    }
    return true;
  });

  const refetchCustomers = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.contacts() });
  };

  // Loading state for contacts query
  if (isLoading) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <h1 className="text-headline-sm text-gray-900">Customers</h1>
          <p className="mt-4 text-body-md text-gray-500">Loading customers…</p>
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
            <p className="text-body-sm text-red-700">{error.message}</p>
          </div>
        )}

        {/* Filters */}
        <CustomerFilters
          search={search}
          onSearchChange={setSearch}
          channelFilter={channelFilter}
          onChannelChange={setChannelFilter}
          filteredCount={filteredCustomers.length}
          totalCount={(customers as Contact[]).length}
        />

        {/* Table */}
        <CustomerTable
          customers={filteredCustomers}
          totalCount={(customers as Contact[]).length}
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
            onSaved={() => { setEditingCustomer(null); refetchCustomers(); }}
          />
        )}

        {/* Delete modal */}
        {deletingId && (
          <DeleteCustomerModal
            customerId={deletingId}
            onClose={() => setDeletingId(null)}
            onDeleted={() => { setDeletingId(null); refetchCustomers(); }}
          />
        )}
      </div>
    </AppShell>
  );
}
