'use client';

import { AppShell } from '@/components/layout';
import EmailSettingsPanel from '../_components/EmailSettingsPanel';

export default function EmailSettingsPage() {
  return (
    <AppShell>
      <div className="p-container-margin">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-headline-sm text-gray-900">Email Settings</h1>
          <p className="mt-1 text-body-md text-gray-600">
            Manage email provider accounts and addresses.
          </p>
          <div className="mt-6">
            <EmailSettingsPanel />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
