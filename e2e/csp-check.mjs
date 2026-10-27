#!/usr/bin/env node
/**
 * CSP / security-header check against a stack behind Caddy (staging or the local prod-like stack;
 * docs/runbooks/deploy-and-rollback.md). Not part of `pnpm e2e`: the e2e stack has no Caddy.
 *
 *   SITE=https://shop.example ADMIN=https://admin.example \
 *   OWNER_EMAIL=… OWNER_PASSWORD=… [OWNER_TOTP_SECRET=…] [INSECURE=1] \
 *   node e2e/csp-check.mjs
 *
 * Opens the storefront (crawled from the home page + the flow pages) and the admin (login →
 * TOTP → main pages), records every `securitypolicyviolation` event and CSP console error, checks
 * the security headers, and proves the policy actually blocks: a foreign script on a shop page and
 * the Telegram origins outside the login/settings pages must be refused. Exit 1 on any finding.
 * Without OWNER_TOTP_SECRET the owner must not be enrolled yet (the script enrols, prints the
 * secret once — keep it for the next run or reset TOTP in the admin).
 */
import { createHmac } from 'node:crypto';
import { chromium } from '@playwright/test';

const SITE = (process.env.SITE ?? 'https://shop.localhost:8443').replace(/\/$/, '');
const ADMIN = (process.env.ADMIN ?? 'https://admin.localhost:8443').replace(/\/$/, '');
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 30);
const findings = [];
const report = [];

const SHOP_HEADERS = {
  'content-security-policy': /frame-ancestors 'none'/,
  'strict-transport-security': /max-age=\d+/,
  'x-content-type-options': /nosniff/,
  'referrer-policy': /strict-origin-when-cross-origin/,
  'permissions-policy': /camera=\(\)/,
  'x-frame-options': /DENY/,
};
const ADMIN_HEADERS = {
  'content-security-policy': /frame-ancestors 'none'/,
  'strict-transport-security': /max-age=\d+/,
  'x-frame-options': /DENY/,
  'x-robots-tag': /noindex/,
  'referrer-policy': /no-referrer/,
};

function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 (SHA-1, 6 digits, 30 s) — the admin's TOTP parameters. */
function totp(secret, offsetSteps = 0) {
  const step = Math.floor(Date.now() / 30_000) + offsetSteps;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function watch(page, label) {
  const violations = [];
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__csp.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        sample: e.sample,
        source: e.sourceFile,
      }),
    );
  });
  page.on('console', (m) => {
    if (/Content.Security.Policy|Refused to/i.test(m.text()))
      violations.push({ console: m.text().slice(0, 300) });
  });
  return async () => {
    const fromPage = await page.evaluate(() => window.__csp ?? []).catch(() => []);
    return [...fromPage, ...violations].map((v) => ({ page: label, ...v }));
  };
}

function checkHeaders(where, headers, expected) {
  for (const [name, re] of Object.entries(expected)) {
    const v = headers[name];
    if (!v || !re.test(v)) findings.push(`${where}: header ${name} = ${v ?? '(missing)'}`);
  }
}

async function visit(context, url, label, { expectHeaders } = {}) {
  const page = await context.newPage();
  const collect = await watch(page, label);
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 }).catch((e) => {
    findings.push(`${label}: navigation failed ${e.message.split('\n')[0]}`);
    return null;
  });
  if (res && expectHeaders) checkHeaders(label, res.headers(), expectHeaders);
  await page.waitForTimeout(1500);
  const v = await collect();
  report.push({ page: label, status: res?.status() ?? 0, violations: v.length });
  for (const x of v) findings.push(`CSP violation ${JSON.stringify(x)}`);
  return page;
}

/** A blocked load must surface as a violation (proves the header is enforced, not report-only). */
async function expectBlocked(page, label, inject) {
  await page.evaluate(() => (window.__csp = []));
  await page.evaluate(inject).catch(() => {});
  await page.waitForTimeout(1500);
  const v = await page.evaluate(() => window.__csp ?? []);
  report.push({ page: label, blocked: v.length > 0 });
  if (!v.length) findings.push(`${label}: expected a CSP block, none happened`);
}

