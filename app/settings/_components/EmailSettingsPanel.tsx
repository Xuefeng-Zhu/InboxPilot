'use client';

import ProviderSettingsPanel from './ProviderSettingsPanel';

const EMAIL_CONFIG = {
  channel: 'email',
  channelLabel: 'Email',
  accountTable: 'email_provider_accounts',
  routeTable: 'email_addresses',
  routeValueKey: 'email_address',
  resourceType: 'email_provider_account',
  removeConfirmation: 'Are you sure you want to remove this email provider account? This will also remove associated email addresses.',
} as const;

const EMAIL_PROVIDERS = ['mock', 'postmark', 'mailgun', 'resend', 'aws-ses', 'insforge'] as const;

export default function EmailSettingsPanel() {
  return (
    <ProviderSettingsPanel
      config={EMAIL_CONFIG}
      providers={EMAIL_PROVIDERS}
      labelPlaceholder="e.g. Production Postmark"
      routeSectionTitle="Email Addresses"
      routeAriaLabel="Email addresses"
    />
  );
}
