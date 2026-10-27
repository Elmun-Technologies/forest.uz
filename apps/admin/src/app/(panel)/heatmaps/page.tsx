import {
  HEATMAP_DEVICES,
  HEATMAP_INSIGHT_RULES,
  HEATMAP_PERIODS,
  type HeatmapDevice,
  type HeatmapDto,
  type HeatmapPagesDto,
  hasPermission,
  normalizeHeatmapPath,
  REPLAY_FILTERS,
  type ReplayFilter,
  type ReplayListDto,
  type ReplaySettingsDto,
} from '@forest/contracts/core';
import { cn, KpiTile, Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NoAccess, PageHeader, Section } from '../../../components/page';
import {
  PagePicker,
  RefreshButton,
  ReplaySettingsForm,
} from '../../../components/heatmaps/controls';
import { COPY, elementLabel, FILTER_LABEL, insightText } from '../../../components/heatmaps/copy';
import { HeatmapFrame } from '../../../components/heatmaps/heatmap-frame';
import { SessionList } from '../../../components/heatmaps/session-list';
import { adminGet, requireFullSession } from '../../../lib/api';
import { formatWhen } from '../../../lib/format';

export const metadata: Metadata = { title: 'Heatmap va sessiyalar · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;
const pick = (sp: Search, key: string, max = 300) => {
  const v = sp[key];
  return typeof v === 'string' ? v.slice(0, max) : '';
};

const chip = (on: boolean) =>
  cn(
    'inline-flex h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] font-semibold transition-colors',
    on ? 'bg-ink text-white' : 'bg-canvas hover:bg-sage-50',
  );

/** A3 (docs/08): heatmap of a page × device, KPIs, top elements, problems, session recordings. */
export default async function HeatmapsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'analytics.view')) {
    return (
      <>
        <PageHeader title={COPY.title} />
        <NoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const device: HeatmapDevice = (HEATMAP_DEVICES as readonly string[]).includes(pick(sp, 'device'))
    ? (pick(sp, 'device') as HeatmapDevice)
    : 'mobile';
  const days = (HEATMAP_PERIODS as readonly number[]).includes(Number(pick(sp, 'days')))
    ? Number(pick(sp, 'days'))
    : 30;
  const type = pick(sp, 'type') === 'scroll' ? 'scroll' : 'click';
  const filter = (REPLAY_FILTERS as readonly string[]).includes(pick(sp, 'filter'))
    ? (pick(sp, 'filter') as ReplayFilter)
    : null;
  const session = /^[0-9a-zA-Z-]{8,64}$/.test(pick(sp, 'session')) ? pick(sp, 'session') : null;
  const requestedPath = pick(sp, 'path') ? normalizeHeatmapPath(pick(sp, 'path')) : null;

  const pages = await adminGet<HeatmapPagesDto>(
    `/admin/heatmaps/pages?device=${device}&days=${days}`,
  );
  const path = requestedPath ?? pages.pages[0]?.path ?? '/';
  const replayQuery = new URLSearchParams({ days: String(days), limit: '20' });
  if (filter) replayQuery.set('filter', filter);

  const [heatmap, replays, settings] = await Promise.all([
    adminGet<HeatmapDto>(
      `/admin/heatmaps?${new URLSearchParams({ path, device, days: String(days) }).toString()}`,
    ),
    adminGet<ReplayListDto>(`/admin/replays?${replayQuery.toString()}`),
    adminGet<ReplaySettingsDto>('/admin/heatmaps/settings'),
  ]);

  const state = { path, device, days: String(days), type, filter: filter ?? '' };
  const href = (patch: Partial<typeof state>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...state, ...patch })) if (v) q.set(k, v);
    return `/heatmaps?${q.toString()}`;
  };
  const pageHrefs = Object.fromEntries(
    [path, ...pages.pages.map((p) => p.path)].map((p) => [p, href({ path: p })]),
  );
  const maxClicks = Math.max(1, ...heatmap.elements.map((e) => e.clicks));
  const k = heatmap.kpis;

  return (
    <>
      <PageHeader
        title={COPY.title}
        subtitle={COPY.subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PagePicker pages={pages.pages} current={path} hrefFor={pageHrefs} />
            <nav aria-label={COPY.device} className="flex gap-1 rounded-pill bg-panel p-1">
              {HEATMAP_DEVICES.map((d) => (
                <Link
                  key={d}
                  href={href({ device: d })}
                  prefetch={false}
                  aria-current={device === d ? 'page' : undefined}
                  className={cn(
                    'rounded-pill px-4 py-[9px] text-[13px] font-semibold',
                    device === d ? 'bg-ink text-white' : 'text-muted hover:text-ink',
                  )}
                  data-testid={`heatmap-device-${d}`}
                >
                  {d === 'mobile' ? 'Mobil' : 'Desktop'}
                </Link>
              ))}
            </nav>
            <nav aria-label={COPY.period} className="flex gap-1 rounded-pill bg-panel p-1">
              {HEATMAP_PERIODS.map((n) => (
                <Link
                  key={n}
                  href={href({ days: String(n) })}
                  prefetch={false}
                  aria-current={days === n ? 'page' : undefined}
                  className={cn(
                    'rounded-pill px-3 py-[9px] text-[13px] font-semibold',
                    days === n ? 'bg-ink text-white' : 'text-muted hover:text-ink',
                  )}
                >
                  {COPY.days(n)}
                </Link>
              ))}
            </nav>
          </div>
        }
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel className="flex flex-col gap-4 p-5 sm:p-[22px]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-pill bg-canvas p-1" role="tablist">
              {(['click', 'scroll'] as const).map((t) => (
                <Link
                  key={t}
                  href={href({ type: t })}
                  prefetch={false}
                  role="tab"
                  aria-selected={type === t}
                  className={cn(
                    'rounded-pill px-4 py-[9px] text-[13px] font-semibold',
                    type === t ? 'bg-ink text-white' : 'text-muted hover:text-ink',
                  )}
                >
                  {COPY.tabs[t]}
                </Link>
              ))}
              <span
                role="tab"
                aria-selected={false}
                aria-disabled
                title={COPY.moveNote}
                className="cursor-not-allowed rounded-pill px-4 py-[9px] text-[13px] font-semibold text-subtle"
              >
                {COPY.tabs.move}
              </span>
            </div>
            <span className="ml-auto flex items-center gap-2 text-xs text-muted">
              {COPY.legendLow}
              <span
                aria-hidden
                className="h-2 w-28 rounded-pill"
                style={{ background: 'linear-gradient(90deg,#ffdc78,#f0963c,#d65028,#961414)' }}
              />
              {COPY.legendHigh}
            </span>
          </div>
          <p className="text-[11px] text-muted">{COPY.moveNote}</p>
          {k.sessions === 0 ? <p className="text-sm text-muted">{COPY.noData}</p> : null}
          <HeatmapFrame path={path} device={device} type={type} data={heatmap} />
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>
              {COPY.aggregatedAt}:{' '}
              {heatmap.aggregatedAt ? formatWhen(heatmap.aggregatedAt) : COPY.never}
            </span>
            <RefreshButton />
          </div>
        </Panel>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <KpiTile label={COPY.kpiSessions} value={k.sessions.toLocaleString('ru-RU')} />
            <KpiTile
              label={COPY.kpiScroll}
              value={k.avgScrollPct === null ? '—' : `${k.avgScrollPct}%`}
            />
            <KpiTile label={COPY.kpiRage} value={k.rageClicks} tone="critical" />
            <KpiTile label={COPY.kpiDead} value={k.deadClicks} tone="warn" />
          </div>

          <Section title={COPY.elementsTitle}>
            {heatmap.elements.length === 0 ? (
              <p className="text-muted">{COPY.elementsEmpty}</p>
            ) : (
              <ol className="flex flex-col gap-3" data-testid="heatmap-elements">
                {heatmap.elements.map((e, i) => (
                  <li
                    key={e.selector}
                    className="grid grid-cols-[20px_1fr_auto] items-center gap-3"
                  >
                    <span className="text-muted">{i + 1}</span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="truncate font-semibold" title={e.selector}>
                        {elementLabel(e)}
                      </span>
                      <span className="h-1.5 rounded-pill bg-line-soft">
                        <span
                          className="block h-1.5 rounded-pill bg-chart-3"
                          style={{ width: `${(e.clicks / maxClicks) * 100}%` }}
                        />
                      </span>
                    </span>
                    <span className="tabular font-semibold">
                      {e.clicks.toLocaleString('ru-RU')}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Panel tone="dark" className="flex flex-col gap-3 p-5 sm:p-[22px]">
            <h2 className="text-[17px] font-semibold">{COPY.insightsTitle}</h2>
            {heatmap.insights.length === 0 ? (
              <p className="text-[13px] text-on-dark-muted">
                {COPY.insightsEmpty(HEATMAP_INSIGHT_RULES.minSessions)}
              </p>
            ) : (
              <ul className="flex flex-col gap-3 text-[13px]" data-testid="heatmap-insights">
                {heatmap.insights.map((ins, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 size-2.5 shrink-0 rounded-pill',
                        ins.severity === 'high' ? 'bg-[#f08c7c]' : 'bg-[#f2c14e]',
                      )}
                    />
                    {insightText(ins)}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Section
        title={COPY.sessionsTitle}
        actions={
          <nav aria-label={COPY.sessionsTitle} className="flex flex-wrap gap-2">
            <Link href={href({ filter: '' })} prefetch={false} className={chip(!filter)}>
              {COPY.all} · {replays.counts.all}
            </Link>
            {REPLAY_FILTERS.map((f) => (
              <Link
                key={f}
                href={href({ filter: f })}
                prefetch={false}
                aria-current={filter === f ? 'page' : undefined}
                className={chip(filter === f)}
                data-testid={`replay-filter-${f}`}
              >
                {FILTER_LABEL[f]} · {replays.counts[f]}
              </Link>
            ))}
          </nav>
        }
      >
        <SessionList
          key={replayQuery.toString()}
          initial={replays}
          query={replayQuery.toString()}
          openId={session}
        />
      </Section>

      <Section title={COPY.settingsTitle} className="max-w-2xl">
        <ReplaySettingsForm
          initial={settings}
          canEdit={hasPermission(me.staff.role, 'settings.store')}
        />
      </Section>
    </>
  );
}
