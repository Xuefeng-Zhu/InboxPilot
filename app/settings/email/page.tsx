'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { insforge, getAccessToken } from '@/lib/insforge';
import { AppShell } from '@/components/layout';
import { Button, Card, Input, Select, StatusBadge } from '@/components/ui';

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

const EMAIL_PROVIDER_OPTIONS = EMAIL_PROVIDERS.map((p) => ({
  value: p,
  label: p.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
}));

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
        insforge.database
          .from('email_provider_accounts')
          .select('id,organization_id,provider,label,credentials_secret_id,is_active,metadata,created_at,updated_at')
          .order('created_at', { ascending: true }),
        insforge.database
          .from('email_addresses')
          .select()
          .order('created_at', { ascending: true }),
      ]);
      if (accountsRes.error) {
        setError(accountsRes.error.message);
        return;
      }
      if (addressesRes.error) {
        setError(addressesRes.error.message);
        return;
      }
      setAccounts(Array.isArray(accountsRes.data) ? (accountsRes.data as EmailProviderAccount[]) : []);
      setEmailAddresses(Array.isArray(addressesRes.data) ? (addressesRes.data as EmailAddress[]) : []);
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
      const { error: insertError } = await insforge.database
        .from('email_provider_accounts')
        .insert({
          provider: newProvider,
          label: newLabel.trim(),
          credentials_secret_id: newCredentialsId.trim(),
          is_active: true,
          metadata: {},
        })
        .select();

      if (insertError) {
        setError(insertError.message);
        return;
      }

      // Record audit log for provider account modification
      if (accounts.length > 0) {
        await insforge.database
          .from('audit_logs')
          .insert({
            organization_id: accounts[0].organization_id,
            actor_id: user?.id ?? null,
            actor_type: 'user',
            action: 'provider_account_modified',
            resource_type: 'email_provider_account',
            resource_id: null,
            metadata: { operation: 'create', provider: newProvider, label: newLabel.trim() },
          })
          .select();
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
      const { error: updateError } = await insforge.database
        .from('email_provider_accounts')
        .update({ label: editLabel.trim(), updated_at: new Date().toISOString() })
        .eq('id', accountId)
        .select();

      if (updateError) {
        setError(updateError.message);
        return;
      }

      // Record audit log for provider account modification
      const account = accounts.find((a) => a.id === accountId);
      if (account) {
        await insforge.database
          .from('audit_logs')
          .insert({
            organization_id: account.organization_id,
            actor_id: user?.id ?? null,
            actor_type: 'user',
            action: 'provider_account_modified',
            resource_type: 'email_provider_account',
            resource_id: accountId,
            metadata: { operation: 'update', label: editLabel.trim() },
          })
          .select();
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
      const { error: deleteError } = await insforge.database
        .from('email_provider_accounts')
        .delete()
        .eq('id', accountId);

      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      // Record audit log for provider account removal
      const account = accounts.find((a) => a.id === accountId);
      if (account) {
        await insforge.database
          .from('audit_logs')
          .insert({
            organization_id: account.organization_id,
            actor_id: user?.id ?? null,
            actor_type: 'user',
            action: 'provider_account_modified',
            resource_type: 'email_provider_account',
            resource_id: accountId,
            metadata: { operation: 'delete', provider: account.provider, label: account.label },
          })
          .select();
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
      const token = getAccessToken();
      const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL ?? '';
      const res = await fetch(`${baseUrl}/functions/v1/test-channel-connection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
      <AppShell>
        <div className="p-container-margin">
          <div className="mx-auto max-w-3xl">
            <h1 className="text-headline-sm text-gray-900">Email Settings</h1>
            <p className="mt-4 text-body-md text-gray-500">Loading email settings…</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <div className="mx-auto max-w-3xl">
            <h1 className="text-headline-sm text-gray-900">Email Settings</h1>
            <p className="mt-4 text-body-md text-red-600">Please sign in to manage email settings.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-container-margin">
        <div className="mx-auto max-w-3xl">
          {/* Page Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-headline-sm text-gray-900">Email Settings</h1>
              <p className="mt-1 text-body-md text-gray-600">
                Manage email provider accounts and addresses.
              </p>
            </div>
            <Button
              variant={showAddForm ? 'secondary' : 'primary'}
              size="md"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              {showAddForm ? 'Cancel' : 'Add Account'}
            </Button>
          </div>

          {/* Status messages */}
          {error && (
            <div className="mt-4 rounded-md bg-red-50 p-3" role="alert">
              <p className="text-body-md text-red-700">{error}</p>
            </div>
          )}
          {success && (
            <div className="mt-4 rounded-md bg-green-50 p-3" role="status">
              <p className="text-body-md text-green-700">{success}</p>
            </div>
          )}

          {/* Add Account Form */}
          {showAddForm && (
            <Card className="mt-6" header={<h2 className="text-headline-sm text-gray-900">Add Email Provider Account</h2>}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Provider"
                  id="email-provider"
                  value={newProvider}
                  onChange={(e) => setNewProvider(e.target.value)}
                  options={EMAIL_PROVIDER_OPTIONS}
                />
                <Input
                  label="Label"
                  id="email-label"
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Production Postmark"
                />
                <Input
                  label="Credentials Secret ID"
                  id="email-credentials"
                  type="text"
                  value={newCredentialsId}
                  onChange={(e) => setNewCredentialsId(e.target.value)}
                  placeholder="InsForge secret reference ID"
                  className="sm:col-span-2"
                />
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleAddAccount}
                  disabled={addingAccount || !newLabel.trim() || !newCredentialsId.trim()}
                >
                  {addingAccount ? 'Adding…' : 'Add Account'}
                </Button>
              </div>
            </Card>
          )}

          {/* Accounts List */}
          <div className="mt-6 space-y-4">
            {accounts.length === 0 ? (
              <Card>
                <div className="py-4 text-center">
                  <p className="text-body-md text-gray-500">No email provider accounts configured.</p>
                  <p className="mt-1 text-body-sm text-gray-400">Click &quot;Add Account&quot; to get started.</p>
                </div>
              </Card>
            ) : (
              accounts.map((account) => {
                const accountAddresses = emailAddresses.filter(
                  (a) => a.provider_account_id === account.id,
                );
                const isEditing = editingId === account.id;
                const result = testResult?.id === account.id ? testResult : null;

                return (
                  <Card key={account.id}>
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
                              className="rounded border border-gray-300 px-2 py-1 text-body-md focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <Button variant="ghost" size="sm" onClick={() => handleSaveEdit(account.id)}>
                              Save
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <h3 className="text-headline-sm text-gray-900">{account.label}</h3>
                        )}
                        <div className="mt-1 flex items-center gap-3">
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                            {account.provider}
                          </span>
                          <StatusBadge status={account.is_active ? 'connected' : 'disconnected'} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleTestConnection(account.id)}
                          disabled={testingId === account.id}
                          aria-label={`Test connection for ${account.label}`}
                        >
                          {testingId === account.id ? 'Testing…' : 'Test Connection'}
                        </Button>
                        {!isEditing && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditingId(account.id);
                              setEditLabel(account.label);
                            }}
                            aria-label={`Edit ${account.label}`}
                          >
                            Edit
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveAccount(account.id)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          aria-label={`Remove ${account.label}`}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>

                    {/* Test result */}
                    {result && (
                      <div
                        className={`mt-3 rounded-md p-3 text-body-md ${
                          result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                        }`}
                        role="status"
                      >
                        {result.message}
                      </div>
                    )}

                    {/* Email addresses */}
                    {accountAddresses.length > 0 && (
                      <div className="mt-3 border-t border-surface-border pt-3">
                        <p className="text-label-md text-gray-500">Email Addresses</p>
                        <ul className="mt-1 space-y-1" aria-label={`Email addresses for ${account.label}`}>
                          {accountAddresses.map((addr) => (
                            <li key={addr.id} className="flex items-center gap-2 text-body-md text-gray-700">
                              <span>{addr.email_address}</span>
                              {addr.is_default && (
                                <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                                  Default
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
