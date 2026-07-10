'use client';

import ProviderSettingsPanel from './ProviderSettingsPanel';

const SMS_CONFIG = {
  channel: 'sms',
  channelLabel: 'SMS',
  accountTable: 'sms_provider_accounts',
  routeTable: 'sms_phone_numbers',
  routeValueKey: 'phone_number',
  resourceType: 'sms_provider_account',
  removeConfirmation: 'Are you sure you want to remove this SMS provider account? This will also remove associated phone numbers.',
} as const;

const SMS_PROVIDERS = ['mock', 'twilio', 'telnyx', 'bandwidth', 'vonage', 'plivo', 'messagebird'] as const;

export default function SmsSettingsPanel() {
  return (
    <ProviderSettingsPanel
      config={SMS_CONFIG}
      providers={SMS_PROVIDERS}
      labelPlaceholder="e.g. Production Twilio"
      routeSectionTitle="Phone Numbers"
      routeAriaLabel="Phone numbers"
    />
  );
}
