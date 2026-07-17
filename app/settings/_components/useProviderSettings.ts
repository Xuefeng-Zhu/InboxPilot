'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useCurrentMembership } from '@/lib/queries';
import {
  createProviderAccount,
  deleteProviderAccount,
  loadProviderSettings,
  testProviderConnection,
  updateProviderAccountLabel,
  writeProviderAudit,
  type ProviderAccount,
  type ProviderRoute,
  type ProviderSettingsConfig,
} from './provider-settings-data';

export type {
  ProviderAccount,
  ProviderChannel,
  ProviderRoute,
  ProviderSettingsConfig,
} from './provider-settings-data';

interface TestResult {
  id: string;
  success: boolean;
  message: string;
}

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
  const connectionTestGenerationRef = useRef(0);
  const activeConnectionTestRef = useRef<string | null>(null);
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
      const result = await loadProviderSettings(config, organizationId);
      if (requestGeneration !== requestGenerationRef.current) return;
      setAccounts(result.accounts);
      setRoutes(result.routes);
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
    connectionTestGenerationRef.current++;
  }, []);

  const addAccount = useCallback(async () => {
    if (!user || !canManage || !newLabel.trim() || !newCredentialsId.trim()) return;
    setAddingAccount(true);
    setError(null);
    try {
      if (!organizationId) throw new Error('No organization found for current user');
      await createProviderAccount({
        config,
        organizationId,
        provider: newProvider,
        label: newLabel.trim(),
        credentialsSecretId: newCredentialsId.trim(),
      });
      const auditError = await writeProviderAudit({
        config,
        organizationId,
        actorId: user.id,
        operation: 'create',
        resourceId: null,
        metadata: { provider: newProvider, label: newLabel.trim() },
      });
      await fetchData();
      setShowAddForm(false);
      setNewProvider('mock');
      setNewLabel('');
      setNewCredentialsId('');
      if (auditError) {
        setError(`Account added, but audit logging failed: ${auditError}`);
        return;
      }

      showSuccess(`${config.channelLabel} provider account added`);
    } catch (err) {
      setError(errorMessage(err, 'Failed to add account'));
    } finally {
      setAddingAccount(false);
    }
  }, [
    config,
    config.channelLabel,
    canManage,
    fetchData,
    newCredentialsId,
    newLabel,
    newProvider,
    organizationId,
    showSuccess,
    user,
  ]);

  const saveEdit = useCallback(async (accountId: string) => {
    if (!canManage || !editLabel.trim()) return;
    setError(null);
    try {
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account) throw new Error('Provider account not found');
      await updateProviderAccountLabel(config, accountId, editLabel.trim());

      const auditError = await writeProviderAudit({
        config,
        organizationId: account.organization_id,
        actorId: user?.id ?? null,
        operation: 'update',
        resourceId: accountId,
        metadata: { label: editLabel.trim() },
      });
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
  }, [accounts, canManage, config, editLabel, fetchData, showSuccess, user?.id]);

  const removeAccount = useCallback(async (accountId: string) => {
    if (!canManage) return;
    if (!window.confirm(config.removeConfirmation)) return;
    setError(null);
    try {
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account) throw new Error('Provider account not found');
      await deleteProviderAccount(config, accountId);
      const auditError = await writeProviderAudit({
        config,
        organizationId: account.organization_id,
        actorId: user?.id ?? null,
        operation: 'delete',
        resourceId: accountId,
        metadata: { provider: account.provider, label: account.label },
      });
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
    config,
    config.removeConfirmation,
    fetchData,
    showSuccess,
    user?.id,
  ]);

  const testConnection = useCallback(async (accountId: string) => {
    if (!canManage || activeConnectionTestRef.current) return;
    activeConnectionTestRef.current = accountId;
    const testGeneration = ++connectionTestGenerationRef.current;
    setTestingId(accountId);
    setTestResult(null);
    try {
      const result = await testProviderConnection(config.channel, accountId);
      if (testGeneration === connectionTestGenerationRef.current) {
        setTestResult({
          id: accountId,
          success: result.success,
          message: result.message,
        });
      }
    } catch (err) {
      if (testGeneration === connectionTestGenerationRef.current) {
        setTestResult({
          id: accountId,
          success: false,
          message: errorMessage(err, 'Connection test failed'),
        });
      }
    } finally {
      if (testGeneration === connectionTestGenerationRef.current) {
        activeConnectionTestRef.current = null;
        setTestingId(null);
      }
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
