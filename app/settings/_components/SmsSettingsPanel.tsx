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

  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState('mock');
  const [newLabel, setNewLabel] = useState('');
  const [newCredentialsId, setNewCredentialsId] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

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

  const handleAddAccount = async () => {
    if (!user) return;
    if (!newLabel.trim() || !newCredentialsId.trim()) return;
    setAddingAccount(true);
    setError(null);
    try {
      // Look up the user's current org from organization_members
      const { data: membership, error: membershipError } = await insforge.database
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (membershipError || !membership) {
        setError(membershipError?.message ?? 'No organization found for current user');
        return;
      }

      const { error: insertError } = await insforge.database
        .from('sms_provider_accounts')
        .insert([{
          organization_id: membership.organization_id,
          provider: newProvider,
          label: newLabel.trim(),
          credentials_secret_id: newCredentialsId.trim(),
          is_active: true,
          metadata: {},
        }])
        .select();

      if (insertError) {
        setError(insertError.message);
        return;
      }

      if (accounts.length > 0) {
        await insforge.database
          .from('audit_logs')
          .insert([{
            organization_id: accounts[0].organization_id,
            actor_id: user?.id ?? null,
            actor_type: 'user',
            action: 'provider_account_modified',
            resource_type: 'sms_provider_account',
            resource_id: null,
            metadata: { operation: 'create', provider: newProvider, label: newLabel.trim() },
          }])
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

      const account = accounts.find((a) => a.id === accountId);
      if (account) {
        await insforge.database
          .from('audit_logs')
          .insert([{
            organization_id: account.organization_id,
            actor_id: user?.id ?? null,
            actor_type: 'user',
            action: 'provider_account_modified',
            resource_type: 'sms_provider_account',
            resource_id: accountId,
            metadata: { operation: 'update', label: editLabel.trim() },
          }])
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

      const account = accounts.find((a) => a.id === accountId);
      if (account) {
        await insforge.database
          .from('audit_logs')
          .insert([{
            organization_id: account.organization_id,
            actor_id: user?.id ?? null,
            actor_type: 'user',
            action: 'provider_account_modified',
            resource_type: 'sms_provider_account',
            resource_id: accountId,
            metadata: { operation: 'delete', provider: account.provider, label: account.label },
          }])
          .select();
      }

      setSuccess('Account removed');
      setTimeout(() => setSuccess(null), 3000);
      await fetchData();
    } catch {
      setError('Failed to remove account');
    }
  };

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
    return <p className="text-[14px] text-[var(--m03-fg-2)]">Loading SMS settings…</p>;
  }

  if (!user) {
    return <p className="text-[14px] text-[var(--m03-red)]">Please sign in to manage SMS settings.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <Button
          variant={showAddForm ? 'secondary' : 'primary'}
          size="md"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? 'Cancel' : 'Add Account'}
        </Button>
      </div>

      {error && (
        <div className="rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3" role="alert">
          <p className="text-[14px] text-[var(--m03-red)]">{error}</p>
        </div>
      )}
      {success && (
        <div className="rounded border border-[var(--m03-green-line)] bg-[var(--m03-green-fill)] p-3" role="status">
          <p className="text-[14px] text-[var(--m03-green)]">{success}</p>
        </div>
      )}

      {showAddForm && (
        <Card header={<h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">Add SMS Provider Account</h2>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Provider"
              id="sms-provider"
              value={newProvider}
              onValueChange={setNewProvider}
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
          <div className="mt-3 flex justify-end">
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

      {accounts.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-[14px] text-[var(--m03-fg-2)]">No SMS provider accounts configured.</p>
            <p className="mt-1 text-[12px] text-[var(--m03-fg-3)]">Click &quot;Add Account&quot; to get started.</p>
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
                    <div className="flex items-center gap-2">
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
                    <h3 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">
                      {account.label}
                    </h3>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    <span className="inline-flex items-center rounded-md border border-[var(--m03-line)] bg-[var(--m03-line-2)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--m03-fg-2)]">
                      {account.provider}
                    </span>
                    <StatusBadge
                      status={account.is_active ? 'connected' : 'disconnected'}
                    />
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
                    aria-label={`Remove ${account.label}`}
                  >
                    Remove
                  </Button>
                </div>
              </div>

              {result && (
                <div
                  className={`mt-3 rounded-md border p-3 text-[13px] ${
                    result.success
                      ? 'border-[var(--m03-green-line)] bg-[var(--m03-green-fill)] text-[var(--m03-green)]'
                      : 'border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] text-[var(--m03-red)]'
                  }`}
                  role="status"
                >
                  {result.message}
                </div>
              )}

              {accountPhones.length > 0 && (
                <div className="mt-3 border-t border-[var(--m03-line)] pt-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--m03-fg-2)]">Phone Numbers</p>
                  <ul className="mt-1 flex flex-col gap-1" aria-label={`Phone numbers for ${account.label}`}>
                    {accountPhones.map((phone) => (
                      <li key={phone.id} className="flex items-center gap-2 text-[13px] text-[var(--m03-fg-2)]">
                        <span className="font-mono">{phone.phone_number}</span>
                        {phone.is_default && (
                          <span className="inline-flex items-center rounded border border-[var(--m03-line)] bg-[var(--m03-line-2)] px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.04em] text-[var(--m03-fg-2)]">
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
