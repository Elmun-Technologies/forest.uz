import type { ProductReviewDto } from '@forest/contracts';
import { formatTashkentDate } from '@forest/contracts/core';
import { Rating } from '@forest/ui';
import Image from 'next/image';

/** One approved, verified review (design: Mahsulot "Sharhlar"). Works in server and client trees. */
export function ReviewCard({
  review: r,
  labels,
}: {
  review: ProductReviewDto;
  labels: { verified: string; reply: string; rating: string; photo: string };
}) {
  return (
    <article className="flex flex-col gap-4 rounded-[18px] bg-canvas p-3.5 lg:rounded-[28px] lg:p-7">
      <header className="flex items-center justify-between gap-3 text-[13px] lg:text-sm">
        <b>{r.author}</b>
        <span className="text-muted">{formatTashkentDate(new Date(r.createdAt))}</span>
      </header>
      <span className="flex items-center gap-2">
        <Rating value={r.rating} label={labels.rating} />
        <span className="text-xs font-semibold text-forest">{labels.verified}</span>
      </span>
      {r.text ? <p className="text-sm leading-relaxed lg:text-[15px]">{r.text}</p> : null}
      {r.photos.length ? (
        <ul className="flex gap-2">
          {r.photos.slice(0, 4).map((p) => (
            <li
              key={p.url}
              className="relative size-14 overflow-hidden rounded-xs lg:size-16 lg:rounded-[16px]"
            >
              <Image
                src={p.url}
                alt={p.alt || labels.photo}
                fill
                sizes="64px"
                className="object-cover"
              />
            </li>
          ))}
        </ul>
      ) : null}
      {r.reply ? (
        <p className="rounded-sm bg-panel px-4 py-3 text-[13px] text-ink-2">
          <b className="block text-ink">{labels.reply}</b>
          {r.reply}
        </p>
      ) : null}
    </article>
  );
}
