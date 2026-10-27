import { expect, type Page, test } from '@playwright/test';
import {
  addToCart,
  devHeaders,
  noPlaceholders,
  quietOverlays,
  spreadClientIp,
  uniquePhone,
} from './helpers';

/**
 * Phase 2 storefront wiring: Telegram login/link, phone-less (Telegram-only) cabinet, courier
 * and BTS details on tracking and the order page. Server-rendered pages read the API from the
 * Next server, so states are created through the dev-only API (`/dev/telegram-login`,
 * `/dev/shipment`; fake providers + DEV_ENDPOINTS) instead of browser route interception.
 */
const NAV = { timeout: 20_000 };

test.beforeEach(async ({ context, baseURL }) => {
  await quietOverlays(context, baseURL);
  await spreadClientIp(context);
});

const randomIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** COD order placed through the API from this browser (so it owns the order via `fr_ord`). */
async function placeOrderViaApi(page: Page, region: 'tashkent_city' | 'samarkand') {
  await addToCart(page);
  const settings = (await (await page.request.get('/api/settings/public')).json()) as {
    store: { offerVersion: string };
  };
  const options = (await (await page.request.get(`/api/cart/quote?region=${region}`)).json()) as {
    zoneKey: string;
  }[];
  expect(options.length).toBeGreaterThan(0);
  const res = await page.request.post('/api/checkout/orders', {
    headers: {
      'Idempotency-Key': crypto.randomUUID(),
      'Accept-Language': 'uz',
      'X-Forwarded-For': randomIp(),
    },
    data: {
      name: 'Dilnoza',
      phone: `+998${uniquePhone()}`,
      region,
      district: null,
      addressLine: "Amir Temur ko'chasi, 15-uy",
      lat: null,
      lng: null,
      zoneKey: options[0]!.zoneKey,
      paymentMethod: 'COD',
      comment: null,
      offerVersion: settings.store.offerVersion,
      consents: { smsMarketing: false, telegram: false },
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { publicId } = (await res.json()) as { publicId: string };
  const order = (await (await page.request.get(`/api/orders/${publicId}`)).json()) as {
    trackingUrl: string;
  };
  return { publicId, trackPath: new URL(order.trackingUrl).pathname };
}

async function setShipment(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/dev/shipment', { data: body, headers: devHeaders() });
  expect(res.ok(), `dev shipment: ${res.status()} ${await res.text()}`).toBe(true);
}

test.describe('Telegram login', () => {
  test('widget and telegram.org script are absent while the API has no bot', async ({ page }) => {
    const settings = (await (await page.request.get('/api/settings/public')).json()) as {
      auth: { telegramBot: string | null };
    };
    expect(settings.auth.telegramBot, 'dev runs without a connected Telegram bot').toBeNull();
    const telegramRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('telegram.org')) telegramRequests.push(r.url());
    });
    await page.goto('/uz/kirish', NAV);
    await expect(page.getByTestId('login-send')).toBeEnabled();
    await expect(page.getByTestId('telegram-login')).toHaveCount(0);
    await expect(page.getByText('yoki', { exact: true })).toHaveCount(0);
    await page.waitForTimeout(500); // idle work would have run by now
    expect(await page.locator('script[data-telegram-login]').count()).toBe(0);
    expect(telegramRequests).toEqual([]);
  });
});

test.describe('Telegram-only customer (phone: null)', () => {
  test('cabinet, settings and checkout work without a phone', async ({ page }) => {
    test.slow();
    const id = String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 90 + 10));
    const username = `e2e_${id.slice(-8)}`;
    const login = await page.request.post('/api/dev/telegram-login', {
      data: { id, first_name: 'Dilnoza', username },
      headers: devHeaders(),
    });
    expect(login.ok(), await login.text()).toBe(true);
    const me = (await login.json()) as { phone: string | null; telegram: { username: string } };
    expect(me.phone).toBeNull();
    expect(me.telegram.username).toBe(username);

    await page.goto('/uz/kabinet', NAV);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Salom, Dilnoza');
    await expect(page.getByTestId('account-identity')).toHaveText('Dilnoza');
    await expect(page.getByText(`@${username}`).first()).toBeVisible();
    await noPlaceholders(page);

    for (const tab of ['manzillar', 'sevimlilar', 'bildirishnomalar']) {
      const res = await page.goto(`/uz/kabinet/${tab}`, NAV);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId('account-identity')).toHaveText('Dilnoza');
    }

    await page.goto('/uz/kabinet/sozlamalar', NAV);
    await expect(page.getByLabel('Ism')).toHaveValue('Dilnoza');
    await expect(page.getByLabel('Telefon', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('telegram-link')).toContainText('Telegram ulangan');
    await expect(page.getByTestId('telegram-username')).toHaveText(`@${username}`);
    await noPlaceholders(page);

    // Checkout asks for the phone (never prefilled from a Telegram account).
    await addToCart(page);
    await page.goto('/uz/checkout', NAV);
    await expect(page.getByTestId('checkout-phone')).toHaveValue('');
    await expect(page.getByLabel(/^Ism$/)).toHaveValue('Dilnoza');
  });
});

