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
  return (
    <div className="mt-4 rounded-lg border border-surface-border bg-white overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[2fr_2fr_1.5fr_1.5fr_7rem] gap-4 px-4 py-3 border-b border-surface-border bg-gray-50">
        <span className="text-label-sm text-gray-500 uppercase tracking-wider">Name</span>
        <span className="text-label-sm text-gray-500 uppercase tracking-wider">Email</span>
        <span className="text-label-sm text-gray-500 uppercase tracking-wider">Phone</span>
        <span className="text-label-sm text-gray-500 uppercase tracking-wider">Last Seen</span>
        <span className="text-label-sm text-gray-500 uppercase tracking-wider text-right">Actions</span>
      </div>

      {/* Rows */}
      {customers.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-body-md text-gray-500">
            {totalCount === 0 ? 'No customers yet.' : 'No customers match your filters.'}
          </p>
          <p className="mt-1 text-body-sm text-gray-400">
            {totalCount === 0
              ? 'Customers will appear here when contacts are created through conversations.'
              : 'Try adjusting your search or filter criteria.'}
          </p>
        </div>
      ) : (
        <div>
          {customers.map((customer) => (
            <div
              key={customer.id}
              className="grid grid-cols-[2fr_2fr_1.5fr_1.5fr_7rem] gap-4 px-4 py-3 border-b border-surface-border/50 hover:bg-gray-50 transition-colors items-center group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-label-sm font-semibold ${getAvatarColor(customer.id)}`}>
                  {getInitials(customer.name, customer.email)}
                </div>
                <span className="text-body-md font-medium text-gray-900 truncate">
                  {customer.name || 'Unknown Contact'}
                </span>
              </div>

              <span className="text-body-sm text-gray-600 truncate">
                {customer.email || '—'}
              </span>

              <span className="text-body-sm text-gray-600 font-mono truncate">
                {customer.phone || '—'}
              </span>

              <span className="text-body-sm text-gray-500">
                {formatRelativeDate(customer.updated_at)}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onViewConversations(customer.id)}
                  title="View conversations"
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-primary transition-colors"
                >
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      {customers.length > 0 && (
        <div className="px-4 py-3 border-t border-surface-border bg-gray-50">
          <span className="text-body-sm text-gray-500">
            Showing {customers.length} of {totalCount} customer{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
