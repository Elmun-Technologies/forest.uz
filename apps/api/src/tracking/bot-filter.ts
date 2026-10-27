/**
 * Bot filter for `POST /v1/t` (docs/07 "drop bots: UA list + behavior"). JS-less crawlers never
 * run the tracker; what remains is headless browsers, audit tools and HTTP clients replaying the
 * endpoint. Automation that impersonates a real browser and hides `navigator.webdriver` (our own
 * Playwright synthetic traffic does this on purpose) is indistinguishable and accepted.
 */
const BOT_UA =
  /\b(?!cubot\b)\w*bot\b|crawl|spider|slurp|archiver|scrap|headless|phantomjs|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|whatsapp|telegrambot|vkshare|yandex(?:bot|metrika|images|direct)|bingpreview|google-?(?:inspectiontool|read-aloud|structured)|adsbot|mediapartners|curl\/|wget\/|python-|aiohttp|httpclient|okhttp|axios\/|node-fetch|undici|go-http|java\/|libwww|postman|insomnia|electron\/.*\bheadless/i;

export interface BotSignals {
  userAgent: string | null | undefined;
  /** `navigator.webdriver` reported by the tracker. */
  webdriver?: boolean;
}

export function isBot({ userAgent, webdriver }: BotSignals): boolean {
  const ua = (userAgent ?? '').trim();
  if (ua.length < 10) return true;
  if (webdriver) return true;
  return BOT_UA.test(ua);
}
