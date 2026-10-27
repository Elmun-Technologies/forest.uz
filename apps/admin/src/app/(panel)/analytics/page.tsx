import {
  type AdSpendSummaryDto,
  ANALYTICS_DEVICES,
  ANALYTICS_PERIODS,
  ANALYTICS_TABS,
  type AnalyticsTab,
  ATTRIBUTION_MODELS,
  type CohortsDto,
  DEFAULT_ATTRIBUTION_MODEL,
  type DevicesDto,
  type EventsDto,
  type FunnelDto,
  hasPermission,
  type PagesDto,
  type RealtimeDto,
  type SourcesDto,
} from '@forest/contracts/core';
import { buttonClasses } from '@forest/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SegmentLinks } from '../../../components/analytics/blocks';
import { CHANNEL_LABEL, deviceLabel, MODEL_LABEL } from '../../../components/analytics/copy';
import {
  CohortsTab,
  DevicesTab,
  EventsTab,
  FunnelTab,
  PagesTab,
  RealtimeTab,
  SourcesTab,
} from '../../../components/analytics/tabs';
import { AutoRefresh } from '../../../components/orders/auto-refresh';
import { NoAccess, PageHeader } from '../../../components/page';
import { adminGet, requireFullSession } from '../../../lib/api';

export const metadata: Metadata = { title: 'Analitika · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;

const TAB_LABEL: Record<AnalyticsTab, string> = {
  realtime: 'Real vaqt',
  sources: 'Manbalar va UTM',
  pages: 'Kirish va chiqish',
  events: 'Hodisalar',
  funnel: 'Voronka',
  devices: 'Qurilma va hudud',
  cohorts: 'Qayta xarid',
};

const CHANNEL_OPTIONS = [
  'direct',
  'organic_search',
  'organic_social',
  'telegram',
  'referral',
  'sms',
  'bot',
  'email',
  'paid_meta',
  'paid_google',
  'paid_tiktok',
  'paid_yandex',
];

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

const fieldClass =
  'h-11 rounded-pill border border-line bg-panel px-4 text-[13px] focus:border-ink focus:outline-none';

/**
 * A2 Analytics (docs/07 "Reports"): first-party reports from our own DB. Filters are a plain GET
 * form (URL-synced); the tab decides which report is fetched.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'analytics.view'))
    return (
      <>
        <PageHeader title="Analitika" />
        <NoAccess />
      </>
    );
  const sp = await searchParams;
  const tab = (ANALYTICS_TABS as readonly string[]).includes(str(sp.tab))
    ? (str(sp.tab) as AnalyticsTab)
    : 'realtime';
  const daysN = Number(str(sp.days) || 30);
  const days = (ANALYTICS_PERIODS as readonly number[]).includes(daysN) ? daysN : 30;
  const device = (ANALYTICS_DEVICES as readonly string[]).includes(str(sp.device))
    ? str(sp.device)
    : '';
  const channel = /^[\w.-]{1,64}$/.test(str(sp.channel)) ? str(sp.channel) : '';
  const compare = str(sp.compare) !== '0';
  const model = (ATTRIBUTION_MODELS as readonly string[]).includes(str(sp.model))
    ? str(sp.model)
    : DEFAULT_ATTRIBUTION_MODEL;

  const q = new URLSearchParams({ days: String(days) });
  if (device) q.set('device', device);
  if (channel) q.set('channel', channel);
  if (!compare) q.set('compare', '0');
  if (model !== DEFAULT_ATTRIBUTION_MODEL) q.set('model', model);
  const href = (t: AnalyticsTab) =>
    `/analytics?${new URLSearchParams([...q, ['tab', t]]).toString()}`;
  const api = (path: string) => `/admin/analytics/${path}?${q.toString()}`;

  let body: ReactNode;
  switch (tab) {
    case 'realtime':
      body = <RealtimeTab rt={await adminGet<RealtimeDto>('/admin/analytics/realtime')} />;
      break;
    case 'sources': {
      const [s, spend] = await Promise.all([
        adminGet<SourcesDto>(api('sources')),
        adminGet<AdSpendSummaryDto>(`/admin/analytics/ad-spend?days=${days}`),
      ]);
      body = (
        <SourcesTab
          s={s}
          spend={spend}
          canImport={hasPermission(me.staff.role, 'analytics.import')}
        />
      );
      break;
    }
    case 'pages':
      body = <PagesTab p={await adminGet<PagesDto>(api('pages'))} />;
      break;
    case 'events':
      body = <EventsTab e={await adminGet<EventsDto>(api('events'))} />;
      break;
    case 'funnel':
      body = <FunnelTab f={await adminGet<FunnelDto>(api('funnel'))} />;
      break;
    case 'devices':
      body = <DevicesTab d={await adminGet<DevicesDto>(api('devices'))} />;
      break;
    case 'cohorts':
      body = <CohortsTab c={await adminGet<CohortsDto>('/admin/analytics/cohorts')} />;
      break;
  }

  const filtered = tab !== 'realtime' && tab !== 'cohorts';
  return (
    <>
      {tab === 'realtime' ? <AutoRefresh seconds={30} /> : null}
      <PageHeader
        title="Analitika"
        subtitle="O'z serverimizdagi birinchi tomon ma'lumotlari · Toshkent vaqti"
      />
      {filtered ? (
        <form
          method="get"
          action="/analytics"
          className="flex flex-wrap items-end gap-2 px-1"
          aria-label="Filtrlar"
        >
          <input type="hidden" name="tab" value={tab} />
          <label className="flex flex-col gap-1 text-xs text-muted">
            Qurilma
            <select name="device" defaultValue={device} className={fieldClass}>
              <option value="">Hammasi</option>
              {ANALYTICS_DEVICES.map((d) => (
                <option key={d} value={d}>
                  {deviceLabel(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Manba
            <select name="channel" defaultValue={channel} className={fieldClass}>
              <option value="">Hammasi</option>
              {CHANNEL_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c] ?? c}
                </option>
              ))}
              {channel && !CHANNEL_OPTIONS.includes(channel) ? (
                <option value={channel}>{channel}</option>
              ) : null}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Davr
            <select name="days" defaultValue={String(days)} className={fieldClass}>
              {ANALYTICS_PERIODS.map((n) => (
                <option key={n} value={n}>
                  {n} kun
                </option>
              ))}
            </select>
          </label>
          {tab === 'sources' ? (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Atributsiya
              <select name="model" defaultValue={model} className={fieldClass}>
                {ATTRIBUTION_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {MODEL_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex h-11 items-center gap-2 rounded-pill bg-panel px-4 text-[13px]">
            <input type="checkbox" name="compare" value="1" defaultChecked={compare} />
            oldingi davr bilan solishtirish
          </label>
          {/* Unchecked boxes are not submitted: this hidden field turns "off" into compare=0. */}
          <input type="hidden" name="compare" value="0" />
          <button type="submit" className={buttonClasses('primary', 'md')}>
            Qo&apos;llash
          </button>
        </form>
      ) : null}
      <SegmentLinks
        label="Analitika bo'limlari"
        items={ANALYTICS_TABS.map((t) => ({
          href: href(t),
          label: TAB_LABEL[t],
          active: t === tab,
        }))}
      />
      {body}
    </>
  );
}
