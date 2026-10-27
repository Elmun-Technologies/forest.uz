import type { ArticleCardDto } from '@forest/contracts';
import { cn } from '@forest/ui';
import { Play } from 'lucide-react';
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';

/** Ilhom grid card (design "Video darslar" tile; articles without video have no play badge). */
export async function ArticleCard({ a, className }: { a: ArticleCardDto; className?: string }) {
  const t = await getTranslations('ilhom');
  const meta = [
    a.category ? t(`cat_${a.category}`) : null,
    a.hasVideo && a.videoMinutes
      ? t('videoTime', { minutes: a.videoMinutes })
      : a.readingMinutes
        ? t('readingTime', { minutes: a.readingMinutes })
        : null,
  ].filter(Boolean);
  return (
    <Link
      href={`${routes.inspiration}/${a.slug}`}
      className={cn(
        'flex h-full flex-col gap-3 rounded-[24px] bg-panel p-2 pb-4 transition-shadow hover:shadow-float lg:rounded-[28px] lg:p-2.5 lg:pb-5',
        className,
      )}
      data-testid="article-card"
    >
      <span className="relative block aspect-[16/10] overflow-hidden rounded-[18px] bg-off lg:rounded-[22px]">
        {a.cover ? (
          <Image
            src={a.cover.url}
            alt={a.cover.alt}
            fill
            sizes="(min-width: 1280px) 330px, (min-width: 768px) 33vw, 100vw"
            className="object-cover"
          />
        ) : null}
        {a.hasVideo ? (
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-pill bg-white text-ink"
          >
            <Play size={18} fill="currentColor" />
          </span>
        ) : null}
      </span>
      <span className="flex flex-col gap-1.5 px-2.5">
        {meta.length ? (
          <span className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
            {meta.join(' · ')}
          </span>
        ) : null}
        <span className="text-[15px] leading-snug font-semibold">{a.title}</span>
        {a.excerpt ? (
          <span className="line-clamp-2 text-[13px] text-muted">{a.excerpt}</span>
        ) : null}
      </span>
    </Link>
  );
}
