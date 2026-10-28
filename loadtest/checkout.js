// Checkout load (docs/12 Phase 6: 20 checkouts per second). One iteration = one buyer:
// add to cart → cart → quote → place order (COD or Payme) → fake payment (online) → order page.
// Fake providers only (PROVIDERS_MODE=fake): never point this at a live payment setup.
//
// Client IPs: checkout allows 10 orders/min per IP (CHECKOUT_POLICY), so a load test from one
// machine must reach the API without Caddy and give each buyer its own X-Forwarded-For (README).
//
//   k6 run -e API=http://api:4000/v1 -e RATE=20 -e DURATION=5m loadtest/checkout.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import {
  API,
  devHeaders,
  fakeClientIp,
  fakePhone,
  hostsOption,
  idempotencyKey,
  pick,
  think,
} from './lib.js';

const RATE = Number(__ENV.RATE || 20);
const ordersPlaced = new Counter('orders_placed');
const checkoutErrors = new Counter('checkout_errors');
const placeDuration = new Trend('checkout_place_duration', true);

export const options = {
  hosts: hostsOption(),
  insecureSkipTLSVerify: __ENV.INSECURE === '1',
  scenarios: {
    checkout: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: Number(__ENV.VUS || RATE * 10),
      maxVUs: Number(__ENV.MAX_VUS || RATE * 40),
      stages: [
        { target: RATE, duration: __ENV.RAMP || '1m' },
        { target: RATE, duration: __ENV.DURATION || '5m' },
        { target: 0, duration: '20s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checkout_place_duration: ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{name:cart add}': ['p(95)<500'],
    'http_req_duration{name:quote}': ['p(95)<500'],
    checkout_errors: ['count<10'],
  },
};

export function setup() {
  const p = http.get(`${API}/catalog/products`).json('items');
  const variants = p.filter((x) => x.inStock && x.defaultVariantId).map((x) => x.defaultVariantId);
  const settings = http.get(`${API}/settings/public`).json();
  const zones = settings.delivery.zones.map((z) => z.key);
  if (!variants.length || !zones.length) throw new Error('no stock or no delivery zones');
  return { variants, zones, offerVersion: settings.store.offerVersion };
}

/**
 * The API marks its cookies Secure (NODE_ENV=production) and this test talks plain HTTP inside
 * the server network, where k6's jar would drop them: carry them by hand instead.
 */
function keepCookies(jar, res) {
  for (const [name, list] of Object.entries(res.cookies || {}))
    if (list.length) jar[name] = list[0].value;
  return jar;
}

export default function (data) {
  // A fresh buyer: no cookies from the previous iteration, own IP and phone.
  const jar = {};
  const headers = {
    'Content-Type': 'application/json',
    'X-Forwarded-For': fakeClientIp(),
    'Accept-Language': 'uz',
  };
  const add = http.post(
    `${API}/cart/items`,
    JSON.stringify({ variantId: pick(data.variants), qty: 1 + Math.floor(Math.random() * 2) }),
    { headers, tags: { name: 'cart add' } },
  );
  keepCookies(jar, add);
  if (!check(add, { 'cart add 200/201': (r) => r.status === 200 || r.status === 201 })) {
    checkoutErrors.add(1, { step: 'cart', code: add.json('error.code') || String(add.status) });
    return;
  }
  think(5, 20);
  // 70 % Tashkent city (Yandex/BTS zones), 30 % regions; the zone must cover the region.
  const city = Math.random() < 0.7;
  const region = city ? 'tashkent_city' : pick(['samarkand', 'fergana', 'andijan', 'bukhara']);
  const zone = city ? pick(data.zones.filter((z) => z.startsWith('tashkent'))) : 'regions-bts';
  const quote = http.get(`${API}/cart/quote?region=${region}`, {
    headers,
    cookies: jar,
    tags: { name: 'quote' },
  });
  check(quote, { 'quote 200': (r) => r.status === 200 });
  const cart = http.get(`${API}/cart?zone=${zone}`, {
    headers,
    cookies: jar,
    tags: { name: 'cart' },
  });
  check(cart, { 'cart 200': (r) => r.status === 200 });
  think(20, 60); // filling in the checkout form
  const method = Math.random() < 0.5 ? 'COD' : pick(['PAYME', 'CLICK']);
  const place = http.post(
    `${API}/checkout/orders`,
    JSON.stringify({
      name: 'Yuklama Test',
      phone: fakePhone(),
      region,
      district: null,
      addressLine: 'k6 test, 1-uy',
      zoneKey: zone,
      paymentMethod: method,
      offerVersion: data.offerVersion,
      comment: 'k6 load test',
    }),
    {
      headers: { ...headers, 'Idempotency-Key': idempotencyKey() },
      cookies: jar,
      tags: { name: 'place order' },
    },
  );
  keepCookies(jar, place);
  placeDuration.add(place.timings.duration, { method });
  if (!check(place, { 'order placed': (r) => r.status === 200 || r.status === 201 })) {
    if (__ENV.DEBUG) console.warn(`place ${place.status}: ${String(place.body).slice(0, 300)}`);
    checkoutErrors.add(1, {
      step: 'place',
      code: place.json('error.code') || String(place.status),
    });
    return;
  }
  ordersPlaced.add(1, { method });
  const publicId = place.json('publicId');
  if (method !== 'COD') {
    think(10, 30); // paying on the provider's page
    const pay = http.post(
      `${API}/dev/fake-pay`,
      JSON.stringify({ order: publicId, result: 'success' }),
      { headers: { ...headers, ...devHeaders() }, cookies: jar, tags: { name: 'fake pay' } },
    );
    check(pay, { 'fake pay ok': (r) => r.status === 200 || r.status === 201 });
  }
  const order = http.get(`${API}/orders/${publicId}`, {
    headers,
    cookies: jar,
    tags: { name: 'order page' },
  });
  check(order, { 'order page 200': (r) => r.status === 200 });
}
