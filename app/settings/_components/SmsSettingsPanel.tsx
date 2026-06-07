'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { insforge, getAccessToken } from '@/lib/insforge';
import { Button, Card, Input, Select, StatusBadge } from '@/components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SmsProviderAccount {
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

interface SmsPhoneNumber {
  id: string;
  provider_account_id: string;
  organization_id: string;
  phone_number: string;
  is_default: boolean;
  created_at: string;
}

const SMS_PROVIDERS = ['mock', 'twilio', 'telnyx', 'bandwidth', 'vonage', 'plivo', 'messagebird'];

const SMS_PROVIDER_OPTIONS = SMS_PROVIDERS.map((p) => ({
  value: p,
  label: p.charAt(0).toUpperCase() + p.slice(1),
}));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SmsSettingsPanel() {
  const { user, loading: authLoading } = useAuth();

  const [accounts, setAccounts] = useState<SmsProviderAccount[]>([]);
  const [phoneNumbers, setPhoneNumbers] = useState<SmsPhoneNumber[]>([]);
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

  // Fetch accounts and phone numbers
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountsRes, phonesRes] = await Promise.all([
        insforge.database
          .from('sms_provider_accounts')
          .select('id,organization_id,provider,label,credentials_secret_id,is_active,metadata,created_at,updated_at')
          .order('created_at', { ascending: true }),
        insforge.database
          .from('sms_phone_numbers')
          .select()
          .order('created_at', { ascending: true }),
      ]);
      if (accountsRes.error) {
        setError(accountsRes.error.message);
        return;
      }
      if (phonesRes.error) {
        setError(phonesRes.error.message);
        return;
      }
      setAccounts(Array.isArray(accountsRes.data) ? (accountsRes.data as SmsProviderAccount[]) : []);
      setPhoneNumbers(Array.isArray(phonesRes.data) ? (phonesRes.data as SmsPhoneNumber[]) : []);
    } catch {
      setError('Failed to load SMS settings');
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
        .from('sms_provider_accounts')
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
            resource_type: 'sms_provider_account',
            resource_id: null,
            metadata: { operation: 'create', provider: newProvider, label: newLabel.trim() },
          })
          .select();
      }

      setSuccess('SMS provider account added');
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
        .from('sms_provider_accounts')
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
            resource_type: 'sms_provider_account',
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
    if (!window.confirm('Are you sure you want to remove this SMS provider account? This will also remove associated phone numbers.')) {
      return;
    }
    setError(null);
    try {
      const { error: deleteError } = await insforge.database
        .from('sms_provider_accounts')
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
            resource_type: 'sms_provider_account',
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
      const res = await fetch('/api/functions/test-channel-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ channelType: 'sms', providerAccountId: accountId }),
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

  if (authLoading || loading) {
    return <p className="text-body-md text-gray-500">Loading SMS settings…</p>;
  }

  if (!user) {
    return <p className="text-body-md text-red-600">Please sign in to manage SMS settings.</p>;
  }

  return (
    <div className="space-y-element-gap">
      {/* Header with Add button */}
      <div className="flex items-center justify-end">
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
        <div className="rounded-md bg-red-50 p-3" role="alert">
          <p className="text-body-md text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="rounded-md bg-green-50 p-3" role="status">
          <p className="text-body-md text-green-700">{success}</p>
        </div>
      )}

      {/* Add Account Form */}
      {showAddForm && (
        <Card header={<h2 className="text-headline-sm text-gray-900">Add SMS Provider Account</h2>}>
          <div className="grid gap-element-gap sm:grid-cols-2">
            <Select
              label="Provider"
              id="sms-provider"
              value={newProvider}
              onChange={(e) => setNewProvider(e.target.value)}
              options={SMS_PROVIDER_OPTIONS}
            />
            <Input
              label="Label"
              id="sms-label"
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Production Twilio"
            />
            <Input
              label="Credentials Secret ID"
              id="sms-credentials"
              type="text"
              value={newCredentialsId}
              onChange={(e) => setNewCredentialsId(e.target.value)}
              placeholder="InsForge secret reference ID"
              className="sm:col-span-2"
            />
          </div>
          <div className="mt-element-gap flex justify-end">
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
      {accounts.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-body-md text-gray-500">No SMS provider accounts configured.</p>
            <p className="mt-1 text-body-sm text-gray-400">Click &quot;Add Account&quot; to get started.</p>
          </div>
        </Card>
      ) : (
        accounts.map((account) => {
          const accountPhones = phoneNumbers.filter(
            (p) => p.provider_account_id === account.id,
          );
          const isEditing = editingId === account.id;
          const result = testResult?.id === account.id ? testResult : null;

          return (
            <Card key={account.id}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-tight-gap">
                      <label htmlFor={`edit-label-${account.id}`} className="sr-only">
                        Account label
                      </label>
                      <Input
                        id={`edit-label-${account.id}`}
                        type="text"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="max-w-[200px]"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSaveEdit(account.id)}
                      >
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <h3 className="text-headline-sm text-gray-900">{account.label}</h3>
                  )}
                  <div className="mt-1 flex items-center gap-element-gap">
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {account.provider}
                    </span>
                    <StatusBadge
                      status={account.is_active ? 'connected' : 'disconnected'}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-tight-gap">
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
                    aria-label={`Remove ${account.label}`}
                    className="text-red-600 hover:text-red-800 hover:bg-red-50"
                  >
                    Remove
                  </Button>
                </div>
              </div>

              {/* Test result */}
              {result && (
                <div
                  className={`mt-element-gap rounded-md p-3 text-body-md ${
                    result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  }`}
                  role="status"
                >
                  {result.message}
                </div>
              )}

              {/* Phone numbers */}
              {accountPhones.length > 0 && (
                <div className="mt-element-gap border-t border-surface-border pt-element-gap">
                  <p className="text-label-md text-gray-500">Phone Numbers</p>
                  <ul className="mt-1 space-y-1" aria-label={`Phone numbers for ${account.label}`}>
                    {accountPhones.map((phone) => (
                      <li key={phone.id} className="flex items-center gap-tight-gap text-body-sm text-gray-700">
                        <span className="font-mono">{phone.phone_number}</span>
                        {phone.is_default && (
                          <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
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
  );
}