async function expectAllowed(page, label, inject) {
  await page.evaluate(() => (window.__csp = []));
  await page.evaluate(inject).catch(() => {});
  await page.waitForTimeout(1500);
  const v = await page.evaluate(() => window.__csp ?? []);
  report.push({ page: label, allowedByCsp: v.length === 0 });
  if (v.length) findings.push(`${label}: blocked by CSP ${JSON.stringify(v)}`);
}

async function shop(browser) {
  const context = await browser.newContext({ ignoreHTTPSErrors: Boolean(process.env.INSECURE) });
  const home = await visit(context, `${SITE}/uz`, '/uz', { expectHeaders: SHOP_HEADERS });
  // Consent "accept all" loads the tracker (/t.js) and possibly the replay recorder (/r.js).
  const accept = home.getByRole('button', { name: /Hammasiga roziman/i });
  if (await accept.isVisible().catch(() => false)) {
    await accept.click();
    await home.waitForTimeout(4000);
    const csp = await home.evaluate(() => window.__csp ?? []);
    for (const x of csp) findings.push(`CSP violation after consent ${JSON.stringify(x)}`);
  }
  const links = await home.$$eval('a[href^="/"]', (as) => [
    ...new Set(as.map((a) => a.getAttribute('href').split('#')[0])),
  ]);
  const seen = new Set(['/uz']);
  const queue = [
    ...links,
    '/ru',
    '/uz/katalog',
    '/uz/savat',
    '/uz/qidiruv?q=boyoq',
    '/uz/kirish',
    '/ru/kirish',
    '/uz/oferta',
    '/uz/maxfiylik',
    '/uz/nonexistent-page-404',
  ];
  // Products: the cart and checkout need one item. In-page fetch: same origin, the cart cookie
  // lands in the browser context (and *.localhost resolves only inside the browser).
  const first = await home.evaluate(async () => {
    const r = await fetch('/api/catalog/products');
    const { items } = await r.json();
    const p = items.find((i) => i.inStock && i.defaultVariantId);
    if (!p) return null;
    await fetch('/api/cart/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variantId: p.defaultVariantId, qty: 1 }),
    });
    return p.slug;
  });
  if (first) queue.unshift(`/uz/p/${first}`, `/ru/p/${first}`, '/uz/checkout', '/ru/savat');
  else findings.push('no product in stock — cart/checkout pages not checked');
  for (const path of queue) {
    if (seen.size >= MAX_PAGES) break;
    // /tg and /c/<token> redirect to t.me / restore carts: not pages of ours.
    if (seen.has(path) || /^\/(api|_next|c)\//.test(path) || path.startsWith('/tg')) continue;
    seen.add(path);
    const p = await visit(context, `${SITE}${path}`, path);
    await p.close();
  }

  // Enforcement probes.
  const probe = await visit(context, `${SITE}/uz`, 'probe /uz');
  await expectBlocked(probe, 'foreign script on /uz', () => {
    const s = document.createElement('script');
    s.src = 'https://evil.example/x.js';
    document.head.appendChild(s);
  });
  // eval can't be probed: Chromium driven over CDP lets eval through whatever the policy says
  // (verified: a data: script is blocked, eval is not). Assert the policy text instead.
  const shopCsp = (await context.request.get(`${SITE}/uz`).catch(() => null))?.headers()[
    'content-security-policy'
  ];
  const policy =
    shopCsp ??
    (await probe.evaluate(async () => (await fetch('/uz')).headers.get('content-security-policy')));
  if (!policy || /unsafe-eval/.test(policy))
    findings.push(`/uz policy allows eval or is missing: ${policy}`);
  report.push({
    page: "/uz policy has no 'unsafe-eval'",
    blocked: !/unsafe-eval/.test(policy ?? 'unsafe-eval'),
  });
  await expectBlocked(probe, 'telegram iframe outside login', () => {
    const f = document.createElement('iframe');
    f.src = 'https://oauth.telegram.org/embed/forest_uz_bot';
    document.body.appendChild(f);
  });
  await probe.close();
  const login = await visit(context, `${SITE}/uz/kirish`, 'probe /uz/kirish');
  await expectAllowed(login, 'telegram widget script on /uz/kirish', () => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    document.head.appendChild(s);
  });
  await expectAllowed(login, 'telegram iframe on /uz/kirish', () => {
    const f = document.createElement('iframe');
    f.src = 'https://oauth.telegram.org/embed/forest_uz_bot';
    document.body.appendChild(f);
  });
  await login.close();
  await context.close();
}

