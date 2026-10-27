import type { CustomerJourneyDto, TouchDto } from '@forest/contracts/core';
import { Badge } from '@forest/ui';
import Link from 'next/link';
import { formatWhen } from '../../lib/format';
import { channelLabel, deviceLabel, DURATION, INT, replayHref, SOUM_FULL } from './copy';

const touchText = (t: Pick<TouchDto, 'source' | 'medium' | 'campaign'>) =>
  `${t.source} / ${t.medium}${t.campaign ? ` · ${t.campaign}` : ''}`;

/** A5 "Atributsiya": first/last touch, channels, sessions, CAC (CLAUDE.md §6). */
export function AttributionSummary({ j }: { j: CustomerJourneyDto }) {
  const s = j.summary;
  return (
    <div className="flex flex-col gap-3" data-testid="customer-attribution">
      {s.channels.length ? (
        <ol className="flex flex-wrap items-center gap-1.5" aria-label="Kanallar ketma-ketligi">
          {s.channels.map((c, i) => (
            <li key={c} className="flex items-center gap-1.5">
              <Badge tone={i === s.channels.length - 1 ? 'dark' : 'neutral'}>
                {channelLabel(c)}
              </Badge>
              {i < s.channels.length - 1 ? (
                <span aria-hidden className="text-muted">
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-muted">Birinchi teginish</dt>
        <dd className="font-semibold break-all">
          {s.firstTouch ? `${touchText(s.firstTouch)} · ${formatWhen(s.firstTouch.at)}` : '—'}
        </dd>
        <dt className="text-muted">Oxirgi teginish</dt>
        <dd className="font-semibold break-all">
          {s.lastTouch ? `${touchText(s.lastTouch)} · ${formatWhen(s.lastTouch.at)}` : '—'}
        </dd>
        <dt className="text-muted">Kanallar</dt>
        <dd className="font-semibold">
          {s.channels.length} ta · {INT(s.sessions)} sessiya
        </dd>
        <dt className="text-muted">Reklama xarajati</dt>
        <dd className="font-semibold">
          {s.cacSoum !== null ? `≈ ${SOUM_FULL(s.cacSoum)} so'm (CAC)` : "pullik teginish yo'q"}
        </dd>
      </dl>
    </div>
  );
}

/** A5 site visits with a behaviour summary (sessions of every linked visitor). */
export function CustomerVisits({ j }: { j: CustomerJourneyDto }) {
  if (!j.sessions.length)
    return <p className="py-4 text-center text-muted">Saytga tashriflar hali bog&apos;lanmagan.</p>;
  return (
    <>
      <ol className="flex flex-col" data-testid="customer-visits">
        {j.sessions.map((s) => {
          const behaviour = [
            `${INT(s.pageviews)} sahifa`,
            s.viewedItems ? `${s.viewedItems} mahsulot ko'rdi` : null,
            s.addedToCart ? `${s.addedToCart} marta savatga qo'shdi` : null,
            s.beganCheckout ? 'checkout boshladi' : null,
            s.lead ? 'raqam qoldirdi' : null,
          ].filter(Boolean);
          return (
            <li
              key={s.id}
              className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-t border-line-soft py-2.5"
            >
              <time dateTime={s.startedAt} className="text-xs text-muted">
                {formatWhen(s.startedAt)}
              </time>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="font-semibold">
                    {s.landingPath} · {DURATION(s.durationSec)}
                  </b>
                  <Badge
                    tone={s.channel.startsWith('paid_') ? 'lead' : 'neutral'}
                    className="h-5 text-[11px]"
                  >
                    {channelLabel(s.channel)}
                  </Badge>
                  {s.orderNumber ? (
                    <Badge tone="good" className="h-5 text-[11px]">
                      Xarid {s.orderNumber}
                    </Badge>
                  ) : null}
                </span>
                <span className="text-muted">
                  {[touchText(s), deviceLabel(s.device), s.region].filter(Boolean).join(' · ')}
                </span>
                <span className="text-muted">{behaviour.join(' · ')}</span>
                {s.hasReplay ? (
                  <Link href={replayHref(s.id)} prefetch={false} className="text-xs underline">
                    Sessiyani ko&apos;rish
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {j.truncated ? (
        <p className="text-xs text-muted">
          Oxirgi {j.sessions.length} ta tashrif ko&apos;rsatilgan.
        </p>
      ) : null}
    </>
  );
}
