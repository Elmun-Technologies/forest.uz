import { formatAmount, soumToTiyin } from '@forest/contracts';
import { cn } from '../cn';

export interface PriceProps {
  soum: number;
  compareAtSoum?: number | null;
  /** "dan 189 000 so'm" for products with several variants. */
  from?: boolean;
  locale: 'uz' | 'ru';
  withCurrency?: boolean;
  className?: string;
}

const CURRENCY = { uz: "so'm", ru: 'сум' } as const;

/** Money is always formatted by the shared helper (non-breaking thousand separators). */
export function Price({
  soum,
  compareAtSoum,
  from,
  locale,
  withCurrency = true,
  className,
}: PriceProps) {
  const amount = formatAmount(soumToTiyin(soum));
  return (
    <span className={cn('tabular inline-flex flex-wrap items-baseline gap-x-2', className)}>
      <span>
        {from ? (locale === 'ru' ? 'от\u00A0' : 'dan\u00A0') : null}
        {amount}
        {withCurrency ? `\u00A0${CURRENCY[locale]}` : null}
      </span>
      {compareAtSoum ? (
        <s
          className="text-xs font-medium text-subtle"
          aria-label={locale === 'ru' ? 'старая цена' : 'eski narx'}
        >
          {formatAmount(soumToTiyin(compareAtSoum))}
        </s>
      ) : null}
    </span>
  );
}
