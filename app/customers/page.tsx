'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useContacts, queryKeys, useOrgMembership } from '@/lib/queries';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/layout';
import {
  CustomerTable,
  CustomerFilters,
  EditCustomerModal,
  DeleteCustomerModal,
  type Contact,
} from '@/components/customers';

export default function CustomersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: orgId } = useOrgMembership(user?.id);

  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'email' | 'phone'>('all');
  const [showAnonymous, setShowAnonymous] = useState(false);

  const [editingCustomer, setEditingCustomer] = useState<Contact | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: customers = [], isLoading, error } = useContacts();

  const allContacts = customers as Contact[];
  const isIdentified = (c: Contact) => Boolean(c.name || c.email || c.phone);
  const identifiedContacts = allContacts.filter(isIdentified);
  const anonymousCount = allContacts.length - identifiedContacts.length;
  const emailCount = identifiedContacts.filter((c) => c.email).length;
  const phoneCount = identifiedContacts.filter((c) => c.phone).length;

  const filteredCustomers = allContacts.filter((c) => {
    if (!showAnonymous && !isIdentified(c)) return false;
    if (channelFilter === 'email' && !c.email) return false;
    if (channelFilter === 'phone' && !c.phone) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (
        !c.name?.toLowerCase().includes(q) &&
        !c.email?.toLowerCase().includes(q) &&
        !c.phone?.includes(q)
      )
        return false;
    }
    return true;
  });

  const refetchCustomers = () => {
    if (orgId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts(orgId) });
    }
  };

  const subline = (() => {
    if (isLoading) return 'Loading customers…';
    const parts = [
      `${identifiedContacts.length} identified`,
      `${emailCount} with email`,
      `${phoneCount} with phone`,
    ];
    if (anonymousCount > 0) parts.push(`${anonymousCount} anonymous`);
    return parts.join(' · ');
  })();

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="m-0 text-[24px] font-medium tracking-[-0.02em]">Customers</h1>
            <p className="mt-1 mb-0 text-[13px] text-[var(--m03-fg-2)]">{subline}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3 text-[13px] text-[var(--m03-red)]" role="alert">
            {error.message}
          </div>
        )}

        <CustomerFilters
          search={search}
          onSearchChange={setSearch}
          channelFilter={channelFilter}
          onChannelChange={setChannelFilter}
          counts={{ all: identifiedContacts.length, email: emailCount, phone: phoneCount }}
          showAnonymous={showAnonymous}
          onShowAnonymousChange={setShowAnonymous}
          anonymousCount={anonymousCount}
        />

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--m03-line)] bg-white">
          {isLoading ? (
            <p className="p-4 text-[13px] text-[var(--m03-fg-2)]">Loading customers…</p>
          ) : (
            <CustomerTable
              customers={filteredCustomers}
              totalCount={allContacts.length}
              onViewConversations={(id) => router.push(`/inbox?contact=${id}`)}
              onEdit={(customer) => setEditingCustomer(customer)}
              onDelete={(id) => setDeletingId(id)}
            />
          )}
        </div>

        {editingCustomer && (
          <EditCustomerModal
            customerId={editingCustomer.id}
            initialName={editingCustomer.name ?? ''}
            initialEmail={editingCustomer.email ?? ''}
            initialPhone={editingCustomer.phone ?? ''}
            onClose={() => setEditingCustomer(null)}
            onSaved={() => {
              setEditingCustomer(null);
              refetchCustomers();
            }}
          />
        )}

        {deletingId && (
          <DeleteCustomerModal
            customerId={deletingId}
            onClose={() => setDeletingId(null)}
            onDeleted={() => {
              setDeletingId(null);
              refetchCustomers();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
