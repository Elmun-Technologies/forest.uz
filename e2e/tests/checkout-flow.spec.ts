import { expect, test } from '@playwright/test';
import {
  addToCart,
  fillCheckout,
  noPlaceholders,
  placeOrder,
  quietOverlays,
  readOtp,
  spreadClientIp,
  uniquePhone,
} from './helpers';

/** Navigations may hit a first-time route compile on the dev server. */
const NAV = { timeout: 20_000 };

test.beforeEach(async ({ context, baseURL }) => {
  await quietOverlays(context, baseURL);
  await spreadClientIp(context);
});

test.describe('Phase 1 acceptance: browse → promo → COD → order → tracking', () => {
  test('home → catalog → filter → product → calculator → cart → SALOM10 → checkout COD → order → tracking', async ({
    page,
    isMobile,
  }) => {
    test.slow();
    await page.goto('/uz');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Catalog + one filter.
    await page.goto('/uz/katalog');
    await expect(page.getByTestId('product-card').first()).toBeVisible();
    const scope = isMobile ? page.getByRole('dialog') : page.getByRole('complementary');
    if (isMobile) await page.getByTestId('open-filters').click();
    await scope.locator('[data-testid^="volume-"]').first().click();
    await expect(page).toHaveURL(/[?&]volume=\d+/, NAV);
    if (isMobile) await page.keyboard.press('Escape');

    // Product → calculator → add the recommendation.
    await page.goto('/uz/p/chalk-white', { waitUntil: 'networkidle' });
    const calc = page.getByTestId('calculator');
    // 5 m² × 2 coats → about one litre: the 1 L can is the best-stocked size.
    await calc.getByLabel('Maydon, m²').fill('5');
    await expect(calc.getByTestId('calc-recommendation')).toContainText('L');
    await calc.getByRole('button', { name: /Tavsiyani savatga/ }).click();
    await expect(page.getByText("Savatga qo'shildi").first()).toBeVisible();

    // Cart: promo code (case-insensitive), discount shown.
    await page.goto('/uz/savat');
    await expect(page.getByTestId('cart-line').first()).toBeVisible();
    await noPlaceholders(page);
    await page.getByTestId('promo-input').fill('salom10');
    await page.getByRole('button', { name: "Qo'llash" }).click();
    await expect(page.getByTestId('promo-applied')).toContainText('SALOM10');

    // Checkout COD with a fresh phone (first order → SALOM10 stays valid).
    if (isMobile)
      await page
        .getByRole('link', { name: /Rasmiylashtirish/ })
        .last()
        .click();
    else await page.getByTestId('to-checkout').click();
    await expect(page).toHaveURL(/\/uz\/checkout$/, NAV);
    await fillCheckout(page, { phone: uniquePhone(), method: 'COD' });
    await noPlaceholders(page);
    await placeOrder(page, isMobile);

    await expect(page).toHaveURL(/\/uz\/buyurtma\/[\w-]+$/, NAV);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Rahmat, Dilnoza!');
    await expect(page.getByTestId('order-number')).toHaveText(/F-\d{5,}/);
    await expect(page.getByTestId('order-timeline')).toContainText('Qabul qilindi');
    await expect(page.getByText('SALOM10').first()).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await noPlaceholders(page);
    const number = (await page.getByTestId('order-number').innerText()).replace('№ ', '');

    // Header cart is empty after the order (cart converted).
    if (!isMobile) await expect(page.getByTestId('cart-count')).toHaveText('0');

    // Tracking link: short, locale-less URL served in the visitor's language.
    await page.getByTestId('tracking-link').click();
    await expect(page).toHaveURL(/\/t\/[\w-]{10}$/, NAV);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(number);
    await expect(page.getByTestId('tracking-steps')).toContainText('Qabul qilindi');
    await noPlaceholders(page);
  });

  test('checkout validates fields with human messages and requires the offer consent', async ({
    page,
    isMobile,
  }) => {
    test.slow();
    await page.goto('/uz');
    await addToCart(page);
    await page.goto('/uz/checkout');
    await page.getByTestId('checkout-phone').fill('9012');
    await placeOrder(page, isMobile);
    await expect(page.getByText("Raqam to'liq emas").first()).toBeVisible();
    await expect(page.getByText('oferta shartlariga rozilik kerak')).toBeVisible();
    await expect(page.getByTestId('checkout-phone')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/uz\/checkout$/, NAV);
  });
});

