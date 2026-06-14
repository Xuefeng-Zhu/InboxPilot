'use client';

import { type Contact, getAvatarColor, getInitials, formatRelativeDate } from './types';
import { CustomerActions } from './CustomerActions';

interface CustomerTableProps {
  customers: Contact[];
  totalCount: number;
  onViewConversations: (contactId: string) => void;
  onEdit: (customer: Contact) => void;
  onDelete: (customerId: string) => void;
}

export function CustomerTable({ customers, totalCount, onViewConversations, onEdit, onDelete }: CustomerTableProps) {
  if (customers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--m03-line)] p-8 text-center">
        <p className="text-[13px] text-[var(--m03-fg-2)]">
          {totalCount === 0 ? 'No customers yet.' : 'No customers match your filters.'}
        </p>
        <p className="mt-1 text-[12px] text-[var(--m03-fg-3)]">
          {totalCount === 0
            ? 'Customers will appear here when contacts are created through conversations.'
            : 'Try adjusting your search or filter criteria.'}
        </p>
      </div>
    );
  }

  return (
    <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="border-b border-[var(--m03-line)] px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
              Name
            </th>
            <th className="border-b border-[var(--m03-line)] px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
              Email
            </th>
            <th className="border-b border-[var(--m03-line)] px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
              Phone
            </th>
            <th className="border-b border-[var(--m03-line)] px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
              Last Seen
            </th>
            <th className="border-b border-[var(--m03-line)] px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {customers.map((customer) => (
            <tr key={customer.id} className="hover:bg-[var(--m03-line-2)]">
              <td className="border-b border-[var(--m03-line)] px-3 py-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${getAvatarColor(customer.id)}`}
                  >
                    {getInitials(customer.name, customer.email)}
                  </div>
                  <span className="truncate font-semibold text-[var(--m03-fg)]">
                    {customer.name || 'Unknown Contact'}
                  </span>
                </div>
              </td>
              <td className="border-b border-[var(--m03-line)] px-3 py-3 text-[var(--m03-fg-2)]">
                <span className="block truncate">{customer.email || '—'}</span>
              </td>
              <td className="border-b border-[var(--m03-line)] px-3 py-3 font-mono text-[12px] text-[var(--m03-fg-2)]">
                <span className="block truncate">{customer.phone || '—'}</span>
              </td>
              <td className="border-b border-[var(--m03-line)] px-3 py-3 text-[var(--m03-fg-2)]">
                {formatRelativeDate(customer.updated_at)}
              </td>
              <td className="border-b border-[var(--m03-line)] px-3 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => onViewConversations(customer.id)}
                    title="View conversations"
                    aria-label={`View conversations for ${customer.name || customer.email || 'customer'}`}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)]"
                  >
                    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="11" height="9" rx="1.5" />
                      <polyline points="2,4.5 7.5,8 13,4.5" />
                    </svg>
                  </button>
                  <CustomerActions
                    onEdit={() => onEdit(customer)}
                    onDelete={() => onDelete(customer.id)}
                    customerName={customer.name || customer.email || 'customer'}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="sticky bottom-0 bg-[var(--m03-line-2)]">
            <td colSpan={5} className="px-3 py-2.5 text-[12px] text-[var(--m03-fg-2)]">
              Showing {customers.length} of {totalCount} customer{totalCount !== 1 ? 's' : ''}
            </td>
          </tr>
        </tfoot>
      </table>
  );
}
