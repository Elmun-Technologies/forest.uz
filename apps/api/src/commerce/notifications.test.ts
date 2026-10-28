import { Logger } from '@nestjs/common';
import type { Env } from '../config/env';
import type { MessageDispatcher } from '../messaging/dispatcher.service';
import type { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const order = {
  customerId: 'c1',
  locale: 'ru',
  contactName: 'Malika Karimova',
  number: 'F-10001',
  trackingToken: 'abcdefghij',
};

function make(enqueue: MessageDispatcher['enqueue']) {
  const prisma = { order: { findUniqueOrThrow: vi.fn(async () => order) } };
  return new NotificationsService(
    prisma as unknown as PrismaService,
    { enqueue } as unknown as MessageDispatcher,
    { APP_URL: 'https://forest.test' } as Env,
  );
}

describe('NotificationsService.orderStatus', () => {
  it('sends a service message through the dispatcher: Telegram first, SMS to the order phone', async () => {
    const enqueue = vi.fn(async () => null);
    await make(enqueue).orderStatus('o1', 'order_courier', { vaqt: '14:30' });
    expect(enqueue).toHaveBeenCalledWith({
      templateKey: 'order_courier',
      kind: 'service',
      customerId: 'c1',
      channels: ['TELEGRAM', 'SMS'],
      locale: 'ru',
      vars: {
        ism: 'Malika',
        raqam: 'F-10001',
        link: 'https://forest.test/t/abcdefghij',
        vaqt: '14:30',
      },
      orderId: 'o1',
      flow: { kind: 'order', orderId: 'o1', templateKey: 'order_courier' },
    });
  });

  it('never throws (checkout and payment handling must not fail on a notification)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(
      make(vi.fn(async () => Promise.reject(new Error('db down')))).orderStatus('o1', 'order_paid'),
    ).resolves.toBeUndefined();
    expect(String(warn.mock.calls[0]?.[0])).toContain('order_paid');
    warn.mockRestore();
  });
});
