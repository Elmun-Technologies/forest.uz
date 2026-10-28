import { type AdminBotOverviewDto, formatCompactSoum, hasPermission } from '@forest/contracts/core';
import { KpiTile, Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BotTabs } from '../../../components/bot/bot-tabs';
import { COPY, DAY_SHORT } from '../../../components/bot/copy';
import { KeywordsForm } from '../../../components/bot/keywords-form';
import { ScenariosTable } from '../../../components/bot/scenarios-table';
import { NoAccess, PageHeader, Section } from '../../../components/page';
import { adminGet, requireFullSession } from '../../../lib/api';

export const metadata: Metadata = { title: 'Telegram bot · Forest Admin' };

function dayRange(days: number[]): string {
  const order = [...new Set(days)].map((d) => (d + 6) % 7).sort((a, b) => a - b);
  const name = (m: number) => DAY_SHORT[(m + 1) % 7]!;
  if (!order.length) return '';
  const contiguous = order.every((d, i) => i === 0 || d === order[i - 1]! + 1);
  return contiguous && order.length > 1
    ? `${name(order[0]!)}–${name(order[order.length - 1]!)}`
    : order.map(name).join(', ');
}

/** A12 overview (`bot.edit`): KPIs from data, scenarios with switches, keywords, settings. */
export default async function BotPage() {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'bot.edit')) {
    if (hasPermission(me.staff.role, 'bot.inbox')) redirect('/bot/inbox');
    return (
      <>
        <PageHeader title={COPY.title} />
        <NoAccess />
      </>
    );
  }
  const o = await adminGet<AdminBotOverviewDto>('/admin/bot/overview');
  const k = o.kpis;
  const pct = (v: number | null) => (v === null ? COPY.none : `${String(v).replace('.', ',')}%`);
  const row = (label: string, value: string) => (
    <div className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );

  return (
    <>
      <PageHeader
        title={COPY.title}
        subtitle={`${o.botUsername ? `@${o.botUsername} · ` : ''}${COPY.subtitle}`}
        actions={<BotTabs role={me.staff.role} active="/bot" />}
      />
      {!o.connected ? (
        <Panel tone="warn" className="flex flex-wrap items-center gap-3 p-4 text-[13px]">
          <span>{COPY.notConnected}</span>
          {hasPermission(me.staff.role, 'integrations.view') ? (
            <Link href="/integrations" prefetch={false} className="font-semibold underline">
              {COPY.toIntegrations}
            </Link>
          ) : null}
        </Panel>
      ) : null}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5" data-testid="bot-kpis">
        <KpiTile
          label={COPY.kpiSubscribers}
          value={k.subscribers.toLocaleString('ru-RU')}
          hint={`+${k.subscribersNew30d} ${COPY.per30}`}
        />
        <KpiTile
          label={COPY.kpiPhones}
          value={k.phones.toLocaleString('ru-RU')}
          hint={k.phonesPct === null ? undefined : `${k.phonesPct}% ${COPY.ofSubscribers}`}
        />
        <KpiTile label={COPY.kpiOrders} value={k.botOrders30d} hint={COPY.days30} />
        <KpiTile
          label={COPY.kpiRevenue}
          value={formatCompactSoum(BigInt(k.botRevenueSoum30d) * 100n)}
          hint={COPY.revenueHint}
        />
        <KpiTile
          label={COPY.kpiUnsub}
          value={pct(k.unsubscribeRatePct)}
          hint={COPY.unsubHint}
          tone={k.unsubscribeRatePct !== null && k.unsubscribeRatePct >= 5 ? 'warn' : 'panel'}
        />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <Section title={COPY.scenarios} actions={<span className="text-muted">{COPY.days30}</span>}>
          <ScenariosTable initial={o.scenarios} />
        </Section>
        <div className="flex flex-col gap-4">
          <Section title={COPY.settings}>
            {row(
              COPY.hours,
              `${dayRange(o.settings.operatorDays)} · ${o.settings.operatorStart}–${o.settings.operatorEnd}`,
            )}
            {row(COPY.offHours, COPY.offHoursValue)}
            {row(
              COPY.operators,
              o.settings.operators.map((s) => s.name.split(' ')[0]).join(', ') || COPY.noOperators,
            )}
            {row(COPY.languages, o.settings.languages.map((l) => l.toUpperCase()).join(' · '))}
            {row(COPY.cap, `${o.settings.marketingPerDay} ${COPY.perCustomer}`)}
            {row(COPY.token, o.settings.tokenMasked ?? COPY.none)}
            {row(COPY.adminGroup, o.settings.adminGroup ? COPY.adminGroupOn : COPY.adminGroupOff)}
            <p className="mt-2 rounded-md bg-sage-50 p-3 text-[12px]">{COPY.alertNote}</p>
            <Link href="/bot/messages" prefetch={false} className="mt-2 font-semibold underline">
              {COPY.editSettings}
            </Link>
          </Section>
          <Section title={COPY.keywords}>
            <KeywordsForm initial={o.complaintKeywords} version={o.version} />
          </Section>
        </div>
      </div>
    </>
  );
}
