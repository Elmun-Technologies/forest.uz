import { type APIRequestContext, type BrowserContext, expect, type Page } from '@playwright/test';

export const API = process.env.API_URL ?? 'http://localhost:4000';
export const PLACEHOLDER = /\[[^\]\n]{1,40}\]/;

/** Pre-answer the cookie banner and suppress the exit popup so overlays don't cover the flow. */
export async function quietOverlays(context: BrowserContext, baseURL: string | undefined) {
  await context.addCookies([
    {
      name: 'fr_consent',
      value: encodeURIComponent(JSON.stringify({ v: 1, analytics: true, marketing: false, ts: 1 })),
      url: baseURL ?? 'http://localhost:3000',
    },
  ]);
  await context.addInitScript(() => sessionStorage.setItem('fr_popup_shown', '1'));
}

export async function noPlaceholders(page: Page) {
  expect(await page.locator('body').innerText()).not.toMatch(PLACEHOLDER);
}

/**
 * 9 local digits that are unique per run and per worker, so reruns never trip the
 * one-code-per-phone promo rule or OTP resend limits. 93 = valid Ucell code.
 */
let seq = 0;
export function uniquePhone(): string {
  seq += 1;
  const n =
    (Date.now() * 10 + seq + Number(process.env.TEST_WORKER_INDEX ?? 0) * 7919) % 10_000_000;
  return `93${String(n).padStart(7, '0')}`;
}

/**
 * All test browsers share one IP, while the API rate-limits OTP sends (5/h per IP) and checkouts
 * (10/min per IP). Give each such request its own forwarded address — the e2e stacks have no
 * proxy in front, so the API's single trusted hop is the browser's X-Forwarded-For.
 */
const randomIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

export async function spreadClientIp(target: Page | BrowserContext) {
  for (const path of ['**/api/auth/otp/send', '**/api/checkout/orders']) {
    await target.route(path, (route) =>
      route.continue({
        headers: { ...route.request().headers(), 'x-forwarded-for': randomIp() },
      }),
    );
  }
}

/** Latest OTP the fake SMS provider captured for a phone (dev outbox; never used by the UI). */
export async function readOtp(request: APIRequestContext, e164: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(async () => {
      const res = await request.get(`${API}/v1/dev/outbox?to=${encodeURIComponent(e164)}`);
      const msgs = (await res.json()) as { templateKey: string; text: string }[];
      code = msgs
        .filter((m) => m.templateKey === 'otp')
        .at(-1)
        ?.text.match(/\b(\d{4})\b/)?.[1];
      return code;
    })
    .toBeTruthy();
  return code!;
}

/**
 * Puts the in-stock variant with the most availability into this browser's cart (shares
 * cookies). Test orders keep their reservations (COD: 24 h), so fixed SKUs run dry on reruns.
 */
export async function addToCart(page: Page, qty = 1) {
  const list = (await (await page.request.get(`${API}/v1/catalog/products?limit=60`)).json()) as {
    items: { slug: string; inStock: boolean; type: string }[];
  };
  let best: { id: string; available: number } | null = null;
  for (const p of list.items.filter((x) => x.inStock)) {
    const detail = (await (
      await page.request.get(`${API}/v1/catalog/products/${p.slug}`)
    ).json()) as {
      variants: { id: string; available: number }[];
    };
    for (const v of detail.variants)
      if (v.available >= qty && (!best || v.available > best.available)) best = v;
  }
  expect(best, 'an in-stock variant for the test cart').toBeTruthy();
  const res = await page.request.post('/api/cart/items', { data: { variantId: best!.id, qty } });
  expect(res.ok()).toBe(true);
}

/** Fills the checkout form; `method` picks the payment card. */
export async function fillCheckout(
  page: Page,
  opts: { phone: string; method: 'COD' | 'PAYME' | 'CLICK'; name?: string },
) {
  await expect(page.getByTestId('checkout-phone')).toBeVisible();
  await page.getByLabel(/^(Ism|Имя)$/).fill(opts.name ?? 'Dilnoza');
  await page.getByTestId('checkout-phone').fill(opts.phone);
  await page.getByLabel(/^(Manzil|Адрес)$/).fill("Amir Temur ko'chasi, 15-uy");
  await expect(page.locator('[data-testid^="delivery-"]').first()).toBeVisible();
  await page.getByTestId(`pay-${opts.method}`).click();
  await page.getByTestId('consent-offer').check();
}

export async function placeOrder(page: Page, isMobile: boolean) {
  await page.getByTestId(isMobile ? 'place-order-mobile' : 'place-order').click();
}
