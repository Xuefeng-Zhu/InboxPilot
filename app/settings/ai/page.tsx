'use client';

import { AppShell } from '@/components/layout';
import AiSettingsPanel from '../_components/AiSettingsPanel';

export default function AiSettingsPage() {
  return (
    <AppShell>
      <div className="p-container-margin">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-headline-sm text-gray-900">AI Settings</h1>
          <p className="mt-1 text-body-md text-gray-500">
            Configure AI mode, confidence threshold, and escalation rules.
          </p>
          <div className="mt-6">
            <AiSettingsPanel />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
