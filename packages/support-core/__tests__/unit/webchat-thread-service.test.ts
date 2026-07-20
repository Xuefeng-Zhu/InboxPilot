import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditLogRepository } from '../../src/repositories/audit-log-repository.js';
import type { ContactRepository } from '../../src/repositories/contact-repository.js';
import type { ConversationRepository } from '../../src/repositories/conversation-repository.js';
import type { WebchatThreadRepository } from '../../src/repositories/webchat-thread-repository.js';
import { WebchatThreadService } from '../../src/services/webchat-thread-service.js';

function createService() {
  const contactRepo = {
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'contact-1' }),
  } as unknown as ContactRepository;
  const conversationRepo = {
    create: vi.fn().mockResolvedValue({ id: 'conversation-1' }),
  } as unknown as ConversationRepository;
  const threadRepo = {
    create: vi.fn().mockResolvedValue({ id: 'thread-1' }),
  } as unknown as WebchatThreadRepository;
  const auditLog = {
    create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  } as unknown as AuditLogRepository;

  return {
    contactRepo,
    conversationRepo,
    threadRepo,
    service: new WebchatThreadService(
      contactRepo,
      conversationRepo,
      threadRepo,
      auditLog,
    ),
  };
}

describe('WebchatThreadService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a thread identified when pre-chat email is supplied at creation', async () => {
    vi.useFakeTimers();
    const identifiedAt = new Date('2026-07-20T12:00:00.000Z');
    vi.setSystemTime(identifiedAt);
    const { service, threadRepo } = createService();

    await service.initThread({
      widgetId: 'widget-1',
      organizationId: 'org-1',
      preChat: { name: 'Visitor', email: 'visitor@example.com' },
    });

    expect(threadRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      identifiedAt,
    }));
  });

  it('leaves an anonymous thread unidentified', async () => {
    const { service, threadRepo } = createService();

    await service.initThread({
      widgetId: 'widget-1',
      organizationId: 'org-1',
    });

    expect(threadRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      identifiedAt: null,
    }));
  });
});
