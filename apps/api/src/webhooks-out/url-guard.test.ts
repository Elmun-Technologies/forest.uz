import { describe, expect, it } from 'vitest';
import { assertWebhookUrl, isPrivateAddress } from './url-guard';

describe('webhook url guard', () => {
  it('classifies private, loopback, link-local and mapped addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '0.0.0.0',
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of [
      '::10.0.0.1',
      '2002:a00:1::1',
      '64:ff9b:1::a00:1',
      '100::1',
      '64:ff9b::7f00:1',
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '213.230.64.1', '2a00:1450:4001::200e'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('production: https + public resolution only', async () => {
    const pub = async () => ['93.184.216.34'];
    const priv = async () => ['10.0.0.5'];
    await expect(
      assertWebhookUrl('https://hooks.example.com/x', { strict: true, resolve: pub }),
    ).resolves.toBe('https://hooks.example.com/x');
    await expect(
      assertWebhookUrl('http://hooks.example.com/x', { strict: true, resolve: pub }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_URL_INVALID' });
    await expect(
      assertWebhookUrl('https://hooks.example.com/x', { strict: true, resolve: priv }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_URL_INVALID' });
    await expect(assertWebhookUrl('https://127.0.0.1/x', { strict: true })).rejects.toMatchObject({
      code: 'WEBHOOK_URL_INVALID',
    });
    await expect(assertWebhookUrl('https://localhost/x', { strict: true })).rejects.toMatchObject({
      code: 'WEBHOOK_URL_INVALID',
    });
    await expect(
      assertWebhookUrl('https://u:p@hooks.example.com/', { strict: true, resolve: pub }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_URL_INVALID' });
  });

  it('non-production allows http to local receivers', async () => {
    await expect(assertWebhookUrl('http://127.0.0.1:9999/hook', { strict: false })).resolves.toBe(
      'http://127.0.0.1:9999/hook',
    );
    await expect(assertWebhookUrl('ftp://x', { strict: false })).rejects.toMatchObject({
      code: 'WEBHOOK_URL_INVALID',
    });
  });
});

describe('pinnedLookup', () => {
  it('returns only vetted addresses (single and all-mode) and fails on private ones', async () => {
    const { pinnedLookup } = await import('./url-guard');
    const lookup = pinnedLookup({ strict: true, resolve: async () => ['93.184.216.34'] });
    const one = await new Promise((r) =>
      lookup('hooks.example.com', {}, (err, address, family) => r({ err, address, family })),
    );
    expect(one).toEqual({ err: null, address: '93.184.216.34', family: 4 });
    const all = await new Promise((r) =>
      lookup('hooks.example.com', { all: true }, (err, addresses) => r({ err, addresses })),
    );
    expect(all).toEqual({ err: null, addresses: [{ address: '93.184.216.34', family: 4 }] });
    const bad = pinnedLookup({ strict: true, resolve: async () => ['169.254.169.254'] });
    const err = await new Promise((r) => bad('meta.example.com', {}, (e) => r(e)));
    expect(err).toMatchObject({ code: 'WEBHOOK_URL_INVALID' });
  });
});
