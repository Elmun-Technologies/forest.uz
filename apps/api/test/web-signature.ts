import type request from 'supertest';
import {
  contextKey,
  signWeb,
  WEB_CONTEXTS,
  WEB_SIGNATURE_HEADER,
  webSharedSecret,
} from '../src/seo/web-signature';

/** Key the test app uses for a signed web ↔ API call (dev/test fallback from APP_ENCRYPTION_KEY). */
export function webKey(context: (typeof WEB_CONTEXTS)[keyof typeof WEB_CONTEXTS]): Buffer {
  const secret = webSharedSecret({
    NODE_ENV: 'test',
    APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY!,
    WEB_REVALIDATE_SECRET: process.env.WEB_REVALIDATE_SECRET,
  });
  return contextKey(secret!, context);
}

/** `POST /v1/seo/not-found` as the storefront server sends it (signed body). */
export function report404(http: ReturnType<typeof request>, body: object) {
  const raw = JSON.stringify(body);
  return http
    .post('/v1/seo/not-found')
    .set('Content-Type', 'application/json')
    .set(WEB_SIGNATURE_HEADER, signWeb(webKey(WEB_CONTEXTS.notFound), raw))
    .send(raw);
}
