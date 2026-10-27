import type { ImageDto } from '@forest/contracts';
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { HomeLeadForm } from './home-lead-form';

/** "−10% va bepul rang maslahati" lead capture (source `home`). */
export async function LeadSection({
  image,
  telegramUrl,
}: {
  image: ImageDto | null;
  telegramUrl: string | null;
}) {
  const t = await getTranslations('home.lead');
  return (
    <section
      aria-labelledby="lead-title"
      className="flex flex-col gap-4 lg:my-8 lg:mb-12 lg:flex-row lg:flex-wrap"
    >
      <div className="flex min-w-0 flex-col justify-between gap-3.5 rounded-[28px] bg-sage p-[22px] lg:min-h-[400px] lg:flex-[2_1_600px] lg:gap-7 lg:rounded-xl lg:p-12">
        <div className="flex flex-col gap-3.5">
          <span className="self-start rounded-pill bg-ink px-3 py-1.5 text-xs font-semibold text-white lg:px-3.5 lg:py-2 lg:text-[13px]">
            {t('badge')}
          </span>
          <h2
            id="lead-title"
            className="text-[32px] leading-[1.02] font-medium tracking-[-0.04em] lg:text-[64px] lg:leading-none lg:tracking-[-0.05em]"
          >
            {t('title')}
          </h2>
          <p className="hidden max-w-[520px] text-base leading-relaxed lg:block">{t('text')}</p>
        </div>
        <HomeLeadForm telegramUrl={telegramUrl} />
      </div>
      {image ? (
        <div className="relative hidden min-h-[400px] min-w-0 flex-[1_1_380px] overflow-hidden rounded-xl lg:block">
          <Image src={image.url} alt={image.alt} fill sizes="512px" className="object-cover" />
        </div>
      ) : null}
    </section>
  );
}
