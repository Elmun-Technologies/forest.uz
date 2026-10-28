/**
 * Coarse User-Agent parsing for Session.device/os/browser (docs/07 "UA → device/os/browser").
 * In-repo on purpose: reports need three low-cardinality fields, not a 300 KB UA database.
 * Order matters — in-app and Chromium-based browsers also say "Chrome"/"Safari".
 */
export interface ParsedUa {
  device: 'mobile' | 'tablet' | 'desktop';
  os: string | null;
  browser: string | null;
}

const BROWSERS: [RegExp, string][] = [
  [/Telegram|TelegramBot|\bTgWebView/i, 'Telegram'],
  [/\bInstagram\b/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB/i, 'Facebook'],
  [/YaBrowser|YaSearchBrowser|YandexSearch/i, 'Yandex'],
  [/SamsungBrowser/i, 'Samsung Internet'],
  [/\bEdg(?:e|A|iOS)?\//i, 'Edge'],
  [/\bOPR\/|\bOpera\b|OPiOS/i, 'Opera'],
  [/MiuiBrowser/i, 'MIUI'],
  [/UCBrowser/i, 'UC Browser'],
  [/Firefox\/|FxiOS/i, 'Firefox'],
  [/CriOS|Chrome\/|Chromium\//i, 'Chrome'],
  [/Safari\//i, 'Safari'],
];

const OSES: [RegExp, string][] = [
  [/iPhone|iPad|iPod|iOS/i, 'iOS'],
  [/Android/i, 'Android'],
  [/CrOS/i, 'ChromeOS'],
  [/Windows/i, 'Windows'],
  [/Mac OS X|Macintosh/i, 'macOS'],
  [/Linux|X11/i, 'Linux'],
];

export function parseUserAgent(ua: string | null | undefined): ParsedUa {
  const s = ua ?? '';
  const os = OSES.find(([re]) => re.test(s))?.[1] ?? null;
  const browser = BROWSERS.find(([re]) => re.test(s))?.[1] ?? null;
  const tablet =
    /iPad|Tablet|PlayBook|Silk|Kindle/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s));
  const mobile = !tablet && /Mobi|iPhone|iPod|Android|Windows Phone|Opera Mini/i.test(s);
  return { device: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', os, browser };
}
