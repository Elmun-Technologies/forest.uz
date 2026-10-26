'use client';

import type { ImageDto } from '@forest/contracts';
import { cn } from '@forest/ui';
import { Play } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

/** YouTube links → privacy-friendly embed; direct files → <video>. */
function videoEmbed(url: string): { kind: 'iframe' | 'file'; src: string } {
  const yt = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
  if (yt)
    return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1` };
  return { kind: 'file', src: url };
}

function Video({ url, title }: { url: string; title: string }) {
  const v = videoEmbed(url);
  return v.kind === 'iframe' ? (
    <iframe
      src={v.src}
      title={title}
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      className="absolute inset-0 size-full"
    />
  ) : (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- product how-to videos have no speech track yet
    <video
      src={v.src}
      controls
      autoPlay
      playsInline
      className="absolute inset-0 size-full bg-ink object-contain"
    />
  );
}

/**
 * Product gallery. Desktop: thumbnail column (+ video tile) and a large main image.
 * Mobile: swipeable scroll-snap strip with dots and a "Video" chip.
 */
export function ProductGallery({
  images,
  videoUrl,
  badge,
  name,
}: {
  images: ImageDto[];
  videoUrl: string | null;
  badge: string | null;
  name: string;
}) {
  const t = useTranslations('product');
  const [active, setActive] = useState(0);
  const [video, setVideo] = useState(false);
  const strip = useRef<HTMLUListElement>(null);
  const main = images[active] ?? images[0];

  function goTo(i: number) {
    setVideo(false);
    setActive(i);
    const el = strip.current;
    if (el) el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' });
  }

  return (
    <div
      className="min-w-0 lg:flex lg:flex-[1_1_600px] lg:gap-3"
      aria-label={t('gallery')}
      role="group"
    >
      {/* Desktop thumbnails */}
      <ul className="hidden shrink-0 flex-col gap-3 lg:flex">
        {images.map((img, i) => (
          <li key={img.url}>
            <button
              type="button"
              onClick={() => goTo(i)}
              aria-pressed={!video && i === active}
              aria-label={t('image', { n: i + 1 })}
              className={cn(
                'relative block size-[88px] overflow-hidden rounded-[20px]',
                !video && i === active && 'outline-2 -outline-offset-2 outline-ink',
              )}
            >
              <Image src={img.url} alt="" fill sizes="88px" className="object-cover" />
              {!video && i === active ? (
                <span aria-hidden className="absolute inset-0 rounded-[20px] border-2 border-ink" />
              ) : null}
            </button>
          </li>
        ))}
        {videoUrl ? (
          <li>
            <button
              type="button"
              onClick={() => setVideo(true)}
              aria-pressed={video}
              aria-label={t('video')}
              data-track="video_play"
              className="grid size-[88px] place-items-center rounded-[20px] bg-ink text-white"
            >
              <Play size={22} fill="currentColor" aria-hidden />
            </button>
          </li>
        ) : null}
      </ul>

      {/* Desktop main image */}
      <div className="relative hidden min-h-[720px] flex-1 overflow-hidden rounded-xl bg-[#E3E6DD] lg:block">
        {video && videoUrl ? (
          <Video url={videoUrl} title={name} />
        ) : main ? (
          <Image
            src={main.url}
            alt={main.alt || name}
            fill
            priority={active === 0}
            sizes="(min-width: 1440px) 660px, (min-width: 1024px) 50vw, 1px"
            className="object-cover"
          />
        ) : null}
        {badge && !video ? (
          <span className="absolute top-6 left-6 rounded-pill bg-white px-4 py-2 text-[13px] font-semibold">
            {badge}
          </span>
        ) : null}
      </div>

      {/* Mobile strip */}
      <div className="relative h-[420px] overflow-hidden rounded-lg bg-[#E3E6DD] lg:hidden">
        {video && videoUrl ? (
          <Video url={videoUrl} title={name} />
        ) : (
          <ul
            ref={strip}
            onScroll={(e) => {
              const el = e.currentTarget;
              setActive(Math.round(el.scrollLeft / el.clientWidth));
            }}
            className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
          >
            {images.map((img, i) => (
              <li key={img.url} className="relative h-full w-full shrink-0 snap-center">
                <Image
                  src={img.url}
                  alt={img.alt || name}
                  fill
                  priority={i === 0}
                  sizes="(min-width: 1024px) 1px, 100vw"
                  className="object-cover"
                />
              </li>
            ))}
          </ul>
        )}
        {badge && !video ? (
          <span className="absolute top-3.5 left-3.5 rounded-pill bg-white px-3 py-1.5 text-xs font-semibold">
            {badge}
          </span>
        ) : null}
        {images.length > 1 && !video ? (
          <span className="absolute bottom-3.5 left-1/2 flex -translate-x-1/2 gap-1.5">
            {images.map((img, i) => (
              <button
                key={img.url}
                type="button"
                onClick={() => goTo(i)}
                aria-label={t('image', { n: i + 1 })}
                aria-current={i === active || undefined}
                className={cn(
                  'h-2 rounded-[4px] transition-all',
                  i === active ? 'w-[22px] bg-white' : 'w-2 bg-white/55',
                )}
              />
            ))}
          </span>
        ) : null}
        {videoUrl ? (
          <button
            type="button"
            onClick={() => setVideo((v) => !v)}
            aria-pressed={video}
            data-track="video_play"
            className="absolute right-3.5 bottom-3.5 inline-flex items-center gap-1.5 rounded-pill bg-ink/75 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Play size={12} fill="currentColor" aria-hidden />
            {t('video')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
