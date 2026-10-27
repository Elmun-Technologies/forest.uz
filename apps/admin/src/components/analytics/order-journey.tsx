'use client';

import {
  ATTRIBUTION_MODELS,
  type AttributionModel,
  DEFAULT_ATTRIBUTION_MODEL,
  type OrderJourneyDto,
} from '@forest/contracts/core';
import { cn } from '@forest/ui';
import Link from 'next/link';
import { useState } from 'react';
import { formatWhen } from '../../lib/format';
import { Meter } from './blocks';
import { channelLabel, MODEL_LABEL, PCT, replayHref, SOUM_FULL } from './copy';

const ORDER: AttributionModel[] = ['first_touch', 'linear', 'last_non_direct'];

/**
 * A7 "Buyurtma yo'li": the touches stored in `Order.attribution` with the revenue share each one
 * gets under the chosen model (default last non-direct, like the A2 reports).
 */
export function OrderJourney({ j }: { j: OrderJourneyDto }) {
  const [model, setModel] = useState<AttributionModel>(DEFAULT_ATTRIBUTION_MODEL);
  return (
    <div className="flex flex-col gap-3 text-[13px]" data-testid="order-journey">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Buyurtma yo&apos;li</h2>
        {j.state === 'attributed' ? (
          <div
            role="radiogroup"
            aria-label="Atributsiya modeli"
            className="flex gap-1 rounded-pill bg-canvas p-1"
          >
            {ORDER.filter((m) => ATTRIBUTION_MODELS.includes(m)).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={model === m}
                onClick={() => setModel(m)}
                className={cn(
                  'rounded-pill px-3 py-1.5 text-xs font-semibold',
                  model === m ? 'bg-ink text-white' : 'text-muted hover:text-ink',
                )}
              >
                {MODEL_LABEL[m]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {j.state === 'not_purchase' ? (
        <p className="text-muted">
          Atributsiya buyurtma xaridga aylanganda hisoblanadi (to&apos;lov yoki naqd buyurtma
          tasdiqlanganda).
        </p>
      ) : j.state === 'pending' ? (
        <p className="text-muted">Atributsiya hisoblanmoqda — bir daqiqadan keyin yangilang.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {j.touches.map((t, i) => (
            <li
              key={`${t.at}-${i}`}
              className="grid grid-cols-[minmax(0,1fr)_48px] items-center gap-x-3 gap-y-1"
            >
              <span className="min-w-0">
                <b className="font-semibold">{channelLabel(t.channel)}</b>
                <span className="text-muted"> · {formatWhen(t.at)}</span>
                <span className="block truncate text-xs text-muted">
                  {t.source} / {t.medium}
                  {t.campaign ? ` · ${t.campaign}` : ''}
                </span>
              </span>
              <b className="tabular text-right font-semibold" data-testid="touch-share">
                {PCT(t.shares[model], 0)}
              </b>
              <span className="col-span-2 flex items-center gap-2">
                <Meter value={t.shares[model]} max={1} label="Daromad ulushi" />
                <span className="tabular shrink-0 text-xs text-muted">
                  {SOUM_FULL(t.revenueSoum[model])} so&apos;m
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted">
        Daromad ulushi tanlangan model bo&apos;yicha kanallarga taqsimlanadi; Analitikadagi ROAS
        hisobi ham shu ulushlardan.
      </p>
      {j.purchaseSession?.hasReplay ? (
        <Link
          href={replayHref(j.purchaseSession.id)}
          prefetch={false}
          className="self-start rounded-pill border border-line px-4 py-2 text-xs font-semibold hover:border-ink"
        >
          ▶ Xarid sessiyasini ko&apos;rish
        </Link>
      ) : null}
    </div>
  );
}
