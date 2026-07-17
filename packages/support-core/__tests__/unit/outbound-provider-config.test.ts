import { describe, expect, it, vi } from 'vitest';
import { resolveOutboundProviderConfig } from '../../src/services/outbound-provider-config.js';
import type { SmsProviderAccountRepository } from '../../src/repositories/sms-provider-account-repository.js';
import type { EmailProviderAccountRepository } from '../../src/repositories/email-provider-account-repository.js';

function dependencies() {
  const smsAccountRepo = {
    findDefaultPhoneNumber: vi.fn(),
    findById: vi.fn(),
  } as unknown as SmsProviderAccountRepository;
  const emailAccountRepo = {
    findDefaultEmailAddress: vi.fn(),
    findById: vi.fn(),
  } as unknown as EmailProviderAccountRepository;
  const loadSecret = vi.fn();
  return { smsAccountRepo, emailAccountRepo, loadSecret };
}

describe('resolveOutboundProviderConfig', () => {
  it('loads the active SMS default account secret', async () => {
    const deps = dependencies();
    vi.mocked(deps.smsAccountRepo.findDefaultPhoneNumber).mockResolvedValue({
      id: 'phone-1',
      organizationId: 'org-1',
      providerAccountId: 'account-1',
      phoneNumber: '+15551234567',
      isDefault: true,
      createdAt: new Date(),
    });
    vi.mocked(deps.smsAccountRepo.findById).mockResolvedValue({
      id: 'account-1',
      organizationId: 'org-1',
      provider: 'twilio',
      label: 'Primary',
      credentialsSecretId: 'secret-1',
      isActive: true,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    deps.loadSecret.mockResolvedValue({ authToken: 'token' });

    await expect(
      resolveOutboundProviderConfig('org-1', 'sms', deps),
    ).resolves.toEqual({ authToken: 'token' });
    expect(deps.loadSecret).toHaveBeenCalledWith('secret-1');
  });

  it('does not load credentials for a mock account', async () => {
    const deps = dependencies();
    vi.mocked(deps.emailAccountRepo.findDefaultEmailAddress).mockResolvedValue({
      id: 'address-1',
      organizationId: 'org-1',
      providerAccountId: 'account-1',
      emailAddress: 'support@example.com',
      isDefault: true,
      createdAt: new Date(),
    });
    vi.mocked(deps.emailAccountRepo.findById).mockResolvedValue({
      id: 'account-1',
      organizationId: 'org-1',
      provider: 'mock',
      label: 'Primary',
      credentialsSecretId: 'secret-1',
      isActive: true,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      resolveOutboundProviderConfig('org-1', 'email', deps),
    ).resolves.toEqual({});
    expect(deps.loadSecret).not.toHaveBeenCalled();
  });

  it('rejects inactive accounts and missing non-mock secrets explicitly', async () => {
    const deps = dependencies();
    vi.mocked(deps.emailAccountRepo.findDefaultEmailAddress).mockResolvedValue({
      id: 'address-1',
      organizationId: 'org-1',
      providerAccountId: 'account-1',
      emailAddress: 'support@example.com',
      isDefault: true,
      createdAt: new Date(),
    });
    vi.mocked(deps.emailAccountRepo.findById).mockResolvedValue({
      id: 'account-1',
      organizationId: 'org-1',
      provider: 'postmark',
      label: 'Primary',
      credentialsSecretId: 'secret-1',
      isActive: false,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      resolveOutboundProviderConfig('org-1', 'email', deps),
    ).rejects.toThrow('Email provider account is inactive: account-1');

    vi.mocked(deps.emailAccountRepo.findById).mockResolvedValue({
      id: 'account-1',
      organizationId: 'org-1',
      provider: 'postmark',
      label: 'Primary',
      credentialsSecretId: 'secret-1',
      isActive: true,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    deps.loadSecret.mockResolvedValue(null);
    await expect(
      resolveOutboundProviderConfig('org-1', 'email', deps),
    ).rejects.toThrow('Email provider credentials not found: secret-1');
  });

  it('propagates repository failures instead of returning empty credentials', async () => {
    const deps = dependencies();
    vi.mocked(deps.smsAccountRepo.findDefaultPhoneNumber)
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      resolveOutboundProviderConfig('org-1', 'sms', deps),
    ).rejects.toThrow('database unavailable');
  });

  it('does not touch provider repositories for webchat', async () => {
    const deps = dependencies();

    await expect(
      resolveOutboundProviderConfig('org-1', 'webchat', deps),
    ).resolves.toEqual({});
    expect(deps.smsAccountRepo.findDefaultPhoneNumber).not.toHaveBeenCalled();
    expect(deps.emailAccountRepo.findDefaultEmailAddress).not.toHaveBeenCalled();
  });
});
