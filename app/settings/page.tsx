'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout';
import AiSettingsPanel from './_components/AiSettingsPanel';
import EmailSettingsPanel from './_components/EmailSettingsPanel';
import SmsSettingsPanel from './_components/SmsSettingsPanel';
import WebchatSettingsPanel from './_components/WebchatSettingsPanel';

export const dynamic = 'force-dynamic';

const tabs = [
  { id: 'ai', label: 'AI' },
  { id: 'email', label: 'Email' },
  { id: 'sms', label: 'SMS' },
  { id: 'webchat', label: 'Web Chat' },
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
    <>
      {/* Tabs navigation */}
      <nav className="mt-6 border-b border-surface-border" aria-label="Settings tabs">
        <div className="-mb-px flex gap-6" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => handleTabClick(tab.id)}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-body-md font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:border-surface-border hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Tab panels */}
      <div className="mt-6">
        <div
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
        >
          {activeTab === 'ai' && <AiSettingsPanel />}
          {activeTab === 'email' && <EmailSettingsPanel />}
          {activeTab === 'sms' && <SmsSettingsPanel />}
          {activeTab === 'webchat' && <WebchatSettingsPanel />}
        </div>
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="p-container-margin">
        <div className="mx-auto max-w-3xl">
          <header className="pl-12 xl:pl-0">
            <h1 className="text-headline-sm text-gray-900">Settings</h1>
            <p className="mt-1 text-body-md text-gray-500">
              Manage support channels and AI behavior.
            </p>
          </header>

          <Suspense fallback={null}>
            <SettingsTabs />
          </Suspense>
        </div>
      </div>
    </AppShell>
  );
}
