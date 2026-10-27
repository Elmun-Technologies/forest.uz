import type { ApiKeyDto, WebhookListDto } from '@forest/contracts/core';
import { Badge, Panel } from '@forest/ui';
import Link from 'next/link';

/**
 * A10 bottom row (design Admin-Integratsiya): outbound webhooks by event (destination, delivered in
 * 24 h), the active API key, and the key security facts. Real data only; empty states otherwise.
 */
export function DeveloperSummary({ hooks, keys }: { hooks: WebhookListDto; keys: ApiKeyDto[] }) {
  const active = keys.filter((k) => !k.revokedAt);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel
        as="section"
        className="flex flex-col gap-1.5 p-5 text-[13px] sm:p-[22px]"
        data-testid="webhooks-summary"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-1.5">
          <h2 className="text-xl font-semibold">Webhook va REST API</h2>
          <Link
            href="/integrations/webhooks"
            prefetch={false}
            className="text-xs font-semibold text-forest"
          >
            Boshqarish →
          </Link>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_90px] gap-3 border-b border-line px-1 py-2 text-xs text-muted">
          <span>Hodisa</span>
          <span>Manzil</span>
          <span className="text-right">24 soat</span>
        </div>
        {hooks.byEvent.length === 0 ? (
          <p className="py-4 text-center text-muted">Hali webhook ulanmagan.</p>
        ) : (
          hooks.byEvent.map((h) => (
            <div
              key={h.event}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_90px] items-center gap-3 border-b border-line-soft px-1 py-2.5"
            >
              <span className="font-mono text-xs font-semibold">{h.event}</span>
              <span className="truncate text-xs text-ink-2">{h.destinations.join(' · ')}</span>
              <span className="text-right tabular-nums">{h.delivered24h}</span>
            </div>
          ))
        )}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5">
          <Link
            href="/integrations/api-keys"
            prefetch={false}
            className="text-muted hover:text-ink"
          >
            API kalit (o&apos;qish) →
          </Link>
          {active[0] ? (
            <span className="rounded-sm bg-off px-2 py-1 font-mono text-xs">
              {active[0].masked}
              {active.length > 1 ? ` +${active.length - 1}` : ''}
            </span>
          ) : (
            <Badge tone="neutral">Kalit yo&apos;q</Badge>
          )}
        </div>
      </Panel>
      <Panel as="section" className="flex flex-col gap-2 p-5 text-[13px] sm:p-[22px]">
        <h2 className="text-xl font-semibold">Kalitlar xavfsizligi</h2>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-2">
          <dt className="text-muted">Saqlash</dt>
          <dd className="text-right font-semibold">Shifrlangan (AES-256-GCM) · faqat server</dd>
          <dt className="text-muted">Ko&apos;rinishi</dt>
          <dd className="text-right font-semibold">Oxirgi 4 belgi</dd>
          <dt className="text-muted">Kim o&apos;zgartira oladi</dt>
          <dd className="text-right font-semibold">Faqat Egasi</dd>
          <dt className="text-muted">Har o&apos;zgarish</dt>
          <dd className="text-right font-semibold">Jurnalga yoziladi</dd>
          <dt className="text-muted">Webhook imzosi</dt>
          <dd className="text-right font-semibold">HMAC-SHA256</dd>
          <dt className="text-muted">API kalitlar</dt>
          <dd className="text-right font-semibold">Faqat xesh saqlanadi</dd>
        </dl>
      </Panel>
    </div>
  );
}
