'use client';

import type { ProductReviewDto } from '@forest/contracts';
import { Button } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { clientApi } from '@/lib/client-api';
import { ReviewCard } from './review-card';

/** "Yana sharhlar": appends the next pages of reviews client-side (page 1 is server-rendered). */
export function MoreReviews({ slug, pageCount }: { slug: string; pageCount: number }) {
  const t = useTranslations('product');
  const [items, setItems] = useState<ProductReviewDto[]>([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  async function more() {
    setBusy(true);
    try {
      const next = await clientApi.catalog.reviews(slug, page + 1);
      setItems((x) => [...x, ...next.items]);
      setPage(next.page);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {items.map((r) => (
        <ReviewCard
          key={r.id}
          review={r}
          labels={{
            verified: t('reviews.verified'),
            reply: t('reviews.reply'),
            rating: t('ratingLabel', { value: String(r.rating) }),
            photo: t('reviews.photo', { author: r.author }),
          }}
        />
      ))}
      {page < pageCount ? (
        <div className="col-span-full flex justify-center">
          <Button variant="outline" loading={busy} onClick={() => void more()}>
            {t('reviews.more')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
