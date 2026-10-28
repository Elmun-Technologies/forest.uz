// Catalog browse load (docs/12 Phase 6: 200 rps). Each iteration is one visitor journey of ~4
// page requests with think time: home or category → product(s) → search/cart, plus the JSON calls a
// browser makes through the storefront rewrite. Static assets (/_next/static, images) are not
// requested: browsers/CDN cache them; add them with ASSETS=1 for an origin-only test.
//
//   k6 run -e SITE=https://staging.forest.uz -e RATE=200 -e DURATION=10m loadtest/browse.js
import http from 'k6/http';
import { check, group } from 'k6';
import { Trend } from 'k6/metrics';
import { SITE, LOCALES, hostsOption, pick, think } from './lib.js';

const RATE = Number(__ENV.RATE || 200); // target page requests per second
const PAGES_PER_JOURNEY = 4;
const pageTtfb = new Trend('page_ttfb', true);

export const options = {
  hosts: hostsOption(),
  insecureSkipTLSVerify: __ENV.INSECURE === '1',
  discardResponseBodies: false,
  scenarios: {
    browse: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: Number(__ENV.VUS || Math.ceil(RATE * 2)),
      maxVUs: Number(__ENV.MAX_VUS || RATE * 8),
      stages: [
        { target: Math.max(1, Math.round(RATE / PAGES_PER_JOURNEY)), duration: __ENV.RAMP || '1m' },
        {
          target: Math.max(1, Math.round(RATE / PAGES_PER_JOURNEY)),
          duration: __ENV.DURATION || '5m',
        },
        { target: 0, duration: '20s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:page}': ['p(95)<800', 'p(99)<2000'],
    'http_req_duration{kind:api}': ['p(95)<300', 'p(99)<1000'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const res = http.get(`${SITE}/api/catalog/products`, { tags: { name: 'setup' } });
  const products = res.status === 200 ? res.json('items') : [];
  const cats = http.get(`${SITE}/api/catalog/categories`, { tags: { name: 'setup' } });
  const categories = cats.status === 200 ? cats.json().map((c) => c.slug) : [];
  if (!products.length)
    throw new Error(`no products from ${SITE}/api/catalog/products (${res.status})`);
  return { products: products.map((p) => p.slug), categories };
}

function page(url, name) {
  // Browsers ask for compression; without it the origin would ship ~300 KB per page.
  const r = http.get(url, {
    tags: { kind: 'page', name },
    headers: { Accept: 'text/html', 'Accept-Encoding': 'br, gzip, zstd' },
  });
  pageTtfb.add(r.timings.waiting, { name });
  check(r, { [`${name} 200`]: (x) => x.status === 200 });
  return r;
}

function api(path, name) {
  const r = http.get(`${SITE}/api${path}`, { tags: { kind: 'api', name } });
  check(r, { [`${name} 200`]: (x) => x.status === 200 });
  return r;
}

export default function (data) {
  const l = pick(LOCALES);
  group('landing', () => {
    if (Math.random() < 0.4) page(`${SITE}/${l}`, 'home');
    else if (data.categories.length)
      page(`${SITE}/${l}/katalog/${pick(data.categories)}`, 'category');
    else page(`${SITE}/${l}/katalog`, 'catalog');
    api('/settings/public', 'api settings');
  });
  think(2, 6);
  group('product', () => {
    const slug = pick(data.products);
    page(`${SITE}/${l}/p/${slug}`, 'product');
    api(`/catalog/products/${slug}/reviews`, 'api reviews');
  });
  think(3, 10);
  group('second look', () => {
    if (Math.random() < 0.5) page(`${SITE}/${l}/p/${pick(data.products)}`, 'product');
    else page(`${SITE}/${l}/katalog?page=1`, 'catalog');
  });
  think(2, 6);
  group('search or cart', () => {
    if (Math.random() < 0.6)
      page(`${SITE}/${l}/qidiruv?q=${pick(['boyoq', 'mebel', 'mato', 'lak', 'divan'])}`, 'search');
    else page(`${SITE}/${l}/savat`, 'cart');
  });
}
