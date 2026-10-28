import type {
  AdSpendSummaryDto,
  CohortsDto,
  DevicesDto,
  EventsDto,
  FunnelDto,
  FunnelStepDto,
  PagesDto,
  RealtimeDto,
  SourcesDto,
  SourceTotalsDto,
} from '@forest/contracts/core';
import { cn, KpiTile, Panel } from '@forest/ui';
import { Section } from '../page';
import { AdSpendImport } from './ad-spend-import';
import { ChannelList, Empty, FunnelBars, Meter } from './blocks';
import {
  channelLabel,
  deviceLabel,
  DURATION,
  eventLabel,
  FUNNEL_LABEL,
  INT,
  kpiDelta,
  MODEL_HINT,
  MODEL_LABEL,
  ORDERS,
  PCT,
  PLATFORM_LABEL,
  RATIO_X,
  SOUM_SHORT,
} from './copy';

const MONTHS = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentyabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
];

// ───────────────────────── Real-time ─────────────────────────

export function RealtimeTab({ rt }: { rt: RealtimeDto }) {
  const max = Math.max(1, ...rt.perMinute.map((m) => m.sessions));
  return (
    <Panel tone="dark" className="grid gap-6 p-6 sm:p-7 lg:grid-cols-3" data-testid="realtime">
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-[13px] text-on-dark-muted">
          <span aria-hidden className="size-2 rounded-full bg-live" /> Hozir saytda
        </span>
        <b
          className="tabular text-[64px] leading-none font-medium tracking-[-0.04em]"
          data-testid="realtime-count"
        >
          {INT(rt.activeNow)}
        </b>
        <span className="text-xs text-on-dark-muted">oxirgi 30 daqiqa, har daqiqada</span>
        <div
          className="mt-2 flex h-16 items-end gap-[3px]"
          role="img"
          aria-label="Daqiqalik faol sessiyalar"
        >
          {rt.perMinute.map((m) => (
            <span
              key={m.minute}
              title={`${m.minute.slice(11, 16)} UTC · ${m.sessions}`}
              className="flex-1 rounded-t-[2px] bg-live"
              style={{
                height: `${Math.max(m.sessions ? 6 : 2, (m.sessions / max) * 100)}%`,
                opacity: m.sessions ? 1 : 0.3,
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 text-[13px]">
        <b className="font-semibold">Faol sahifalar</b>
        {rt.pages.length === 0 ? (
          <span className="text-on-dark-muted">Hozir hech kim yo&apos;q.</span>
        ) : null}
        <ul className="flex flex-col">
          {rt.pages.map((p) => (
            <li
              key={p.path}
              className="flex justify-between gap-3 border-t border-dark-3 py-1.5 first:border-t-0"
            >
              <span className="truncate">{p.path}</span>
              <b className="tabular">{INT(p.sessions)}</b>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2 text-[13px]">
        <b className="font-semibold">Hozirgi oqim</b>
        <ul className="flex flex-col">
          {rt.channels.map((c) => (
            <li
              key={c.channel}
              className="flex justify-between gap-3 border-t border-dark-3 py-1.5 first:border-t-0"
            >
              <span className="truncate">{channelLabel(c.channel)}</span>
              <b className="tabular">{INT(c.sessions)}</b>
            </li>
          ))}
        </ul>
        {rt.regions.length ? (
          <p className="text-xs text-on-dark-muted">
            {rt.regions.map((r) => `${r.region} ${r.sessions}`).join(' · ')}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

// ───────────────────────── Sources & UTM ─────────────────────────

function TotalsRow({ t, prev }: { t: SourceTotalsDto; prev: SourceTotalsDto | null }) {
  const m = (v: number, p: number | undefined) => ({ value: v, previous: p ?? null });
  return (
    <div
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      data-testid="source-totals"
    >
      <KpiTile
        label="Sessiyalar"
        value={INT(t.sessions)}
        delta={kpiDelta(m(t.sessions, prev?.sessions))}
      />
      <KpiTile
        label="Lead (sessiya)"
        value={INT(t.leads)}
        delta={kpiDelta(m(t.leads, prev?.leads))}
      />
      <KpiTile label="Xaridlar" value={INT(t.orders)} delta={kpiDelta(m(t.orders, prev?.orders))} />
      <KpiTile
        label="Daromad"
        value={SOUM_SHORT(t.revenueSoum)}
        delta={kpiDelta(m(t.revenueSoum, prev?.revenueSoum))}
      />
      <KpiTile
        label="Reklama xarajati"
        value={SOUM_SHORT(t.spendSoum)}
        delta={kpiDelta(m(t.spendSoum, prev?.spendSoum))}
      />
      <KpiTile label="ROAS" value={RATIO_X(t.roas)} hint="daromad / xarajat" />
    </div>
  );
}

export function SourcesTab({
  s,
  spend,
  canImport,
}: {
  s: SourcesDto;
  spend: AdSpendSummaryDto;
  canImport: boolean;
}) {
  return (
    <>
      <TotalsRow t={s.totals} prev={s.previousTotals} />
      <Section
        title="Manbalar va kampaniyalar (UTM)"
        actions={
          <span className="text-xs text-muted">
            Daromad modeli: {MODEL_LABEL[s.model]} ({MODEL_HINT[s.model]})
          </span>
        }
      >
        {s.rows.length === 0 ? (
          <Empty>Bu davrda trafik va xarajat yo&apos;q.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left" data-testid="sources-table">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-2 font-medium">Manba / kanal / kampaniya</th>
                  <th className="py-2 text-right font-medium">Sessiya</th>
                  <th className="py-2 text-right font-medium">Bounce</th>
                  <th className="py-2 text-right font-medium">O&apos;rt. vaqt</th>
                  <th className="py-2 text-right font-medium">Lead</th>
                  <th className="py-2 text-right font-medium">Buyurtma</th>
                  <th className="py-2 text-right font-medium">Daromad</th>
                  <th className="py-2 text-right font-medium">Xarajat</th>
                  <th className="py-2 text-right font-medium">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr
                    key={`${r.source}|${r.medium}|${r.campaign ?? ''}|${r.channel}`}
                    className="border-t border-line-soft"
                  >
                    <td className="py-2.5 pr-3">
                      <b className="font-semibold">
                        {r.source} / {r.medium}
                      </b>
                      <span className="block text-xs text-muted">
                        {r.campaign ?? '—'} · {channelLabel(r.channel)}
                      </span>
                    </td>
                    <td className="tabular py-2.5 text-right">{INT(r.sessions)}</td>
                    <td className="tabular py-2.5 text-right">{PCT(r.bounceRate, 0)}</td>
                    <td className="tabular py-2.5 text-right">{DURATION(r.avgDurationSec)}</td>
                    <td className="tabular py-2.5 text-right">{INT(r.leads)}</td>
                    <td className="tabular py-2.5 text-right font-semibold">{ORDERS(r.orders)}</td>
                    <td className="tabular py-2.5 text-right font-semibold">
                      {SOUM_SHORT(r.revenueSoum)}
                    </td>
                    <td className="tabular py-2.5 text-right text-muted">
                      {r.spendSoum !== null ? SOUM_SHORT(r.spendSoum) : '—'}
                    </td>
                    <td className="py-2.5 text-right">
                      {r.roas !== null ? (
                        <span
                          className={cn(
                            'inline-flex h-6 items-center rounded-pill px-2 text-xs font-semibold',
                            r.roas >= 3
                              ? 'bg-good-bg text-good'
                              : r.roas >= 1
                                ? 'bg-warn-bg text-warn'
                                : 'bg-critical-bg text-critical',
                          )}
                        >
                          {RATIO_X(r.roas)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {s.pendingOrders > 0 ? (
          <p className="pt-2 text-xs text-muted">
            {s.pendingOrders} ta yangi xaridning atributsiyasi hisoblanmoqda (har daqiqada).
          </p>
        ) : null}
      </Section>
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Kanallar bo'yicha daromad">
          <ChannelList rows={s.channels} />
        </Section>
        <Section
          title="Reklama xarajati"
          actions={
            spend.lastImportDay ? (
              <span className="text-xs text-muted">oxirgi kun: {spend.lastImportDay}</span>
            ) : null
          }
        >
          {spend.platforms.length === 0 ? (
            <Empty>Bu davr uchun xarajat yuklanmagan. ROAS uchun CSV yuklang.</Empty>
          ) : (
            <ul className="flex flex-col" data-testid="spend-platforms">
              {spend.platforms.map((p) => (
                <li
                  key={p.platform}
                  className="flex justify-between gap-3 border-t border-line-soft py-2 first:border-t-0"
                >
                  <b className="font-semibold">{PLATFORM_LABEL[p.platform] ?? p.platform}</b>
                  <span className="tabular">
                    {SOUM_SHORT(p.spendSoum)} · {INT(p.clicks)} bosish
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canImport ? <AdSpendImport /> : null}
        </Section>
      </div>
    </>
  );
}

// ───────────────────────── Landing / exit ─────────────────────────

export function PagesTab({ p }: { p: PagesDto }) {
  const lmax = Math.max(0, ...p.landing.map((x) => x.sessions));
  const emax = Math.max(0, ...p.exit.map((x) => x.exits));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="Kirish sahifalari">
        {p.landing.length === 0 ? <Empty>Sessiyalar yo&apos;q.</Empty> : null}
        <ul className="flex flex-col" data-testid="landing-pages">
          {p.landing.map((x) => (
            <li
              key={x.path}
              className="grid grid-cols-[minmax(0,1fr)_64px_72px] items-center gap-3 border-t border-line-soft py-2.5 first:border-t-0"
            >
              <span className="flex min-w-0 flex-col gap-1.5">
                <b className="truncate font-semibold">{x.path}</b>
                <Meter value={x.sessions} max={lmax} />
              </span>
              <span className="tabular text-right">{INT(x.sessions)}</span>
              <span className="text-right text-xs text-muted">
                bounce
                <span className="block tabular">{PCT(x.bounceRate, 0)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Chiqib ketish nuqtalari">
        {p.exit.length === 0 ? <Empty>Sessiyalar yo&apos;q.</Empty> : null}
        <ul className="flex flex-col" data-testid="exit-pages">
          {p.exit.map((x) => (
            <li
              key={x.path}
              className="grid grid-cols-[minmax(0,1fr)_64px_56px] items-center gap-3 border-t border-line-soft py-2.5 first:border-t-0"
            >
              <span className="flex min-w-0 flex-col gap-1.5">
                <b className="truncate font-semibold">{x.path}</b>
                <Meter value={x.exits} max={emax} tone="exit" />
              </span>
              <span className="tabular text-right">{INT(x.exits)}</span>
              <b
                className="tabular text-right font-semibold"
                title="chiqishlar / sahifa ko'rishlari"
              >
                {PCT(x.exitRate, 0)}
              </b>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ───────────────────────── Events & goals ─────────────────────────

export function EventsTab({ e }: { e: EventsDto }) {
  const ins = e.insight;
  return (
    <Section
      title="Hodisalar va maqsadlar"
      actions={
        <span className="text-xs text-muted">
          Hodisani bajarganlar orasida xarid ulushi, umumiy {PCT(e.overall.rate)} ga nisbatan
        </span>
      }
    >
      {e.events.length === 0 ? <Empty>Bu davrda hodisalar yo&apos;q.</Empty> : null}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="events-grid">
        {e.events.map((x) => (
          <li key={x.name} className="flex flex-col gap-1 rounded-md border border-line p-4">
            <code className="text-[11px] text-muted">{x.name}</code>
            <b className="font-semibold">{eventLabel(x.name)}</b>
            <span className="flex items-end justify-between gap-2">
              <b className="tabular text-2xl font-medium">{INT(x.sessions)}</b>
              {x.name === 'purchase' ? (
                <span className="rounded-pill bg-canvas px-2 py-0.5 text-xs font-semibold">
                  maqsad
                </span>
              ) : x.rate !== null ? (
                <span
                  className={cn(
                    'rounded-pill px-2 py-0.5 text-xs font-semibold',
                    (x.lift ?? 0) >= 1 ? 'bg-good-bg text-good' : 'bg-warn-bg text-warn',
                  )}
                >
                  {PCT(x.rate)} · {RATIO_X(x.lift)}
                </span>
              ) : null}
            </span>
            <span className="text-[11px] text-muted">sessiya · {INT(x.count)} marta</span>
          </li>
        ))}
      </ul>
      {ins ? (
        <p className="mt-3 rounded-md bg-sage-50 p-4 text-[13px]" data-testid="events-insight">
          <b>Xulosa:</b>{' '}
          {ins.direction === 'up'
            ? `«${eventLabel(ins.name)}» qilganlar ${RATIO_X(ins.lift).replace('x', '')} barobar ko'proq xarid qiladi (${PCT(ins.rate)} va umumiy ${PCT(ins.overallRate)}, ${INT(ins.sessions)} sessiya). Buni reklama va bosh sahifada oldinga chiqarish mumkin.`
            : `«${eventLabel(ins.name)}» qilganlar umumiydan ${RATIO_X(1 / ins.lift).replace('x', '')} barobar kam xarid qiladi (${PCT(ins.rate)} va ${PCT(ins.overallRate)}, ${INT(ins.sessions)} sessiya) — shu qadamni tekshiring.`}
        </p>
      ) : e.events.length ? (
        <p className="mt-3 text-xs text-muted">
          Xulosa uchun ma&apos;lumot yetarli emas (hodisa kamida 30 sessiyada bo&apos;lishi kerak).
        </p>
      ) : null}
    </Section>
  );
}

// ───────────────────────── Funnel ─────────────────────────

function StepTable({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; steps: FunnelStepDto[] }[];
}) {
  return (
    <Section title={title}>
      {rows.length === 0 ? <Empty>Ma&apos;lumot yo&apos;q.</Empty> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-2 font-medium" />
              {rows[0]?.steps.map((s) => (
                <th key={s.step} className="py-2 text-right font-medium">
                  {FUNNEL_LABEL[s.step]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const top = r.steps[0]?.sessions ?? 0;
              return (
                <tr key={r.key} className="border-t border-line-soft">
                  <td className="py-2.5 font-semibold">{r.label}</td>
                  {r.steps.map((s, i) => (
                    <td key={s.step} className="tabular py-2.5 text-right">
                      {INT(s.sessions)}
                      {i > 0 ? (
                        <span className="block text-xs text-muted">
                          {PCT(top ? s.sessions / top : null)}
                        </span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function FunnelTab({ f }: { f: FunnelDto }) {
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Voronka">
          <FunnelBars steps={f.steps} testId="funnel-full" />
        </Section>
        {f.previous ? (
          <Section title="Oldingi davr">
            <FunnelBars steps={f.previous} />
          </Section>
        ) : null}
      </div>
      <StepTable
        title="Qurilmalar bo'yicha"
        rows={f.byDevice.map((x) => ({
          key: x.device,
          label: deviceLabel(x.device),
          steps: x.steps,
        }))}
      />
      <StepTable
        title="Kanallar bo'yicha"
        rows={f.byChannel.map((x) => ({
          key: x.channel,
          label: channelLabel(x.channel),
          steps: x.steps,
        }))}
      />
    </>
  );
}

// ───────────────────────── Devices & regions ─────────────────────────

export function DevicesTab({ d }: { d: DevicesDto }) {
  const rmax = Math.max(0, ...d.regions.map((r) => r.sessions));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Section title="Qurilmalar">
        {d.devices.length === 0 ? <Empty>Sessiyalar yo&apos;q.</Empty> : null}
        <ul className="flex flex-col gap-3" data-testid="devices">
          {d.devices.map((x) => (
            <li key={x.device} className="flex flex-col gap-1.5">
              <span className="flex justify-between gap-3">
                <b className="font-semibold">{deviceLabel(x.device)}</b>
                <span className="text-muted">
                  {PCT(x.share, 0)} · konversiya <b className="text-ink">{PCT(x.conversionRate)}</b>
                </span>
              </span>
              <span className="block h-7 w-full overflow-hidden rounded-xs bg-canvas">
                <span
                  className="block h-full rounded-xs bg-forest"
                  style={{ width: `${(x.share ?? 0) * 100}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Hududlar">
        {d.regions.length === 0 ? <Empty>Sessiyalar yo&apos;q.</Empty> : null}
        <ul className="grid gap-x-8 sm:grid-cols-2" data-testid="regions">
          {d.regions.map((r) => (
            <li
              key={r.region}
              className="grid grid-cols-[110px_minmax(0,1fr)_56px] items-center gap-3 py-1.5"
            >
              <span className="truncate">{r.region}</span>
              <Meter value={r.sessions} max={rmax} />
              <b className="tabular text-right">{INT(r.sessions)}</b>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ───────────────────────── Cohorts ─────────────────────────

export function CohortsTab({ c }: { c: CohortsDto }) {
  const offsets = c.cohorts[0]?.retention.length ?? 0;
  return (
    <Section
      title="Qayta xarid (kohortlar)"
      actions={
        <span className="text-xs text-muted">
          birinchi xarid oyi bo&apos;yicha, keyingi oylarda qayta xarid qilganlar ulushi
        </span>
      }
    >
      {c.cohorts.length === 0 ? (
        <Empty>Oxirgi 6 oyda xaridlar yo&apos;q.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left" data-testid="cohorts">
            <thead>
              <tr className="text-xs text-muted">
                <th className="py-2 font-medium">Kohort</th>
                <th className="py-2 text-right font-medium">Mijozlar</th>
                {Array.from({ length: offsets }, (_, i) => (
                  <th key={i} className="py-2 text-center font-medium">
                    {i + 1}-oy
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.cohorts.map((row) => (
                <tr key={row.month}>
                  <td className="py-1 font-semibold">
                    {MONTHS[Number(row.month.slice(5, 7)) - 1]} {row.month.slice(0, 4)}
                  </td>
                  <td className="tabular py-1 text-right">{INT(row.customers)}</td>
                  {row.retention.map((v, i) => (
                    <td key={i} className="p-0.5">
                      <span
                        className={cn(
                          'grid h-9 place-items-center rounded-xs text-xs font-semibold',
                          v === null ? 'bg-canvas' : v >= 0.15 ? 'text-white' : 'text-ink',
                        )}
                        style={
                          v === null
                            ? undefined
                            : {
                                background: `color-mix(in oklab, var(--color-forest) ${Math.round(12 + Math.min(1, v / 0.3) * 80)}%, var(--color-panel))`,
                              }
                        }
                      >
                        {v === null ? '' : PCT(v, 0)}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
