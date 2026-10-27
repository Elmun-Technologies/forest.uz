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
