'use client';

import type { AdminReviewDto, AdminReviewPageDto, ReviewStatus } from '@forest/contracts/core';
import { Badge, Button, cn, Panel, Textarea } from '@forest/ui';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '../auth-card';
import { adminFetch, errorText } from '../../lib/client-api';
import { formatWhen } from '../../lib/format';
import { COPY, REVIEW_STATUS_LABEL, SOURCE_LABEL } from './copy';

/** A15 review cards with moderation actions; "Yana yuklash" follows the cursor. */
export function ReviewList({
  initial,
  query,
  status,
  canModerate,
  canSeeOrders,
}: {
  initial: AdminReviewPageDto;
  query: string;
  status: ReviewStatus;
  canModerate: boolean;
  canSeeOrders: boolean;
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const next = await adminFetch<AdminReviewPageDto>(`/admin/reviews?${query}&cursor=${cursor}`);
      setItems((x) => [...x, ...next.items]);
      setCursor(next.nextCursor);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0)
    return (
      <Panel className="flex flex-col gap-1 p-8 text-center text-sm">
        <b className="font-semibold">{COPY.empty}</b>
        {status === 'PENDING' ? <span className="text-muted">{COPY.emptyPending}</span> : null}
      </Panel>
    );

  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      {items.map((r) => (
        <ReviewCard
          key={r.id}
          review={r}
          canModerate={canModerate}
          canSeeOrders={canSeeOrders}
          onChange={(next) => setItems((x) => x.map((i) => (i.id === next.id ? next : i)))}
        />
      ))}
      {cursor ? (
        <Button
          variant="outline"
          className="self-center"
          loading={loading}
          onClick={() => void more()}
        >
          {COPY.more}
        </Button>
      ) : null}
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span
      className={cn('tracking-[0.1em]', rating <= 3 ? 'text-critical' : 'text-ink')}
      aria-label={`${rating} / 5`}
    >
      {'★'.repeat(rating)}
      <span className="text-line">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

function ReviewCard({
  review: r,
  canModerate,
  canSeeOrders,
  onChange,
}: {
  review: AdminReviewDto;
  canModerate: boolean;
  canSeeOrders: boolean;
  onChange: (r: AdminReviewDto) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState(r.reply ?? '');
  const galleryOk = r.status === 'APPROVED' && r.photoConsent && r.photos.length > 0;

  async function act(key: string, path: string, body: object) {
    setBusy(key);
    setError(null);
    try {
      onChange(
        await adminFetch<AdminReviewDto>(`/admin/reviews/${r.id}/${path}`, {
          method: 'PATCH',
          body,
        }),
      );
      router.refresh();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const cover = r.photos[0];
  return (
    <Panel
      as="article"
      className={cn('flex flex-col gap-4 p-5 sm:flex-row', r.status === 'REJECTED' && 'opacity-70')}
      data-testid="review-card"
    >
      {cover ? (
        <a href={cover.url} target="_blank" rel="noreferrer" className="shrink-0">
          <Image
            src={cover.url}
            alt={`${r.author}: foto`}
            width={150}
            height={150}
            unoptimized
            className="size-[150px] rounded-md object-cover"
          />
          {r.photos.length > 1 ? (
            <span className="mt-1 block text-center text-xs text-muted">
              +{r.photos.length - 1} foto
            </span>
          ) : null}
        </a>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <b className="text-base font-semibold">{r.author}</b>
          <Stars rating={r.rating} />
          <span className="text-xs text-muted">
            {formatWhen(r.createdAt)} · {SOURCE_LABEL[r.source] ?? r.source}
          </span>
          {r.status !== 'PENDING' ? (
            <Badge tone={r.status === 'APPROVED' ? 'good' : 'critical'}>
              {REVIEW_STATUS_LABEL[r.status]}
            </Badge>
          ) : null}
        </div>
        <span className="text-muted">
          {r.product.name.uz}
          {r.variantLabel ? ` · ${r.variantLabel.uz}` : ''}
        </span>
        {r.text ? <p className="text-sm leading-relaxed">{r.text}</p> : null}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge tone="good" className="h-auto py-1 text-[11px]">
            ✓ {COPY.verified} ·{' '}
            {canSeeOrders ? (
              <Link href={`/orders/${r.order.number}`} prefetch={false} className="ml-1 underline">
                #{r.order.number}
              </Link>
            ) : (
              <span className="ml-1">#{r.order.number}</span>
            )}
          </Badge>
          {r.photos.length > 0 ? (
            <Badge tone={r.photoConsent ? 'neutral' : 'warn'} className="h-auto py-1 text-[11px]">
              {r.photoConsent ? COPY.consentYes : COPY.consentNo}
            </Badge>
          ) : null}
          {r.moderatedBy ? <span className="text-xs text-muted">· {r.moderatedBy}</span> : null}
        </div>
        {r.reply && !replying ? (
          <div className="mt-1 rounded-sm bg-off px-3 py-2">
            <span className="text-xs font-semibold text-muted">Do&apos;kon javobi</span>
            <p className="text-sm">{r.reply}</p>
          </div>
        ) : null}
        {replying ? (
          <form
            className="mt-1 flex flex-col gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act('reply', 'reply', { reply })) setReplying(false);
            }}
          >
            <label htmlFor={`reply-${r.id}`} className="text-xs font-semibold">
              {COPY.replyLabel}
            </label>
            <Textarea
              id={`reply-${r.id}`}
              rows={3}
              maxLength={1000}
              className="min-h-20 text-sm"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <span className="flex gap-2">
              <Button size="sm" type="submit" loading={busy === 'reply'}>
                {COPY.saveReply}
              </Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setReplying(false)}>
                Bekor qilish
              </Button>
            </span>
          </form>
        ) : null}
        <FormError message={error} />
      </div>
      {canModerate ? (
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-[220px]">
          {r.status !== 'APPROVED' ? (
            <Button
              block
              loading={busy === 'approve'}
              onClick={() => void act('approve', 'status', { status: 'APPROVED' })}
              data-testid="review-approve"
            >
              {COPY.approve}
            </Button>
          ) : null}
          {r.photos.length === 0 || !r.photoConsent ? (
            <Button block variant="outline" disabled>
              {COPY.noConsent}
            </Button>
          ) : (
            <Button
              block
              variant="outline"
              className={r.inGallery ? 'border-sage bg-[#F1F3EC]' : undefined}
              disabled={!galleryOk && !r.inGallery}
              title={!galleryOk && !r.inGallery ? COPY.galleryNeedsApproval : undefined}
              loading={busy === 'gallery'}
              onClick={() => void act('gallery', 'gallery', { inGallery: !r.inGallery })}
              data-testid="review-gallery"
            >
              {r.inGallery ? COPY.inGallery : COPY.toGallery}
            </Button>
          )}
          {r.status !== 'REJECTED' ? (
            <Button
              block
              variant="danger"
              loading={busy === 'reject'}
              onClick={() => {
                if (window.confirm(COPY.rejectConfirm))
                  void act('reject', 'status', { status: 'REJECTED' });
              }}
            >
              {COPY.reject}
            </Button>
          ) : null}
          <button
            type="button"
            className="text-[13px] font-semibold text-telegram underline-offset-2 hover:underline"
            onClick={() => setReplying((v) => !v)}
          >
            {r.reply ? COPY.editReply : COPY.reply}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}
