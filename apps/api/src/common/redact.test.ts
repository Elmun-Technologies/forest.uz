import {
  maskPhonesInText,
  redact,
  REDACTED,
  requestLogPath,
  serializeRequestForLog,
} from './redact';

describe('redact', () => {
  it('redacts sensitive keys recursively', () => {
    const out = redact({
      order: { id: 'o1', phone: '+998901234567', address: { line: 'x' } },
      headers: { Authorization: 'Basic abc' },
      items: [{ token: 't', sku: 'FR-CW' }],
      when: new Date(0),
    });
    expect(out.order.phone).toBe(REDACTED);
    expect(out.order.address).toBe(REDACTED);
    expect(out.headers.Authorization).toBe(REDACTED);
    expect(out.items[0]?.token).toBe(REDACTED);
    expect(out.items[0]?.sku).toBe('FR-CW');
    expect(out.when).toBeInstanceOf(Date);
  });

  it('masks phones inside free text', () => {
    expect(maskPhonesInText('call +998 90 123 45 67 now')).toBe('call +998 90 *** ** 67 now');
    expect(maskPhonesInText('998901234567')).toBe('+998 90 *** ** 67');
  });

  it('stops at excessive depth', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 12; i++) deep = deep.n = {};
    expect(JSON.stringify(redact(root))).toContain(REDACTED);
  });
});

describe('safeUrl', () => {
  it('drops query strings and masks credential-like path segments', async () => {
    const { safeUrl } = await import('./redact');
    expect(safeUrl('https://api.telegram.org/bot123456:AAbbCCdd/sendMessage?chat_id=1')).toBe(
      'https://api.telegram.org/bot***/sendMessage',
    );
    expect(safeUrl('https://x.uz/hooks/abcdefghijklmnopqrstuvwxyz012345/ok')).toBe(
      'https://x.uz/hooks/***/ok',
    );
    expect(safeUrl('https://notify.eskiz.uz/api/message/sms/send')).toBe(
      'https://notify.eskiz.uz/api/message/sms/send',
    );
    expect(safeUrl('not a url')).toBe('[invalid-url]');
  });

  it('redacts SMS bodies', () => {
    expect(redact({ mobile_phone: '998901234567', message: 'kod 4711' })).toEqual({
      mobile_phone: REDACTED,
      message: REDACTED,
    });
  });
});

describe('access log request serializer', () => {
  it('masks the Eskiz callback token and drops query strings', () => {
    const token = 'Zx9_aB-cD3eF5gH7iJ9kL1mN3oP5qR7sT9uV1wX3yZ5';
    expect(
      serializeRequestForLog({ id: 'r1', method: 'POST', url: `/v1/webhooks/eskiz/${token}` }),
    ).toEqual({ id: 'r1', method: 'POST', path: '/v1/webhooks/eskiz/***' });
    expect(requestLogPath(`/v1/Webhooks/ESKIZ/${token}/?x=1`)).toBe('/v1/Webhooks/ESKIZ/***/');
    expect(requestLogPath(`/v1/webhooks/telegram/${token}`)).toBe('/v1/webhooks/telegram/***');
    expect(requestLogPath('/v1/webhooks/yandex-delivery?key=secret&claim_id=c1')).toBe(
      '/v1/webhooks/yandex-delivery',
    );
    // Ordinary paths stay readable (long slugs are not mistaken for secrets).
    expect(requestLogPath('/v1/catalog/products/mebel-boyogi-chalk-paint-white-1l')).toBe(
      '/v1/catalog/products/mebel-boyogi-chalk-paint-white-1l',
    );
  });
});