async function admin(browser) {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  const context = await browser.newContext({ ignoreHTTPSErrors: Boolean(process.env.INSECURE) });
  const loginPage = await visit(context, `${ADMIN}/login`, 'admin /login', {
    expectHeaders: ADMIN_HEADERS,
  });
  await loginPage.close();
  if (!email || !password) {
    report.push({
      page: 'admin',
      note: 'OWNER_EMAIL/OWNER_PASSWORD not set — logged-in pages skipped',
    });
    return context.close();
  }
  // Auth calls from inside an admin page (same origin, cookies in the browser context).
  const page = await context.newPage();
  await page.goto(`${ADMIN}/login`);
  const call = (path, body) =>
    page.evaluate(
      async ({ path, body }) => {
        const { token } = await fetch('/api/admin/auth/csrf').then((r) => r.json());
        const r = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: JSON.stringify(body ?? {}),
        });
        return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
      },
      { path, body },
    );
  const login = await call('/api/admin/auth/login', { email, password });
  if (!login.ok)
    throw new Error(`admin login failed: ${login.status} ${JSON.stringify(login.json)}`);
  let secret = process.env.OWNER_TOTP_SECRET;
  if (!secret) {
    const setup = await call('/api/admin/auth/totp/setup');
    if (!setup.ok)
      throw new Error(`totp setup failed: ${setup.status} ${JSON.stringify(setup.json)}`);
    secret = setup.json.secret;
    console.log(`(owner enrolled; OWNER_TOTP_SECRET for the next run: ${secret})`);
  }
  let verified = false;
  for (const offset of [0, 1]) {
    const r = await call('/api/admin/auth/totp/verify', { code: totp(secret, offset) });
    if (r.ok) {
      verified = true;
      break;
    }
  }
  if (!verified) throw new Error('totp verify failed');
  await page.close();
  for (const path of [
    '/',
    '/orders',
    '/customers',
    '/products',
    '/reviews',
    '/analytics',
    '/heatmaps',
    '/audiences',
    '/seo',
    '/integrations',
    '/moysklad',
    '/promo',
    '/content',
    '/bot',
    '/bot/inbox',
    '/orders/new',
    '/settings/store',
    '/settings/delivery',
    '/settings/staff',
    '/settings/audit',
  ]) {
    const p = await visit(context, `${ADMIN}${path}`, `admin ${path}`);
    await p.close();
  }
  const probe = await visit(context, `${ADMIN}/`, 'admin probe');
  await expectBlocked(probe, 'foreign image on admin', () => {
    const i = new Image();
    i.src = 'https://evil.example/pixel.gif';
    document.body.appendChild(i);
  });
  await probe.close();
  await context.close();
}

const browser = await chromium.launch();
try {
  await shop(browser);
  await admin(browser);
} catch (e) {
  findings.push(`run failed: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
}
console.table(report);
if (findings.length) {
  console.error(`\n${findings.length} finding(s):`);
  for (const f of findings) console.error(`  ✖ ${f}`);
  process.exit(1);
}
console.log('\nCSP check passed: no violations, headers present, blocks enforced.');
