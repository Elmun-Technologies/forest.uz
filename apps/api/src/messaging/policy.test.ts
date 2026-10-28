import { fromTashkent } from '@forest/contracts';
import { decideSend, inQuietHours, quietHoursEnd, type SendContext } from './policy';

const rules = { marketingPerDay: 1, quietStart: '21:00', quietEnd: '09:00' };
const noon = fromTashkent(2026, 10, 27, 12, 0);

function ctx(over: Partial<SendContext> = {}): SendContext {
  return {
    kind: 'marketing',
    channel: 'TELEGRAM',
    now: noon,
    rules,
    consent: { sms: true, telegram: true },
    marketingToday: 0,
    ...over,
  };
}

describe('quiet hours (Asia/Tashkent)', () => {
  it.each([
    [8, 59, true],
    [9, 0, false],
    [20, 59, false],
    [21, 0, true],
    [23, 30, true],
    [0, 0, true],
  ])('%i:%i → quiet=%s', (h, m, quiet) => {
    expect(inQuietHours(fromTashkent(2026, 10, 27, h, m), '21:00', '09:00')).toBe(quiet);
  });

  it('a non-wrapping window and an empty one', () => {
    expect(inQuietHours(fromTashkent(2026, 10, 27, 13, 0), '12:00', '14:00')).toBe(true);
    expect(inQuietHours(fromTashkent(2026, 10, 27, 14, 0), '12:00', '14:00')).toBe(false);
    expect(inQuietHours(fromTashkent(2026, 10, 27, 3, 0), '00:00', '00:00')).toBe(false);
  });

  it('ends at the next 09:00: tomorrow from the evening, today after midnight', () => {
    expect(quietHoursEnd(fromTashkent(2026, 10, 27, 22, 15), '21:00', '09:00')).toEqual(
      fromTashkent(2026, 10, 28, 9, 0),
    );
    expect(quietHoursEnd(fromTashkent(2026, 10, 28, 2, 0), '21:00', '09:00')).toEqual(
      fromTashkent(2026, 10, 28, 9, 0),
    );
  });
});

describe('decideSend', () => {
  it('service messages are always sent — night, no consent, cap reached', () => {
    expect(
      decideSend(
        ctx({
          kind: 'service',
          now: fromTashkent(2026, 10, 27, 23, 0),
          consent: { sms: false, telegram: false },
          marketingToday: 9,
        }),
      ),
    ).toEqual({ action: 'send' });
  });

  it('marketing needs the consent of its own channel', () => {
    const tg = decideSend(ctx({ consent: { sms: true, telegram: false } }));
    expect(tg).toMatchObject({ action: 'skip', status: 'SKIPPED_NO_CONSENT' });
    expect(decideSend(ctx({ channel: 'SMS', consent: { sms: true, telegram: false } }))).toEqual({
      action: 'send',
    });
    expect(
      decideSend(ctx({ channel: 'SMS', consent: { sms: false, telegram: true } })),
    ).toMatchObject({
      status: 'SKIPPED_NO_CONSENT',
    });
  });

  it('marketing over the daily cap (any channel) is skipped', () => {
    expect(decideSend(ctx({ marketingToday: 1 }))).toMatchObject({
      action: 'skip',
      status: 'SKIPPED_CAP',
    });
    expect(decideSend(ctx({ marketingToday: 1, rules: { ...rules, marketingPerDay: 2 } }))).toEqual(
      {
        action: 'send',
      },
    );
  });

  it('quiet hours defer marketing and requested messages to 09:00 instead of dropping them', () => {
    const night = fromTashkent(2026, 10, 27, 21, 30);
    const until = fromTashkent(2026, 10, 28, 9, 0);
    expect(decideSend(ctx({ now: night }))).toEqual({ action: 'defer', until });
    expect(
      decideSend(ctx({ now: night, kind: 'requested', consent: { sms: false, telegram: false } })),
    ).toEqual({
      action: 'defer',
      until,
    });
    // The cap is judged when the deferred message comes due, not at night.
    expect(decideSend(ctx({ now: night, marketingToday: 5 }))).toEqual({ action: 'defer', until });
  });

  it('requested messages need no marketing consent and ignore the cap', () => {
    expect(
      decideSend(
        ctx({ kind: 'requested', consent: { sms: false, telegram: false }, marketingToday: 3 }),
      ),
    ).toEqual({ action: 'send' });
  });

  it('no consent wins over quiet hours (nothing is queued for a customer who opted out)', () => {
    expect(
      decideSend(
        ctx({ now: fromTashkent(2026, 10, 27, 23, 0), consent: { sms: false, telegram: false } }),
      ),
    ).toMatchObject({ status: 'SKIPPED_NO_CONSENT' });
  });
});
