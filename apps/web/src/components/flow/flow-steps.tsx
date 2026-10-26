import { cn } from '@forest/ui';
import { getTranslations } from 'next-intl/server';

/** "1 · Savat — 2 · Ma'lumotlar — 3 · To'lov" pills (design: Savat). */
export async function FlowSteps({ current }: { current: 1 | 2 | 3 }) {
  const t = await getTranslations('flow');
  const steps = [t('stepCart'), t('stepDetails'), t('stepPayment')];
  return (
    <ol aria-label={t('steps')} className="hidden items-center md:flex">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center">
          {i > 0 ? <span aria-hidden className="h-px w-8 bg-line" /> : null}
          <span
            aria-current={i + 1 === current ? 'step' : undefined}
            className={cn(
              'rounded-pill px-[18px] py-2.5 text-sm',
              i + 1 === current
                ? 'bg-ink font-semibold text-white'
                : 'border border-line text-muted',
            )}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}
