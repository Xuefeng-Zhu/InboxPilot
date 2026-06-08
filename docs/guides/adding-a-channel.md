# Adding a Channel (SMS or Email Provider)

> Step-by-step guide for adding a new SMS or email provider adapter. The same pattern works for both.

## Overview

InboxPilot is provider-neutral at the service layer. The `SmsProviderAdapter` and `EmailProviderAdapter` interfaces define a contract; concrete adapters wrap provider SDKs. New adapters are wired into the function entrypoints and registered in the `ProviderRegistry`.

## For an SMS provider

### 1. Implement the adapter

Create `packages/support-core/src/adapters/<your-provider>-sms-adapter.ts`:

```typescript
import type { SmsProviderAdapter } from '../interfaces/sms-provider-adapter.js';
import type {
  SendSmsParams, SendSmsResult,
  NormalizedInboundSms, NormalizedDeliveryStatus,
  WebhookVerificationRequest,
} from '../types/index.js';

export class YourProviderSmsAdapter implements SmsProviderAdapter {
  readonly providerId = 'your-provider';

  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    // Call provider's API to send the SMS
    // Return { provider: 'your-provider', externalMessageId, status }
  }

  parseInboundWebhook(body: unknown): NormalizedInboundSms {
    // Map provider's webhook payload to NormalizedInboundSms
    return {
      from: '<sender phone>',
      to: '<recipient phone>',
      body: '<message text>',
      externalMessageId: '<provider id>',
      rawPayload: body as Record<string, unknown>,
    };
  }

  parseStatusWebhook(body: unknown): NormalizedDeliveryStatus {
    return {
      externalMessageId: '<provider id>',
      status: 'delivered', // or 'sent', 'failed', 'bounced', etc.
      errorCode: null,
      errorMessage: null,
      rawPayload: body as Record<string, unknown>,
    };
  }

  async verifyWebhook(req: WebhookVerificationRequest): Promise<boolean> {
    // Verify the provider's webhook signature using req.body, req.headers, req.signingSecret
    return true;
  }
}
```

Look at `twilio-sms-adapter.ts` or `telnyx-sms-adapter.ts` for full reference implementations.

### 2. Export it

Add the export to `packages/support-core/src/adapters/index.ts`:

```typescript
export { YourProviderSmsAdapter } from './your-provider-sms-adapter.js';
```

### 3. Register in the function entrypoints

In `insforge/functions/sms-inbound/index.ts` and `insforge/functions/sms-status/index.ts`:

```typescript
import { YourProviderSmsAdapter } from '../../../packages/support-core/src/adapters/your-provider-sms-adapter.ts';

// In the entrypoint, after creating the registry:
registry.registerSmsAdapter('your-provider', new YourProviderSmsAdapter());
```

The provider id (`'your-provider'`) is matched against the `x-provider` header on inbound webhooks. The same id is what `sms_provider_accounts.provider` should contain.

### 4. Add tests

- **Unit test**: `packages/support-core/__tests__/unit/your-provider-sms-adapter.test.ts` — exercise `sendSms`, `parseInboundWebhook`, `parseStatusWebhook`, and `verifyWebhook` with example provider payloads.
- **Property test**: add cases to `packages/support-core/__tests__/properties/webhook-roundtrip.prop.test.ts` to verify that parsing and re-serializing preserves essential fields.

### 5. (Optional) Replace the stub

If a stub exists in `sms-stubs.ts` (`BandwidthSmsAdapter`, `VonageSmsAdapter`, `PlivoSmsAdapter`, `MessageBirdSmsAdapter`), implement it and move it to a dedicated file (delete the stub from `sms-stubs.ts`).

## For an email provider

Same pattern as SMS, but with these differences:

- File: `packages/support-core/src/adapters/<your-provider>-email-adapter.ts`.
- Class: `YourProviderEmailAdapter implements EmailProviderAdapter`.
- Methods: `sendEmail`, `parseInboundWebhook`, `parseStatusWebhook`, `verifyWebhook`.
- The `EmailProviderAdapter` interface is in `packages/support-core/src/interfaces/email-provider-adapter.ts`.
- Register in `insforge/functions/email-inbound/index.ts` and `insforge/functions/email-status/index.ts` with `registry.registerEmailAdapter('your-provider', new YourProviderEmailAdapter())`.
- Reference: `postmark-email-adapter.ts`.

## Verifying end-to-end

After wiring:

1. Create an `sms_provider_accounts` (or `email_provider_accounts`) row with `provider = 'your-provider'`, `is_active = true`, and a valid `credentials_secret_id`.
2. For SMS, add a row to `sms_phone_numbers` with the test phone number.
3. Configure your provider's webhook to point at `https://<your-app>.insforge.app/functions/v1/sms-inbound` (or `email-inbound`) with the `x-provider: your-provider` header.
4. Send a test message; verify in the InsForge SQL editor that a new `messages` row was created and an `ai_decisions` row appears after the AI processes it.

## Type definitions

The shared types referenced from `SmsProviderAdapter` / `EmailProviderAdapter` are in `packages/support-core/src/types/index.ts`:

- `SendSmsParams` / `SendEmailParams`
- `SendSmsResult` / `SendEmailResult`
- `NormalizedInboundSms` / `NormalizedInboundEmail`
- `NormalizedDeliveryStatus`
- `WebhookVerificationRequest`

If a provider needs additional fields, extend these types in `types/index.ts` and update the existing adapters to match.
