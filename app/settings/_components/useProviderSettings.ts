'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken, insforge } from '@/lib/insforge';
import { readResponseJsonObject } from '@/lib/http-json';
import { useCurrentMembership } from '@/lib/queries';

export type ProviderChannel = 'sms' | 'email';

export interface ProviderSettingsConfig {
  channel: ProviderChannel;
  channelLabel: string;
  accountTable: 'sms_provider_accounts' | 'email_provider_accounts';
  routeTable: 'sms_phone_numbers' | 'email_addresses';
  routeValueKey: 'phone_number' | 'email_address';
  resourceType: 'sms_provider_account' | 'email_provider_account';
  removeConfirmation: string;
}

export interface ProviderAccount {
  id: string;
  organization_id: string;
  provider: string;
  label: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProviderRoute {
  id: string;
  providerAccountId: string;
  value: string;
  isDefault: boolean;
}

interface TestResult {
  id: string;
  success: boolean;
  message: string;
}

type AuditOperation = 'create' | 'update' | 'delete';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function useProviderSettings(config: ProviderSettingsConfig) {
  const { user, loading: authLoading } = useAuth();
  const { data: membership, isLoading: membershipLoading } = useCurrentMembership(user?.id);
  const organizationId = membership?.organizationId ?? null;
  const canManage = membership?.role === 'owner' || membership?.role === 'admin';
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [routes, setRoutes] = useState<ProviderRoute[]>([]);
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
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const requestGenerationRef = useRef(0);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccess = useCallback((message: string) => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setSuccess(message);
    successTimerRef.current = setTimeout(() => setSuccess(null), 3000);
  }, []);

