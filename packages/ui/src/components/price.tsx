import { formatAmount, soumToTiyin } from '@forest/contracts/core';
import { cn } from '../cn';

export interface PriceProps {
  soum: number;
  compareAtSoum?: number | null;
  /** "dan 189 000 so'm" for products with several variants. */
  from?: boolean;
  locale: 'uz' | 'ru';
  withCurrency?: boolean;
  /** Classes for the currency word, e.g. to drop it where the amount alone must fit. */
  currencyClassName?: string;
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
  currencyClassName,
  className,
}: PriceProps) {
  const amount = formatAmount(soumToTiyin(soum));
  return (
    <span className={cn('tabular inline-flex flex-wrap items-baseline gap-x-2', className)}>
      <span>
        {from ? (locale === 'ru' ? 'от\u00A0' : 'dan\u00A0') : null}
        {amount}
        {!withCurrency ? null : currencyClassName ? (
          <span className={currencyClassName}>{`\u00A0${CURRENCY[locale]}`}</span>
        ) : (
          `\u00A0${CURRENCY[locale]}`
        )}
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
