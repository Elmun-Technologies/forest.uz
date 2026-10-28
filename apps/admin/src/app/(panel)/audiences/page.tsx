import {
  type AdminSegmentDto,
  type AdminSegmentListDto,
  AD_DESTINATION_INTEGRATION,
  hasPermission,
} from '@forest/contracts/core';
import { Badge, buttonClasses, cn, Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AudienceEditor } from '../../../components/audiences/audience-editor';
import { COPY, DESTINATION_LABEL, PLATFORM_LABEL } from '../../../components/audiences/copy';
import { NoAccess, PageHeader } from '../../../components/page';
import { adminGet, requireFullSession } from '../../../lib/api';
import { formatLastSeen } from '../../../lib/format';

export const metadata: Metadata = { title: 'Auditoriyalar · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;

const cardClass = (selected: boolean) =>
  cn(
    'flex flex-col gap-2 rounded-lg p-5 transition-colors focus-visible:outline-2 focus-visible:outline-forest',
    selected ? 'bg-ink text-white' : 'bg-panel hover:bg-white',
  );

const fmt = (n: number) => new Intl.NumberFormat('uz-UZ').format(n).replace(/,/g, ' ');

/** A8 Auditoriyalar: segment cards (size, refresh, destinations, result) + editor (?id= | new). */
export default async function AudiencesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'audiences.edit')) {
    return (
      <>
        <PageHeader title={COPY.title} />
        <NoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const list = await adminGet<AdminSegmentListDto>('/admin/audiences');
  const wanted = typeof sp.id === 'string' ? sp.id.slice(0, 64) : '';
  const id = wanted || list.items[0]?.id || 'new';
  const selected: AdminSegmentDto | null =
    id === 'new' ? null : (list.items.find((s) => s.id === id) ?? null);

  return (
    <>
      <PageHeader
        title={COPY.title}
        subtitle={
          <>
            {COPY.subtitle}
            {list.fakeMode ? (
              <Badge tone="warn" className="ml-2">
                {COPY.fake}
              </Badge>
            ) : null}
          </>
        }
        actions={
          <Link
            href="/audiences?id=new"
            prefetch={false}
            className={buttonClasses('primary', 'md')}
            data-testid="audience-new"
          >
            {COPY.add}
          </Link>
        }
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(320px,440px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {list.items.length === 0 ? (
            <p className="rounded-lg bg-panel p-8 text-center text-muted">{COPY.empty}</p>
          ) : null}
          {list.items.map((s) => {
            const on = s.id === selected?.id;
            return (
              <Link
                key={s.id}
                href={`/audiences?id=${s.id}`}
                prefetch={false}
                scroll={false}
                aria-current={on ? 'true' : undefined}
                className={cardClass(on)}
                data-testid="audience-card"
              >
                <span className="flex items-start gap-3">
                  <b className="mr-auto text-base font-semibold">{s.name}</b>
                  <b className="tabular text-xl font-semibold">{fmt(s.size)}</b>
                </span>
                {s.description ? (
                  <span className={on ? 'text-xs text-white/70' : 'text-xs text-muted'}>
                    {s.description}
                  </span>
                ) : null}
                <span className="flex flex-wrap items-center gap-1.5 text-xs">
                  {s.destinations.map((d) => (
                    <span
                      key={d}
                      className={
                        on
                          ? 'rounded-pill bg-white/15 px-2 py-0.5'
                          : 'rounded-pill bg-canvas px-2 py-0.5'
                      }
                    >
                      {DESTINATION_LABEL[d].name.split(' ')[0]}
                    </span>
                  ))}
                  {!s.active ? <Badge tone="neutral">to&apos;xtatilgan</Badge> : null}
                  <span className={on ? 'ml-auto text-white/70' : 'ml-auto text-muted'}>
                    {s.refreshedAt ? formatLastSeen(s.refreshedAt) : COPY.refreshedNever}
                  </span>
                </span>
              </Link>
            );
          })}
          <Panel
            as="section"
            className="flex flex-col gap-2 p-5 text-[13px]"
            aria-labelledby="aud-signals"
          >
            <h2 id="aud-signals" className="font-semibold">
              {COPY.signals}
            </h2>
            {list.signals.map((s) => (
              <div key={s.platform} className="flex items-center gap-2">
                <span className="mr-auto">{PLATFORM_LABEL[s.platform]}</span>
                {s.connected ? (
                  <span className="tabular text-muted">
                    {s.sent} yuborildi · {s.pending} navbatda · {s.failed} xato
                  </span>
                ) : (
                  <Badge tone="neutral">{COPY.notConnected}</Badge>
                )}
              </div>
            ))}
            <p className="text-xs text-muted">{COPY.signalsHint}</p>
            {hasPermission(me.staff.role, 'integrations.view') ? (
              <Link
                href="/integrations"
                prefetch={false}
                className="text-xs font-semibold text-forest underline"
              >
                Integratsiyalar → {Object.values(AD_DESTINATION_INTEGRATION).length} reklama
                ulanishi
              </Link>
            ) : null}
          </Panel>
        </div>
        <AudienceEditor key={selected?.id ?? 'new'} segment={selected} list={list} />
      </div>
    </>
  );
}
