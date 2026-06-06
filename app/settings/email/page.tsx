'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { insforge } from '@/lib/insforge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmailProviderAccount {
  id: string;
  organization_id: string;
  provider: string;
  label: string;
  credentials_secret_id: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface EmailAddress {
  id: string;
  provider_account_id: string;
  organization_id: string;
  email_address: string;
  is_default: boolean;
  created_at: string;
}

const EMAIL_PROVIDERS = ['mock', 'postmark', 'sendgrid', 'mailgun', 'resend', 'aws_ses', 'insforge_email'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EmailSettingsPage() {
  const { user, loading: authLoading } = useAuth();

  const [accounts, setAccounts] = useState<EmailProviderAccount[]>([]);
  const [emailAddresses, setEmailAddresses] = useState<EmailAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add account form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState('mock');
  const [newLabel, setNewLabel] = useState('');
  const [newCredentialsId, setNewCredentialsId] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  // Test connection state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

  // Fetch accounts and email addresses
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountsRes, addressesRes] = await Promise.all([
        insforge.from<EmailProviderAccount>('email_provider_accounts', {
          select: 'id,organization_id,provider,label,credentials_secret_id,is_active,metadata,created_at,updated_at',
          order: 'created_at.asc',
        }),
        insforge.from<EmailAddress>('email_addresses', {
          order: 'created_at.asc',
        }),
      ]);
      if (accountsRes.error) {
        setError(accountsRes.error.message);
        return;
      }
      if (addressesRes.error) {
        setError(addressesRes.error.message);
        return;
      }
      setAccounts(Array.isArray(accountsRes.data) ? accountsRes.data : []);
      setEmailAddresses(Array.isArray(addressesRes.data) ? addressesRes.data : []);
    } catch {
      setError('Failed to load email settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      fetchData();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [authLoading, user, fetchData]);

  // Add account
  const handleAddAccount = async () => {
    if (!newLabel.trim() || !newCredentialsId.trim()) return;
    setAddingAccount(true);
    setError(null);
    try {
      const { error: insertError } = await insforge.insert('email_provider_accounts', {
        provider: newProvider,
        label: newLabel.trim(),
        credentials_secret_id: newCredentialsId.trim(),
        is_active: true,
        metadata: {},
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }

      // Record audit log for provider account modification
      if (accounts.length > 0) {
        await insforge.insert('audit_logs', {
          organization_id: accounts[0].organization_id,
          actor_id: user?.id ?? null,
          actor_type: 'user',
          action: 'provider_account_modified',
          resource_type: 'email_provider_account',
          resource_id: null,
          metadata: { operation: 'create', provider: newProvider, label: newLabel.trim() },
        });
      }

      setSuccess('Email provider account added');
      setTimeout(() => setSuccess(null), 3000);
      setShowAddForm(false);
      setNewProvider('mock');
      setNewLabel('');
      setNewCredentialsId('');
      await fetchData();
    } catch {
      setError('Failed to add account');
    } finally {
      setAddingAccount(false);
    }
  };

  // Edit account label
  const handleSaveEdit = async (accountId: string) => {
    if (!editLabel.trim()) return;
    setError(null);
    try {
      const { error: updateError } = await insforge.update(
        'email_provider_accounts',
        { label: editLabel.trim(), updated_at: new Date().toISOString() },
        { id: `eq.${accountId}` },
      );
      if (updateError) {
        setError(updateError.message);
        return;
      }

      // Record audit log for provider account modification
      const account = accounts.find((a) => a.id === accountId);
      if (account) {
        await insforge.insert('audit_logs', {
          organization_id: account.organization_id,
          actor_id: user?.id ?? null,
          actor_type: 'user',
          action: 'provider_account_modified',
          resource_type: 'email_provider_account',
          resource_id: accountId,
          metadata: { operation: 'update', label: editLabel.trim() },
        });
      }

      setEditingId(null);
      setSuccess('Account updated');
      setTimeout(() => setSuccess(null), 3000);
      await fetchData();
    } catch {
      setError('Failed to update account');
    }
  };

  // Remove account
  const handleRemoveAccount = async (accountId: string) => {
    if (!window.confirm('Are you sure you want to remove this email provider account? This will also remove associated email addresses.')) {
      return;
    }
    setError(null);
    try {
      const { error: deleteError } = await insforge.delete('email_provider_accounts', {
        id: `eq.${accountId}`,
      });
      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      // Record audit log for provider account removal
      const account = accounts.find((a) => a.id === accountId);
      if (account) {
        await insforge.insert('audit_logs', {
          organization_id: account.organization_id,
          actor_id: user?.id ?? null,
          actor_type: 'user',
          action: 'provider_account_modified',
          resource_type: 'email_provider_account',
          resource_id: accountId,
          metadata: { operation: 'delete', provider: account.provider, label: account.label },
        });
      }

      setSuccess('Account removed');
      setTimeout(() => setSuccess(null), 3000);
      await fetchData();
    } catch {
      setError('Failed to remove account');
    }
  };

  // Test connection
  const handleTestConnection = async (accountId: string) => {
    setTestingId(accountId);
    setTestResult(null);
    try {
      const token = insforge.getAccessToken();
      const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL ?? '';
      const res = await fetch(`${baseUrl}/functions/v1/test-channel-connection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? '',
        },
        body: JSON.stringify({ channelType: 'email', providerAccountId: accountId }),
      });
      const data = await res.json();
      setTestResult({
        id: accountId,
        success: res.ok && data.status === 'ok',
        message: res.ok && data.status === 'ok' ? 'Connection successful' : data.error ?? 'Connection failed',
      });
    } catch {
      setTestResult({ id: accountId, success: false, message: 'Connection test failed' });
    } finally {
      setTestingId(null);
    }
  };

  // Loading state
  if (authLoading || loading) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-bold text-gray-900">Email Settings</h1>
          <p className="mt-4 text-sm text-gray-500">Loading email settings…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-bold text-gray-900">Email Settings</h1>
          <p className="mt-4 text-sm text-red-600">Please sign in to manage email settings.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Email Settings</h1>
            <p className="mt-1 text-sm text-gray-600">
              Manage email provider accounts and addresses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {showAddForm ? 'Cancel' : 'Add Account'}
          </button>
        </div>

        {/* Status messages */}
        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3" role="alert">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {success && (
          <div className="mt-4 rounded-md bg-green-50 p-3" role="status">
            <p className="text-sm text-green-700">{success}</p>
          </div>
        )}

        {/* Add Account Form */}
        {showAddForm && (
          <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-medium text-gray-900">Add Email Provider Account</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="email-provider" className="block text-sm font-medium text-gray-700">
                  Provider
                </label>
                <select
                  id="email-provider"
                  value={newProvider}
                  onChange={(e) => setNewProvider(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {EMAIL_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="email-label" className="block text-sm font-medium text-gray-700">
                  Label
                </label>
                <input
                  id="email-label"
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Production Postmark"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="email-credentials" className="block text-sm font-medium text-gray-700">
                  Credentials Secret ID
                </label>
                <input
                  id="email-credentials"
                  type="text"
                  value={newCredentialsId}
                  onChange={(e) => setNewCredentialsId(e.target.value)}
                  placeholder="InsForge secret reference ID"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleAddAccount}
                disabled={addingAccount || !newLabel.trim() || !newCredentialsId.trim()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {addingAccount ? 'Adding…' : 'Add Account'}
              </button>
            </div>
          </div>
        )}

        {/* Accounts List */}
        <div className="mt-6 space-y-4">
          {accounts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
              <p className="text-sm text-gray-500">No email provider accounts configured.</p>
              <p className="mt-1 text-xs text-gray-400">Click "Add Account" to get started.</p>
            </div>
          ) : (
            accounts.map((account) => {
              const accountAddresses = emailAddresses.filter(
                (a) => a.provider_account_id === account.id,
              );
              const isEditing = editingId === account.id;
              const result = testResult?.id === account.id ? testResult : null;

              return (
                <div
                  key={account.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <label htmlFor={`edit-label-${account.id}`} className="sr-only">
                            Account label
                          </label>
                          <input
                            id={`edit-label-${account.id}`}
                            type="text"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(account.id)}
                            className="text-sm font-medium text-blue-600 hover:text-blue-800"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-sm text-gray-500 hover:text-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <h3 className="text-sm font-medium text-gray-900">{account.label}</h3>
                      )}
                      <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
                          {account.provider}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
                            account.is_active
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {account.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTestConnection(account.id)}
                        disabled={testingId === account.id}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50"
                        aria-label={`Test connection for ${account.label}`}
                      >
                        {testingId === account.id ? 'Testing…' : 'Test Connection'}
                      </button>
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(account.id);
                            setEditLabel(account.label);
                          }}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                          aria-label={`Edit ${account.label}`}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveAccount(account.id)}
                        className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
                        aria-label={`Remove ${account.label}`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {/* Test result */}
                  {result && (
                    <div
                      className={`mt-3 rounded-md p-2 text-xs ${
                        result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}
                      role="status"
                    >
                      {result.message}
                    </div>
                  )}

                  {/* Email addresses */}
                  {accountAddresses.length > 0 && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <p className="text-xs font-medium text-gray-500">Email Addresses</p>
                      <ul className="mt-1 space-y-1" aria-label={`Email addresses for ${account.label}`}>
                        {accountAddresses.map((addr) => (
                          <li key={addr.id} className="flex items-center gap-2 text-xs text-gray-700">
                            <span>{addr.email_address}</span>
                            {addr.is_default && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                Default
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
