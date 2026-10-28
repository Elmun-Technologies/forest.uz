import { signCartLink, verifyCartLink } from './cart-link.service';
import { dayRange } from './bot-updates.service';
import { shortName } from '../admin/bot/admin-bot.service';

const SECRET = 'c'.repeat(64);
const NOW = 1_800_000_000;

describe('cart restore links', () => {
  it('round-trips a cart, lines, promo, campaign and locale', () => {
    const token = signCartLink(
      {
        cartId: 'cart_1',
        lines: [{ variantId: 'v1', qty: 2 }],
        promo: 'SAVAT5',
        campaign: 'abandoned_cart',
        locale: 'ru',
        exp: NOW + 60,
      },
      SECRET,
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{32}$/);
    expect(verifyCartLink(token, SECRET, NOW)).toEqual({
      cartId: 'cart_1',
      lines: [{ variantId: 'v1', qty: 2 }],
      promo: 'SAVAT5',
      campaign: 'abandoned_cart',
      locale: 'ru',
      exp: NOW + 60,
    });
  });

  it('rejects expired, tampered or foreign tokens', () => {
    const token = signCartLink({ cartId: 'cart_1', exp: NOW + 60 }, SECRET);
    expect(verifyCartLink(token, SECRET, NOW + 61)).toBeNull();
    expect(verifyCartLink(token, 'd'.repeat(64), NOW)).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ c: 'cart_2', e: NOW + 60 })).toString('base64url');
    expect(verifyCartLink(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifyCartLink(`${body}.${sig!.slice(0, -1)}A`, SECRET, NOW)).toBeNull();
    expect(verifyCartLink('not a token', SECRET, NOW)).toBeNull();
  });
});

describe('bot formatting helpers', () => {
  it('names operator weekdays like the design (Du–Sha)', () => {
    expect(dayRange([1, 2, 3, 4, 5, 6], 'uz')).toBe('Du–Sh');
    expect(dayRange([1, 2, 3, 4, 5, 6], 'ru')).toBe('Пн–Сб');
    expect(dayRange([1, 3], 'uz')).toBe('Du, Ch');
  });

  it('shortens customer names for the inbox', () => {
    expect(shortName('Dilnoza Yusupova')).toBe('Dilnoza Y.');
    expect(shortName('Aziz')).toBe('Aziz');
    expect(shortName('  ')).toBeNull();
  });
});