test.describe('tracking: courier and carrier details', () => {
  test('owner sees the courier with a call link; a fresh device sees it masked', async ({
    page,
    browser,
  }) => {
    test.slow();
    const { publicId, trackPath } = await placeOrderViaApi(page, 'tashkent_city');
    const eta = new Date(Date.now() + 40 * 60_000).toISOString();
    await setShipment(page, {
      publicId,
      status: 'COURIER_ASSIGNED',
      carrier: 'YANDEX',
      externalId: `e2e-claim-${publicId}`,
      courier: {
        name: 'Jasur Karimov',
        phone: '+998901112233',
        phoneExt: '4321',
        car: 'Chevrolet Damas',
        plate: '01 A 123 BC',
        etaAt: eta,
        distanceKm: 4.2,
      },
    });

    await page.goto(trackPath, NAV);
    await expect(page.locator('html')).toHaveAttribute('lang', 'uz');
    const card = page.getByTestId('courier-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('courier-name')).toHaveText('Jasur · Yandex kuryer');
    await expect(page.getByTestId('courier-car')).toHaveText('Chevrolet Damas · 01 A 123 BC');
    await expect(page.getByTestId('courier-call')).toHaveAttribute(
      'href',
      'tel:+998901112233,4321',
    );
    await expect(page.getByTestId('courier-ext')).toContainText('4321');
    await expect(page.getByTestId('tracking-eta')).toContainText('–');
    await expect(page.getByTestId('carrier-ref')).toContainText(`e2e-claim-${publicId}`);
    // A live Yandex claim locks the address; the reason is shown instead of the form.
    await expect(page.getByTestId('change-address')).toHaveCount(0);
    await expect(page.getByTestId('change-address-locked')).toBeDisabled();
    await expect(page.locator('#address-locked')).toContainText('kuryer xizmatiga yuborilgan');
    await expect(page.getByTestId('carrier-history')).toBeVisible();
    await noPlaceholders(page);

    // The order page shows the same courier block under the status timeline.
    await page.goto(`/uz/buyurtma/${publicId}`, NAV);
    await expect(page.getByTestId('order-carrier').getByTestId('courier-call')).toHaveAttribute(
      'href',
      'tel:+998901112233,4321',
    );

    // A fresh device (SMS link forwarded, Russian browser): order language, masked number.
    const other = await browser.newContext({
      locale: 'ru-RU',
      extraHTTPHeaders: { 'Accept-Language': 'ru' },
    });
    const fresh = await other.newPage();
    await fresh.goto(trackPath, NAV);
    await expect(fresh.locator('html')).toHaveAttribute('lang', 'uz');
    await expect(fresh.getByTestId('courier-card')).toBeVisible();
    await expect(fresh.getByTestId('courier-call')).toHaveCount(0);
    await expect(fresh.getByTestId('courier-phone-masked')).toContainText('*');
    await expect(fresh.getByTestId('courier-phone-masked')).not.toContainText('1112233');
    await expect(fresh.getByTestId('courier-card').getByRole('link')).toHaveAttribute(
      'href',
      /\/kirish\?next=%2Ft%2F/,
    );
    await other.close();
  });

  test('BTS: track number, branch and carrier history', async ({ page }) => {
    test.slow();
    const { publicId, trackPath } = await placeOrderViaApi(page, 'samarkand');
    await setShipment(page, {
      publicId,
      status: 'IN_TRANSIT',
      carrier: 'BTS',
      trackNumber: 'BTS0045118277',
      note: 'Jizzax tranzit',
    });
    await setShipment(page, {
      publicId,
      status: 'AT_BRANCH',
      branch: 'BTS Samarqand · 3-filial',
    });

    await page.goto(trackPath, NAV);
    await expect(page.getByTestId('carrier-ref')).toHaveText('Trek BTS0045118277');
    await expect(page.getByTestId('bts-branch')).toContainText('BTS Samarqand · 3-filial');
    const history = page.getByTestId('carrier-history');
    await expect(history.getByRole('heading')).toHaveText('BTS trek tarixi');
    await expect(history.locator('li')).toHaveCount(2);
    await expect(history.locator('li').first()).toContainText('BTS Samarqand · 3-filial');
    await expect(history.locator('li').nth(1)).toContainText('Jizzax tranzit');
    await expect(page.getByTestId('courier-card')).toHaveCount(0);
    await noPlaceholders(page);

    await page.goto(`/uz/buyurtma/${publicId}`, NAV);
    await expect(page.getByTestId('order-carrier')).toContainText('BTS Samarqand · 3-filial');
    await expect(page.getByTestId('order-carrier')).toContainText('Trek BTS0045118277');
  });
});
