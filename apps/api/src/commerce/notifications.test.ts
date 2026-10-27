import { Logger } from '@nestjs/common';
import type { Env } from '../config/env';
import type { IntegrationsService } from '../integrations/integrations.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.module';
import { NotificationsService } from './notifications.service';

describe('NotificationsService with a missing template', () => {
  it('skips the SMS and warns once per key per process', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const sms = vi.fn();
    const prisma = {
      order: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: 'o1',
          locale: 'uz',
          contactName: 'Malika',
          number: 'F-10001',
          trackingToken: 'abcdefghij',
          customerId: 'c1',
          contactPhone: '+998901234567',
        })),
      },
      messageTemplate: { findUnique: vi.fn(async () => null) },
      message: { create: vi.fn() },
    };
    const svc = new NotificationsService(
      prisma as unknown as PrismaService,
      { sms } as unknown as IntegrationsService,
      {} as RedisService,
      { APP_URL: 'https://forest.test' } as Env,
    );
    await svc.orderStatus('o1', 'order_shipped');
    await svc.orderStatus('o2', 'order_shipped');
    await svc.orderStatus('o1', 'order_at_branch');
    const missing = warn.mock.calls.filter(([m]) => String(m).includes('is missing or inactive'));
    expect(missing.map(([m]) => m)).toEqual([
      'message template "order_shipped" is missing or inactive: SMS skipped',
      'message template "order_at_branch" is missing or inactive: SMS skipped',
    ]);
    expect(sms).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
