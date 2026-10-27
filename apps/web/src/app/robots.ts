import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo';

/** Personal and transactional pages stay out of the index (they are also `noindex`). */
const PRIVATE = [
  '/savat',
  '/checkout',
  '/kabinet',
  '/buyurtma',
  '/kirish',
  '/fake-pay',
  '/qidiruv',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/t/', ...PRIVATE.flatMap((p) => [`/uz${p}`, `/ru${p}`])],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
