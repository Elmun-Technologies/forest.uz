import {
  type AdminGalleryItemDto,
  type AdminReviewPageDto,
  type AdminReviewsSummaryDto,
  hasPermission,
  REVIEW_STATUSES,
  type ReviewStatus,
} from '@forest/contracts/core';
import { cn, KpiTile } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NoAccess, PageHeader } from '../../../components/page';
import { COPY, REVIEW_STATUS_LABEL, SOURCE_LABEL } from '../../../components/reviews/copy';
import { GalleryManager } from '../../../components/reviews/gallery-manager';
import { ReviewList } from '../../../components/reviews/review-list';
import { adminGet, requireFullSession } from '../../../lib/api';

export const metadata: Metadata = { title: 'Sharhlar va fotolar · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;
const pick = (sp: Search, key: string, max = 64) => {
  const v = sp[key];
  return typeof v === 'string' ? v.slice(0, max) : '';
};

/** A15: KPIs, state tabs + filters in the URL, review cards, the "Natijalar" gallery manager. */
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'reviews.view')) {
    return (
      <>
        <PageHeader title={COPY.title} />
        <NoAccess />
      </>
    );
  }
  const canModerate = hasPermission(me.staff.role, 'reviews.moderate');
  const canSeeOrders = hasPermission(me.staff.role, 'orders.view');
  const sp = await searchParams;
  const status = (
    (REVIEW_STATUSES as readonly string[]).includes(pick(sp, 'status'))
      ? pick(sp, 'status')
      : 'PENDING'
  ) as ReviewStatus;
  const filters = {
    status,
    low: pick(sp, 'low') === '1' ? '1' : '',
    photos: pick(sp, 'photos') === '1' ? '1' : '',
    source: ['web', 'bot'].includes(pick(sp, 'source')) ? pick(sp, 'source') : '',
  };
  const query = new URLSearchParams({ limit: '20' });
  for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);

  const [summary, page, gallery] = await Promise.all([
    adminGet<AdminReviewsSummaryDto>('/admin/reviews/summary'),
    adminGet<AdminReviewPageDto>(`/admin/reviews?${query.toString()}`),
    adminGet<AdminGalleryItemDto[]>('/admin/reviews/gallery'),
  ]);

  const href = (patch: Partial<typeof filters>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...patch })) if (v) q.set(k, v);
    return `/reviews?${q.toString()}`;
  };
  const chip = (on: boolean) =>
    cn(
      'inline-flex h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] font-semibold transition-colors',
      on ? 'bg-ink text-white' : 'bg-panel hover:bg-sage-50',
    );

  return (
    <>
      <PageHeader title={COPY.title} subtitle={COPY.subtitle} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile
          label={COPY.kpiAvg}
          value={
            summary.avgRating === null
              ? COPY.none
              : `${summary.avgRating.toFixed(1).replace('.', ',')} ★`
          }
        />
        <KpiTile label={COPY.kpiApproved} value={summary.approved} />
        <KpiTile
          label={COPY.kpiPhoto}
          value={summary.withPhotoPct === null ? COPY.none : `${summary.withPhotoPct}%`}
        />
        <KpiTile
          label={COPY.kpiLow}
          value={summary.openLowRated}
          tone={summary.openLowRated > 0 ? 'critical' : 'panel'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Sharh holati" className="flex flex-wrap gap-2">
          {REVIEW_STATUSES.map((s) => (
            <Link
              key={s}
              href={href({ status: s })}
              prefetch={false}
              aria-current={status === s ? 'page' : undefined}
              className={chip(status === s)}
              data-testid={`reviews-tab-${s}`}
            >
              {REVIEW_STATUS_LABEL[s]}
              <span className={status === s ? 'text-on-dark-muted' : 'text-muted'}>
                {summary.counts[s]}
              </span>
            </Link>
          ))}
        </nav>
        <span aria-hidden className="mx-1 h-6 w-px bg-line" />
        <Link
          href={href({ low: filters.low ? '' : '1' })}
          prefetch={false}
          aria-pressed={!!filters.low}
          className={chip(!!filters.low)}
        >
          {COPY.lowOnly}
        </Link>
        <Link
          href={href({ photos: filters.photos ? '' : '1' })}
          prefetch={false}
          aria-pressed={!!filters.photos}
          className={chip(!!filters.photos)}
        >
          {COPY.photosOnly}
        </Link>
        {(['', 'web', 'bot'] as const).map((s) => (
          <Link
            key={s || 'all'}
            href={href({ source: s })}
            prefetch={false}
            aria-pressed={filters.source === s}
            className={chip(filters.source === s)}
          >
            {s ? SOURCE_LABEL[s] : COPY.allSources}
          </Link>
        ))}
      </div>

      {!canModerate ? <p className="px-1 text-[13px] text-muted">{COPY.readOnly}</p> : null}
      <ReviewList
        key={query.toString()}
        initial={page}
        query={query.toString()}
        status={status}
        canModerate={canModerate}
        canSeeOrders={canSeeOrders}
      />
      <GalleryManager initial={gallery} canModerate={canModerate} />
    </>
  );
}
