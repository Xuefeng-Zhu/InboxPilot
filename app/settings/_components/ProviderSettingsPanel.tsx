'use client';

import { Button, Card, Input, Select, StatusBadge } from '@/components/ui';
import {
  type ProviderSettingsConfig,
  useProviderSettings,
} from './useProviderSettings';

interface ProviderSettingsPanelProps {
  config: ProviderSettingsConfig;
  providers: readonly string[];
  labelPlaceholder: string;
  routeSectionTitle: string;
  routeAriaLabel: string;
}

function formatProviderLabel(provider: string): string {
  return provider
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function ProviderSettingsPanel({
  config,
  providers,
  labelPlaceholder,
  routeSectionTitle,
  routeAriaLabel,
}: ProviderSettingsPanelProps) {
  const settings = useProviderSettings(config);
  const providerOptions = providers.map((provider) => ({
    value: provider,
    label: formatProviderLabel(provider),
  }));
  const idPrefix = config.channel;

  if (settings.authLoading || settings.membershipLoading || settings.loading) {
    return <p className="text-[14px] text-[var(--m03-fg-2)]">Loading {config.channelLabel} settings…</p>;
  }

  if (!settings.user) {
    return <p className="text-[14px] text-[var(--m03-red)]">Please sign in to manage {config.channelLabel} settings.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {settings.canManage ? (
        <div className="flex items-center justify-end">
          <Button
            variant={settings.showAddForm ? 'secondary' : 'primary'}
            size="md"
            onClick={() => settings.setShowAddForm(!settings.showAddForm)}
          >
            {settings.showAddForm ? 'Cancel' : 'Add Account'}
          </Button>
        </div>
      ) : (
        <div className="rounded border border-[var(--m03-line)] bg-[var(--m03-line-2)] p-3 text-[13px] text-[var(--m03-fg-2)]">
          These settings are read-only. An owner or admin can manage provider accounts.
        </div>
      )}

      {settings.error && (
        <div className="rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3" role="alert">
          <p className="text-[14px] text-[var(--m03-red)]">{settings.error}</p>
        </div>
      )}
      {settings.success && (
        <div className="rounded border border-[var(--m03-green-line)] bg-[var(--m03-green-fill)] p-3" role="status">
          <p className="text-[14px] text-[var(--m03-green)]">{settings.success}</p>
        </div>
      )}

      {settings.canManage && settings.showAddForm && (
        <Card header={<h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">Add {config.channelLabel} Provider Account</h2>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Provider"
              id={`${idPrefix}-provider`}
              value={settings.newProvider}
              onValueChange={settings.setNewProvider}
              options={providerOptions}
            />
            <Input
              label="Label"
              id={`${idPrefix}-label`}
              type="text"
              value={settings.newLabel}
              onChange={(event) => settings.setNewLabel(event.target.value)}
              placeholder={labelPlaceholder}
            />
            <Input
              label="Credentials Secret ID"
              id={`${idPrefix}-credentials`}
              type="text"
              value={settings.newCredentialsId}
              onChange={(event) => settings.setNewCredentialsId(event.target.value)}
              placeholder="InsForge secret reference ID"
              className="sm:col-span-2"
            />
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              size="md"
              onClick={() => void settings.addAccount()}
              disabled={settings.addingAccount || !settings.newLabel.trim() || !settings.newCredentialsId.trim()}
            >
              {settings.addingAccount ? 'Adding…' : 'Add Account'}
            </Button>
          </div>
        </Card>
      )}

      {settings.accounts.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-[14px] text-[var(--m03-fg-2)]">No {config.channelLabel} provider accounts configured.</p>
            <p className="mt-1 text-[12px] text-[var(--m03-fg-3)]">
              {settings.canManage
                ? 'Add an account to get started.'
                : 'An owner or admin can add the first account.'}
            </p>
          </div>
        </Card>
      ) : settings.accounts.map((account) => {
        const accountRoutes = settings.routes.filter((route) => route.providerAccountId === account.id);
        const isEditing = settings.editingId === account.id;
        const result = settings.testResult?.id === account.id ? settings.testResult : null;

        return (
          <Card key={account.id}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <label htmlFor={`edit-label-${account.id}`} className="sr-only">Account label</label>
                    <Input
                      id={`edit-label-${account.id}`}
                      type="text"
                      value={settings.editLabel}
                      onChange={(event) => settings.setEditLabel(event.target.value)}
                      className="max-w-[200px]"
                    />
                    <Button variant="ghost" size="sm" onClick={() => void settings.saveEdit(account.id)}>Save</Button>
                    <Button variant="ghost" size="sm" onClick={() => settings.setEditingId(null)}>Cancel</Button>
                  </div>
                ) : (
                  <h3 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">{account.label}</h3>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-md border border-[var(--m03-line)] bg-[var(--m03-line-2)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--m03-fg-2)]">
                    {account.provider}
                  </span>
                  <StatusBadge status={account.is_active ? 'connected' : 'disconnected'} />
                </div>
              </div>
              {settings.canManage && <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void settings.testConnection(account.id)}
                  disabled={settings.testingId === account.id}
                  aria-label={`Test connection for ${account.label}`}
                >
                  {settings.testingId === account.id ? 'Testing…' : 'Test Connection'}
                </Button>
                {!isEditing && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      settings.setEditingId(account.id);
                      settings.setEditLabel(account.label);
                    }}
                    aria-label={`Edit ${account.label}`}
                  >
                    Edit
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => void settings.removeAccount(account.id)} aria-label={`Remove ${account.label}`}>
                  Remove
                </Button>
              </div>}
            </div>

            {result && (
              <div
                className={`mt-3 rounded-md border p-3 text-[13px] ${result.success
                  ? 'border-[var(--m03-green-line)] bg-[var(--m03-green-fill)] text-[var(--m03-green)]'
                  : 'border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] text-[var(--m03-red)]'}`}
                role={result.success ? 'status' : 'alert'}
              >
                {result.message}
              </div>
            )}

            {accountRoutes.length > 0 && (
              <div className="mt-3 border-t border-[var(--m03-line)] pt-3">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--m03-fg-2)]">{routeSectionTitle}</p>
                <ul className="mt-1 flex flex-col gap-1" aria-label={`${routeAriaLabel} for ${account.label}`}>
                  {accountRoutes.map((route) => (
                    <li key={route.id} className="flex items-center gap-2 text-[13px] text-[var(--m03-fg-2)]">
                      <span className="font-mono">{route.value}</span>
                      {route.isDefault && (
                        <span className="inline-flex items-center rounded border border-[var(--m03-line)] bg-[var(--m03-line-2)] px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.04em] text-[var(--m03-fg-2)]">Default</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
