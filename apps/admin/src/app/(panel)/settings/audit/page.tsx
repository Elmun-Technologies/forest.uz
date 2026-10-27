import { type AuditActorDto, type AuditPageDto, hasPermission } from '@forest/contracts/core';
import { Button, buttonClasses } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuditList } from '../../../../components/audit-list';
import { NoAccess, Section } from '../../../../components/page';
import { SettingsHeader } from '../../../../components/settings-header';
import { adminGet, requireFullSession } from '../../../../lib/api';
import { AUDIT_ENTITY_LABEL } from '../../../../lib/copy';

export const metadata: Metadata = { title: 'Faoliyat jurnali · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;

const FILTERS = ['entity', 'staffId', 'from', 'to'] as const;

function pick(sp: Search, key: string): string {
  const v = sp[key];
  return typeof v === 'string' ? v.slice(0, 64) : '';
}

const selectClass =
  'h-11 w-full rounded-sm border border-line bg-panel px-3 text-sm focus:border-ink focus:outline-none';

/** A16 activity log: URL-synced filters (plain GET form — works without JS), cursor pages. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'audit.view')) {
    return (
      <>
        <SettingsHeader me={me} active="/settings/audit" />
        <NoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const filters = Object.fromEntries(FILTERS.map((k) => [k, pick(sp, k)])) as Record<
    (typeof FILTERS)[number],
    string
  >;
  const cursor = pick(sp, 'cursor');
  const query = new URLSearchParams({ limit: '50' });
  for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);
  if (cursor) query.set('cursor', cursor);

  const [page, options] = await Promise.all([
    adminGet<AuditPageDto>(`/admin/audit?${query.toString()}`),
    adminGet<{ actors: AuditActorDto[]; entities: string[] }>('/admin/audit/filters'),
  ]);
  const filterQuery = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  );
  const nextHref = page.nextCursor
    ? `/settings/audit?${new URLSearchParams([...filterQuery, ['cursor', page.nextCursor]]).toString()}`
    : null;
  const active = Object.values(filters).some(Boolean);

  return (
    <>
      <SettingsHeader me={me} active="/settings/audit" />
      <Section title="Faoliyat jurnali">
        <form
          method="get"
          action="/settings/audit"
          className="mb-3 grid gap-3 rounded-md bg-off p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_160px_160px_auto]"
          aria-label="Filtrlar"
        >
          <label className="flex flex-col gap-1.5 text-xs font-semibold">
            Obyekt
            <select name="entity" defaultValue={filters.entity} className={selectClass}>
              <option value="">Hammasi</option>
              {options.entities.map((e) => (
                <option key={e} value={e}>
                  {AUDIT_ENTITY_LABEL[e] ?? e}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold">
            Xodim
            <select name="staffId" defaultValue={filters.staffId} className={selectClass}>
              <option value="">Hammasi</option>
              {options.actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold">
            Dan
            <input type="date" name="from" defaultValue={filters.from} className={selectClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold">
            Gacha
            <input type="date" name="to" defaultValue={filters.to} className={selectClass} />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit">Ko&apos;rsatish</Button>
            {active ? (
              <Link href="/settings/audit" prefetch={false} className={buttonClasses('ghost')}>
                Tozalash
              </Link>
            ) : null}
          </div>
        </form>

        <AuditList items={page.items} />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <span className="text-xs text-muted">
            Vaqt — Toshkent. Maxfiy qiymatlar va shaxsiy ma&apos;lumotlar jurnalga yozilmaydi.
          </span>
          <span className="flex gap-2">
            {cursor ? (
              <Link
                href={`/settings/audit${filterQuery.size ? `?${filterQuery.toString()}` : ''}`}
                prefetch={false}
                className={buttonClasses('outline', 'sm')}
              >
                Boshiga
              </Link>
            ) : null}
            {nextHref ? (
              <Link href={nextHref} prefetch={false} className={buttonClasses('outline', 'sm')}>
                Keyingi sahifa
              </Link>
            ) : null}
          </span>
        </div>
      </Section>
    </>
  );
}
