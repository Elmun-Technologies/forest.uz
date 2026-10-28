import {
  type AdminCwvDto,
  type AdminNotFoundDto,
  type AdminRedirectPageDto,
  type AdminSearchQueriesDto,
  type AdminSearchTotalsDto,
  type AdminSeoOverviewDto,
  type AdminSeoPagesDto,
  type AdminZeroResultDto,
  hasPermission,
} from '@forest/contracts/core';
import { Badge, cn, KpiTile, Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NoAccess, PageHeader } from '../../../components/page';
import { COPY, RULE_LABEL } from '../../../components/seo/copy';
import { CwvPanel } from '../../../components/seo/cwv-panel';
import { SeoMetaEditor } from '../../../components/seo/meta-editor';
import { RedirectsPanel } from '../../../components/seo/redirects-panel';
import {
  SchemaPanel,
  SyncQueriesButton,
  TechnicalPanel,
  VerificationForm,
} from '../../../components/seo/site-panels';
import { adminGet, requireFullSession } from '../../../lib/api';

export const metadata: Metadata = { title: 'SEO markazi · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;

const nf = new Intl.NumberFormat('ru-RU');
const num = (n: number) => nf.format(n);
const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

function delta(cur: number, prev: number | undefined, lowerIsBetter = false) {
  if (prev === undefined || prev === 0) return undefined;
  const diff = cur - prev;
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  return {
    direction: direction as 'up' | 'down' | 'flat',
    value: lowerIsBetter
      ? Math.abs(diff).toFixed(1).replace('.', ',')
      : `${Math.round((Math.abs(diff) / prev) * 100)}%`,
    good: lowerIsBetter ? diff <= 0 : diff >= 0,
  };
}

function SearchKpis({ t, prev }: { t: AdminSearchTotalsDto; prev: AdminSearchTotalsDto | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile label="Bosishlar" value={num(t.clicks)} delta={delta(t.clicks, prev?.clicks)} />
      <KpiTile
        label="Ko'rinishlar"
        value={num(t.impressions)}
        delta={delta(t.impressions, prev?.impressions)}
      />
      <KpiTile label="O'rtacha CTR" value={pct(t.ctr)} delta={delta(t.ctr, prev?.ctr)} />
      <KpiTile
        label="O'rtacha pozitsiya"
        value={t.position === null ? '—' : String(t.position).replace('.', ',')}
        delta={
          t.position === null ? undefined : delta(t.position, prev?.position ?? undefined, true)
        }
      />
    </div>
  );
}

/** A9 SEO center (docs/10, design Admin-SEO). */
export default async function SeoPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'seo.edit')) {
    return (
      <>
        <PageHeader title={COPY.title} />
        <NoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const source = sp.source === 'ywm' ? 'ywm' : 'gsc';
  const [o, pages, queries, cwv, redirects, notFound, zero] = await Promise.all([
    adminGet<AdminSeoOverviewDto>('/admin/seo/overview'),
    adminGet<AdminSeoPagesDto>('/admin/seo/pages'),
    adminGet<AdminSearchQueriesDto>(`/admin/seo/queries?source=${source}&days=28`),
    adminGet<AdminCwvDto>('/admin/seo/cwv'),
    adminGet<AdminRedirectPageDto>('/admin/seo/redirects?limit=50'),
    adminGet<AdminNotFoundDto[]>('/admin/seo/not-found?days=7'),
    adminGet<AdminZeroResultDto[]>('/admin/seo/zero-results'),
  ]);
  const connected = [o.sources.gsc, o.sources.ywm].filter((s) => s.status === 'CONNECTED').length;
  const h = o.health;

  return (
    <>
      <PageHeader
        title={COPY.title}
        subtitle={COPY.subtitle}
        actions={
          <Link
            href="/integrations"
            prefetch={false}
            className="rounded-pill bg-panel px-4 py-2 text-[13px] font-semibold"
          >
            {connected} / 2 ulangan
          </Link>
        }
      />

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(280px,330px)_minmax(0,1fr)]">
        <Panel
          tone="dark"
          as="section"
          className="flex flex-col gap-4 p-6"
          aria-labelledby="seo-health"
        >
          <h2 id="seo-health" className="text-[13px] text-on-dark-muted">
            {COPY.health}
          </h2>
          <p className="flex items-baseline gap-1" data-testid="seo-score">
            <b className="text-[64px] leading-none font-medium tracking-[-0.04em]">{h.score}</b>
            <span className="text-on-dark-muted">/ 100</span>
          </p>
          <div className="h-2 overflow-hidden rounded-pill bg-dark-3" aria-hidden>
            <div className="h-full rounded-pill bg-[#4CAF50]" style={{ width: `${h.score}%` }} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="critical">
              {h.critical} {COPY.critical}
            </Badge>
            <Badge tone="warn">
              {h.warnings} {COPY.warnings}
            </Badge>
          </div>
          <span className="text-[11px] text-on-dark-muted">{h.pages} sahifa × til tekshirildi</span>
        </Panel>

        <Panel as="section" className="flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="seo-search">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav
              id="seo-search"
              aria-label="Qidiruv tizimi"
              className="flex gap-1 rounded-pill bg-canvas p-1"
            >
              {(
                [
                  ['gsc', 'Search Console'],
                  ['ywm', 'Yandex Webmaster'],
                ] as const
              ).map(([key, label]) => (
                <Link
                  key={key}
                  href={`/seo?source=${key}`}
                  prefetch={false}
                  scroll={false}
                  aria-current={source === key ? 'page' : undefined}
                  className={cn(
                    'rounded-pill px-4 py-2 text-[13px] font-semibold',
                    source === key ? 'bg-ink text-white' : 'text-muted',
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <span className="text-xs text-muted">
              oxirgi 28 kun · har kuni sinxronlanadi
              {queries.lastSyncedAt ? ` · ${queries.lastSyncedAt.slice(0, 10)}` : ''}
            </span>
          </div>
          {queries.previous || queries.totals.impressions > 0 ? (
            <SearchKpis t={queries.totals} prev={queries.previous} />
          ) : (
            <p className="rounded-md bg-off p-6 text-center text-[13px] text-muted">
              {o.usingFake
                ? COPY.queriesFake
                : queries.status === 'CONNECTED'
                  ? COPY.queriesEmptyConnected
                  : COPY.queriesNotConnected}
            </p>
          )}
        </Panel>
      </div>

      <SeoMetaEditor pages={pages.items} siteUrl={pages.siteUrl} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <Panel
          as="section"
          className="flex flex-col gap-2 p-5 sm:p-6"
          aria-labelledby="seo-queries"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="seo-queries" className="text-xl font-semibold">
              {COPY.queries}
            </h2>
            {queries.status === 'CONNECTED' ? <SyncQueriesButton /> : null}
          </div>
          {queries.items.length === 0 ? (
            <p className="rounded-md bg-off p-6 text-center text-[13px] text-muted">
              {queries.status === 'CONNECTED'
                ? COPY.queriesEmptyConnected
                : COPY.queriesNotConnected}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-xs text-muted">
                    <th className="py-2 font-normal">So&apos;rov</th>
                    <th className="py-2 text-right font-normal">Bosish</th>
                    <th className="py-2 text-right font-normal">Ko&apos;rinish</th>
                    <th className="py-2 text-right font-normal">CTR</th>
                    <th className="py-2 text-right font-normal">Pozitsiya</th>
                  </tr>
                </thead>
                <tbody>
                  {queries.items.map((q) => (
                    <tr key={q.query} className="border-b border-line-soft">
                      <td className="py-2.5 font-semibold">{q.query}</td>
                      <td className="tabular py-2.5 text-right">{num(q.clicks)}</td>
                      <td className="tabular py-2.5 text-right text-muted">{num(q.impressions)}</td>
                      <td className="tabular py-2.5 text-right">{pct(q.ctr)}</td>
                      <td className="py-2.5 text-right">
                        <Badge tone={q.position !== null && q.position > 10 ? 'warn' : 'neutral'}>
                          {q.position === null ? '—' : String(q.position).replace('.', ',')}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <div className="flex flex-col gap-4">
          <TechnicalPanel o={o} />
          <SchemaPanel schema={o.schema} faqPages={o.faqPages} />
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <Panel as="section" className="flex flex-col gap-2 p-5 sm:p-6" aria-labelledby="seo-issues">
          <h2 id="seo-issues" className="text-xl font-semibold">
            {COPY.issues}
          </h2>
          {h.issues.length === 0 ? (
            <p className="rounded-md bg-off p-6 text-center text-[13px] text-muted">
              {COPY.noIssues}
            </p>
          ) : (
            <ul className="flex flex-col">
              {h.issues.map((i) => (
                <li
                  key={i.rule}
                  className="flex flex-col gap-1 border-b border-line-soft py-2.5 text-[13px]"
                  data-testid="seo-issue"
                >
                  <span className="flex items-center gap-2">
                    <Badge tone={i.severity === 'critical' ? 'critical' : 'warn'}>{i.count}</Badge>
                    <b className="font-semibold">{RULE_LABEL[i.rule].title}</b>
                    <span className="text-xs text-muted">· {RULE_LABEL[i.rule].hint}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {i.examples
                      .slice(0, 6)
                      .map(
                        (e) =>
                          `${e.locale ? `${e.locale} ` : ''}${e.path}${e.detail ? ` (${e.detail})` : ''}`,
                      )
                      .join(' · ')}
                    {i.count > 6 ? ' …' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <CwvPanel cwv={cwv} canRunLab={o.sources.pagespeed.status === 'CONNECTED'} />
      </div>

      <RedirectsPanel redirects={redirects.items} total={redirects.total} notFound={notFound} />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <VerificationForm v={o.verification} />
        <Panel as="section" className="flex flex-col gap-2 p-5 sm:p-6" aria-labelledby="seo-zero">
          <h2 id="seo-zero" className="text-xl font-semibold">
            {COPY.zero}
          </h2>
          {zero.length === 0 ? (
            <p className="rounded-md bg-off p-6 text-center text-[13px] text-muted">
              {COPY.zeroEmpty}
            </p>
          ) : (
            <ul className="flex flex-col text-[13px]">
              {zero.map((z) => (
                <li
                  key={`${z.locale}:${z.query}`}
                  className="flex justify-between border-b border-line-soft py-2"
                >
                  <span>
                    <b className="font-semibold">{z.query}</b>{' '}
                    <span className="text-xs text-muted">{z.locale.toUpperCase()}</span>
                  </span>
                  <span className="tabular text-muted">{z.searches}×</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted">
            Sinonim yoki mahsulot kalit so&apos;zini qo&apos;shing (Mahsulotlar → qidiruv
            so&apos;zlari).
          </p>
        </Panel>
      </div>
    </>
  );
}
