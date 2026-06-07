'use client';

import { AppShell } from '@/components/layout';
import SmsSettingsPanel from '../_components/SmsSettingsPanel';

export default function SmsSettingsPage() {
  return (
    <AppShell>
      <div className="p-container-margin">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-headline-sm text-gray-900">SMS Settings</h1>
          <p className="mt-1 text-body-md text-gray-600">
            Manage SMS provider accounts and phone numbers.
          </p>
          <div className="mt-6">
            <SmsSettingsPanel />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
