import type { AuditEntryDto } from '@forest/contracts/core';
import { AUDIT_ACTION_LABEL, AUDIT_ENTITY_LABEL, SYSTEM_ACTOR } from '../lib/copy';
import { formatWhen } from '../lib/format';

function describe(e: AuditEntryDto): string {
  const label = AUDIT_ACTION_LABEL[e.action] ?? e.action;
  // Own-account actions (login, 2FA) need no target.
  if (e.entity === 'Staff' && e.entityId && e.entityId === e.staff?.id) return label;
  const entity = AUDIT_ENTITY_LABEL[e.entity] ?? e.entity;
  const target = e.entityLabel ?? (e.entityId ? shortId(e.entityId) : null);
  return target ? `${label} · ${entity}: ${target}` : `${label} · ${entity}`;
}

/** Order numbers stay readable; cuids are shortened. */
function shortId(id: string): string {
  return id.length > 14 ? `…${id.slice(-6)}` : id;
}

function hasDetails(e: AuditEntryDto): boolean {
  return e.before != null || e.after != null || !!e.ip || !!e.userAgent;
}

/** Audit rows (design "Faoliyat jurnali": time · who · what). Details are already redacted. */
export function AuditList({ items, compact }: { items: AuditEntryDto[]; compact?: boolean }) {
  if (items.length === 0)
    return <p className="py-6 text-center text-muted">Hozircha yozuvlar yo&apos;q.</p>;
  return (
    <ul className="flex flex-col" data-testid="audit-list">
      {items.map((e) => (
        <li
          key={e.id}
          className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line-soft px-1 py-2.5 sm:grid-cols-[110px_140px_minmax(0,1fr)]"
        >
          <time dateTime={e.createdAt} className="text-muted">
            {formatWhen(e.createdAt)}
          </time>
          <b className="truncate font-semibold">{e.staff?.name ?? SYSTEM_ACTOR}</b>
          <div className="col-span-2 min-w-0 sm:col-span-1">
            {compact || !hasDetails(e) ? (
              <span>{describe(e)}</span>
            ) : (
              <details className="group">
                <summary className="cursor-pointer list-none marker:hidden">
                  <span>{describe(e)}</span>{' '}
                  <span className="text-xs font-semibold text-forest group-open:hidden">
                    batafsil
                  </span>
                </summary>
                <dl className="mt-2 grid gap-2 rounded-sm bg-off p-3 text-xs">
                  {e.before != null ? <Json label="Oldin" value={e.before} /> : null}
                  {e.after != null ? <Json label="Keyin" value={e.after} /> : null}
                  {e.ip || e.userAgent ? (
                    <div>
                      <dt className="font-semibold">Qurilma</dt>
                      <dd className="break-all text-muted">
                        {[e.ip, e.userAgent].filter(Boolean).join(' · ')}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </details>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt className="font-semibold">{label}</dt>
      <dd>
        <pre className="font-mono text-[11px] break-all whitespace-pre-wrap text-ink-2">
          {JSON.stringify(value, null, 2)}
        </pre>
      </dd>
    </div>
  );
}
