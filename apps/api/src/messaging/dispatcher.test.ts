import { Logger } from '@nestjs/common';
import type { Env } from '../config/env';
import type { IntegrationsService } from '../integrations/integrations.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.module';
import type { SettingsService } from '../settings/settings.service';
import { MessageDispatcher } from './dispatcher.service';
import type { TelegramSender } from './telegram-sender';
import type { UnsubscribeService } from './unsubscribe';

describe('MessageDispatcher with a missing template', () => {
  it('records nothing and warns once per key per process', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const prisma = {
      message: { findUnique: vi.fn(async () => null), create: vi.fn() },
      messageTemplate: { findUnique: vi.fn(async () => null) },
    };
    const telegram = { sendMessage: vi.fn() };
    const d = new MessageDispatcher(
      prisma as unknown as PrismaService,
      {} as SettingsService,
      {} as IntegrationsService,
      {} as RedisService,
      {} as UnsubscribeService,
      telegram as unknown as TelegramSender,
      { APP_URL: 'https://forest.test' } as Env,
    );
    const input = { customerId: 'c1', channels: ['SMS' as const], vars: {} };
    expect(await d.enqueue({ ...input, templateKey: 'order_shipped' })).toBeNull();
    await d.enqueue({ ...input, templateKey: 'order_shipped' });
    await d.enqueue({ ...input, templateKey: 'order_at_branch' });
    const missing = warn.mock.calls
      .map(([m]) => String(m))
      .filter((m) => m.includes('missing or inactive'));
    expect(missing).toEqual([
      'message template "order_shipped" is missing or inactive: message skipped',
      'message template "order_at_branch" is missing or inactive: message skipped',
    ]);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