test.describe('online payment (fake Payme/Click)', () => {
  test('Payme success marks the order paid; a failed Click payment can be retried', async ({
    page,
    isMobile,
  }) => {
    test.slow();
    await page.goto('/uz');
    await addToCart(page);
    await page.goto('/uz/checkout');
    await fillCheckout(page, { phone: uniquePhone(), method: 'PAYME' });
    await placeOrder(page, isMobile);
    await expect(page).toHaveURL(/\/uz\/fake-pay\?provider=payme/, NAV);
    await page.getByTestId('fake-pay-success').click();
    await expect(page).toHaveURL(/\/uz\/buyurtma\//, NAV);
    await expect(page.getByTestId('payment-status')).toHaveText("to'langan");
    await expect(page.getByTestId('order-lead')).toContainText("Payme orqali to'lov tasdiqlandi");

    // Second order: Click declines → "To'lov yakunlanmadi" → retry with Payme → paid.
    await addToCart(page);
    await page.goto('/uz/checkout');
    await fillCheckout(page, { phone: uniquePhone(), method: 'CLICK' });
    await placeOrder(page, isMobile);
    await expect(page).toHaveURL(/\/uz\/fake-pay\?provider=click/, NAV);
    await page.getByTestId('fake-pay-fail').click();
    await expect(page).toHaveURL(/\/uz\/buyurtma\//, NAV);
    const retry = page.getByTestId('payment-retry');
    await expect(retry).toContainText("To'lov yakunlanmadi");
    await expect(page.getByTestId('retry-pay')).toBeEnabled();
    await retry
      .locator('label')
      .filter({ has: page.locator('input[value="PAYME"]') })
      .click();
    await page.getByTestId('retry-pay').click();
    await expect(page).toHaveURL(/\/uz\/fake-pay\?provider=payme/, NAV);
    await page.getByTestId('fake-pay-success').click();
    await expect(page).toHaveURL(/\/uz\/buyurtma\//, NAV);
    await expect(page.getByTestId('payment-status')).toHaveText("to'langan");
  });
});

test.describe('account', () => {
  test('OTP login (code from the dev outbox) and the cabinet lists the order', async ({
    page,
    isMobile,
  }) => {
    test.slow();
    const phone = uniquePhone();
    await page.goto('/uz');
    await addToCart(page);
    await page.goto('/uz/checkout');
    await fillCheckout(page, { phone, method: 'COD', name: 'Kamola' });
    await placeOrder(page, isMobile);
    await expect(page).toHaveURL(/\/uz\/buyurtma\//, NAV);
    const number = (await page.getByTestId('order-number').innerText()).replace('№ ', '');

    await page.goto('/uz/kabinet');
    await expect(page).toHaveURL(/\/uz\/kirish\?next=/, NAV);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await noPlaceholders(page);
    await page.getByTestId('login-phone').fill(phone);
    await page.getByTestId('login-send').click();
    const code = await readOtp(page.request, `+998${phone}`);
    await page.getByTestId('otp-0').click();
    await page.keyboard.type(code);
    await expect(page).toHaveURL(/\/uz\/kabinet$/, NAV);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Salom, Kamola');
    const orders = isMobile ? page.locator('main') : page.getByTestId('orders-table');
    await expect(orders.getByText(number).first()).toBeVisible();
    await expect(page.getByTestId('active-order')).toContainText(number);
    await noPlaceholders(page);

    // Logged in → the order page shows the full phone (owner view).
    await page.getByTestId('active-order').click();
    await expect(page.getByText(/\+998 93 \d{3} \d{2} \d{2}/).first()).toBeVisible();

    await page.goto('/uz/kabinet');
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/uz$/, NAV);
  });
});