  const fetchData = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    if (!organizationId) {
      setAccounts([]);
      setRoutes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [accountsResult, routesResult] = await Promise.all([
        insforge.database
          .from(config.accountTable)
          .select('id,organization_id,provider,label,is_active,metadata,created_at,updated_at')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: true }),
        insforge.database
          .from(config.routeTable)
          .select(`id,provider_account_id,${config.routeValueKey},is_default`)
          .order('created_at', { ascending: true }),
      ]);
      if (requestGeneration !== requestGenerationRef.current) return;
      if (accountsResult.error) throw new Error(accountsResult.error.message);
      if (routesResult.error) throw new Error(routesResult.error.message);

      setAccounts(
        Array.isArray(accountsResult.data)
          ? accountsResult.data as ProviderAccount[]
          : [],
      );
      const routeRows = Array.isArray(routesResult.data) ? routesResult.data : [];
      setRoutes(routeRows.flatMap((rawRow) => {
        const row = rawRow as Record<string, unknown>;
        const id = row.id;
        const providerAccountId = row.provider_account_id;
        const value = row[config.routeValueKey];
        if (
          typeof id !== 'string' ||
          typeof providerAccountId !== 'string' ||
          typeof value !== 'string'
        ) return [];
        return [{
          id,
          providerAccountId,
          value,
          isDefault: row.is_default === true,
        }];
      }));
    } catch (err) {
      if (requestGeneration === requestGenerationRef.current) {
        setError(errorMessage(err, `Failed to load ${config.channelLabel} settings`));
      }
    } finally {
      if (requestGeneration === requestGenerationRef.current) setLoading(false);
    }
  }, [
    config.accountTable,
    config.channelLabel,
    config.routeTable,
    config.routeValueKey,
    organizationId,
  ]);

  useEffect(() => {
    if (!authLoading && !membershipLoading && user && organizationId) {
      void fetchData();
    } else if (!authLoading && !membershipLoading) {
      setLoading(false);
    }
    return () => {
      requestGenerationRef.current++;
    };
  }, [authLoading, organizationId, membershipLoading, user, fetchData]);

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  const writeAudit = useCallback(async (
    organizationId: string,
    operation: AuditOperation,
    resourceId: string | null,
    metadata: Record<string, unknown>,
  ): Promise<string | null> => {
    const { error: auditError } = await insforge.database
      .from('audit_logs')
      .insert([{
        organization_id: organizationId,
        actor_id: user?.id ?? null,
        actor_type: 'user',
        action: 'provider_account_modified',
        resource_type: config.resourceType,
        resource_id: resourceId,
        metadata: { operation, ...metadata },
      }]);
    return auditError?.message ?? null;
  }, [config.resourceType, user?.id]);

  const addAccount = useCallback(async () => {
    if (!user || !canManage || !newLabel.trim() || !newCredentialsId.trim()) return;
    setAddingAccount(true);
    setError(null);
    try {
      if (!organizationId) throw new Error('No organization found for current user');
      const { error: insertError } = await insforge.database
        .from(config.accountTable)
        .insert([{
          organization_id: organizationId,
          provider: newProvider,
          label: newLabel.trim(),
          credentials_secret_id: newCredentialsId.trim(),
          is_active: true,
          metadata: {},
        }]);
      if (insertError) throw new Error(insertError.message);

      const auditError = await writeAudit(
        organizationId,
        'create',
        null,
        { provider: newProvider, label: newLabel.trim() },
      );
      await fetchData();
      if (auditError) {
        setError(`Account added, but audit logging failed: ${auditError}`);
        return;
      }

      showSuccess(`${config.channelLabel} provider account added`);
      setShowAddForm(false);
      setNewProvider('mock');
      setNewLabel('');
      setNewCredentialsId('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to add account'));
    } finally {
      setAddingAccount(false);
    }
  }, [
    config.accountTable,
    config.channelLabel,
    canManage,
    fetchData,
    newCredentialsId,
    newLabel,
    newProvider,
    organizationId,
    showSuccess,
    user,
    writeAudit,
  ]);

  const saveEdit = useCallback(async (accountId: string) => {
    if (!canManage || !editLabel.trim()) return;
    setError(null);
    try {
      const { error: updateError } = await insforge.database
        .from(config.accountTable)
        .update({ label: editLabel.trim(), updated_at: new Date().toISOString() })
        .eq('id', accountId);
      if (updateError) throw new Error(updateError.message);
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account) throw new Error('Provider account not found');

      const auditError = await writeAudit(
        account.organization_id,
        'update',
        accountId,
        { label: editLabel.trim() },
      );
      await fetchData();
      if (auditError) {
        setError(`Account updated, but audit logging failed: ${auditError}`);
        return;
      }
      setEditingId(null);
      showSuccess('Account updated');
    } catch (err) {
      setError(errorMessage(err, 'Failed to update account'));
    }
  }, [accounts, canManage, config.accountTable, editLabel, fetchData, showSuccess, writeAudit]);

  const removeAccount = useCallback(async (accountId: string) => {
    if (!canManage) return;
    if (!window.confirm(config.removeConfirmation)) return;
    setError(null);
    try {
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account) throw new Error('Provider account not found');
      const { error: deleteError } = await insforge.database
        .from(config.accountTable)
        .delete()
        .eq('id', accountId);
      if (deleteError) throw new Error(deleteError.message);

      const auditError = await writeAudit(
        account.organization_id,
        'delete',
        accountId,
        { provider: account.provider, label: account.label },
      );
      await fetchData();
      if (auditError) {
        setError(`Account removed, but audit logging failed: ${auditError}`);
        return;
      }
      showSuccess('Account removed');
    } catch (err) {
      setError(errorMessage(err, 'Failed to remove account'));
    }
  }, [
    accounts,
    canManage,
    config.accountTable,
    config.removeConfirmation,
    fetchData,
    showSuccess,
    writeAudit,
  ]);

  const testConnection = useCallback(async (accountId: string) => {
    if (!canManage) return;
    setTestingId(accountId);
    setTestResult(null);
    try {
      const token = getAccessToken();
      const response = await fetch('/api/functions/test-channel-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          channelType: config.channel,
          providerAccountId: accountId,
        }),
      });
      const data = await readResponseJsonObject(response, 'provider connection test');
      const healthData =
        data.data && typeof data.data === 'object' && !Array.isArray(data.data)
          ? data.data as Record<string, unknown>
          : null;
      const succeeded = response.ok && data.status === 'ok' && healthData?.ok === true;
      const detail =
        (typeof healthData?.message === 'string' && healthData.message) ||
        (typeof healthData?.reason === 'string' && healthData.reason) ||
        (typeof data.error === 'string' && data.error) ||
        null;
      setTestResult({
        id: accountId,
        success: succeeded,
        message: succeeded
          ? detail ?? 'Connection successful'
          : detail ?? 'Connection failed',
      });
    } catch (err) {
      setTestResult({
        id: accountId,
        success: false,
        message: errorMessage(err, 'Connection test failed'),
      });
    } finally {
      setTestingId(null);
    }
  }, [canManage, config.channel]);

  return {
    user,
    authLoading,
    membershipLoading,
    canManage,
    accounts,
    routes,
    loading,
    error,
    success,
    showAddForm,
    setShowAddForm,
    newProvider,
    setNewProvider,
    newLabel,
    setNewLabel,
    newCredentialsId,
    setNewCredentialsId,
    addingAccount,
    editingId,
    setEditingId,
    editLabel,
    setEditLabel,
    testingId,
    testResult,
    addAccount,
    saveEdit,
    removeAccount,
    testConnection,
  };
}
