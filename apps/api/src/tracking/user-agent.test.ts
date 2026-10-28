import { isBot } from './bot-filter';
import { parseUserAgent } from './user-agent';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsungTab:
    'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  yandex:
    'Mozilla/5.0 (Linux; Android 12; Redmi Note 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 YaBrowser/24.4.1.99.00 SA/3 Mobile Safari/537.36',
  instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.40.92',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  cubot:
    'Mozilla/5.0 (Linux; Android 12; Cubot X30 Build/SP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
};

describe('parseUserAgent', () => {
  it.each([
    ['iphone', 'mobile', 'iOS', 'Safari'],
    ['android', 'mobile', 'Android', 'Chrome'],
    ['samsungTab', 'tablet', 'Android', 'Samsung Internet'],
    ['ipad', 'tablet', 'iOS', 'Safari'],
    ['windowsEdge', 'desktop', 'Windows', 'Edge'],
    ['macChrome', 'desktop', 'macOS', 'Chrome'],
    ['yandex', 'mobile', 'Android', 'Yandex'],
    ['instagram', 'mobile', 'iOS', 'Instagram'],
    ['firefoxLinux', 'desktop', 'Linux', 'Firefox'],
  ] as const)('%s', (key, device, os, browser) => {
    expect(parseUserAgent(UA[key])).toEqual({ device, os, browser });
  });

  it('unknown', () => {
    expect(parseUserAgent(null)).toEqual({ device: 'desktop', os: null, browser: null });
  });
});

describe('isBot', () => {
  it('real browsers pass (incl. a phone model ending in "bot")', () => {
    for (const ua of Object.values(UA)) expect(isBot({ userAgent: ua }), ua).toBe(false);
  });

  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
    'TelegramBot (like TwitterBot)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'curl/8.5.0',
    'python-requests/2.32.3',
    'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
    '',
  ])('drops %s', (ua) => {
    expect(isBot({ userAgent: ua })).toBe(true);
  });

  it('drops automation that reports navigator.webdriver', () => {
    expect(isBot({ userAgent: UA.macChrome, webdriver: true })).toBe(true);
  });
});
