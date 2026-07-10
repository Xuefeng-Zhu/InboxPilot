'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout';
import { useAuth } from '@/lib/auth-context';
import { useCurrentMembership, useOrganization } from '@/lib/queries';
import { TeamPanel } from '@/components/team/TeamPanel';
import AiSettingsPanel from './_components/AiSettingsPanel';
import AuditLogSettingsPanel from './_components/AuditLogSettingsPanel';
import EmailSettingsPanel from './_components/EmailSettingsPanel';
import SmsSettingsPanel from './_components/SmsSettingsPanel';
import WebchatSettingsPanel from './_components/WebchatSettingsPanel';

export const dynamic = 'force-dynamic';

const tabs = [
  { id: 'ai', label: 'AI' },
  { id: 'email', label: 'Email channels' },
  { id: 'sms', label: 'SMS channels' },
  { id: 'webchat', label: 'Webchat' },
  { id: 'team', label: 'Team' },
  { id: 'billing', label: 'Billing' },
  { id: 'audit', label: 'Audit log' },
] as const;

type TabId = (typeof tabs)[number]['id'];
const DEFAULT_TAB: TabId = 'ai';
const TAB_IDS = new Set<string>(tabs.map((t) => t.id));

function SettingsTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeTab: TabId = useMemo(() => {
    const raw = searchParams.get('tab');
    return raw && TAB_IDS.has(raw) ? (raw as TabId) : DEFAULT_TAB;
  }, [searchParams]);

  const handleTabClick = useCallback(
    (tab: TabId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[200px_1fr]">
      <nav className="rounded-lg border border-[var(--m03-line)] bg-white p-2">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabClick(tab.id)}
              className={`block w-full cursor-pointer rounded px-3 py-2 text-left text-[13px] ${
                active
                  ? 'bg-[var(--m03-fg)] font-medium text-[var(--m03-bg)]'
                  : 'text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)]'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="flex flex-col gap-4">
        {activeTab === 'ai' && <AiSettingsPanel />}
        {activeTab === 'email' && <EmailSettingsPanel />}
        {activeTab === 'sms' && <SmsSettingsPanel />}
        {activeTab === 'webchat' && <WebchatSettingsPanel />}
        {activeTab === 'team' && <TeamPanel />}
        {activeTab === 'billing' && (
          <PlaceholderCard
            title="Billing"
            body="Plan, usage, and invoices are coming soon. Track progress on the roadmap."
          />
        )}
        {activeTab === 'audit' && <AuditLogSettingsPanel />}
      </div>
    </div>
  );
}

function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-[var(--m03-line)] bg-white p-[18px]">
      <h2 className="m-0 mb-2 text-[14px] font-semibold">{title}</h2>
      <p className="m-0 text-[13px] text-[var(--m03-fg-2)]">{body}</p>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { data: membership, isLoading: membershipLoading } = useCurrentMembership(user?.id);
  const { data: org } = useOrganization(membership?.organizationId);

  return (
    <AppShell>
      <div>
        <div className="mb-5">
          <h1 className="m-0 text-[24px] font-medium tracking-[-0.02em]">Settings</h1>
          <p className="mt-1 mb-0 text-[13px] text-[var(--m03-fg-2)]">
            {org?.name ? `Workspace · ${org.name}` : 'Workspace'}
          </p>
        </div>

        {membershipLoading ? (
          <p className="text-[13px] text-[var(--m03-fg-2)]">Loading…</p>
        ) : membership?.role === 'viewer' ? (
          <div
            role="alert"
            className="rounded-lg border border-[var(--m03-line)] bg-white p-5 text-[13px] text-[var(--m03-fg-2)]"
          >
            Your viewer role does not include access to workspace settings.
          </div>
        ) : (
          <Suspense fallback={<p className="text-[13px] text-[var(--m03-fg-2)]">Loading…</p>}>
            <SettingsTabs />
          </Suspense>
        )}
      </div>
    </AppShell>
  );
}
