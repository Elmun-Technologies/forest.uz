import { hasPermission } from '@forest/contracts/core';
import { Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../components/page';
import { requireFullSession } from '../../lib/api';
import { formatLongDate } from '../../lib/format';
import { settingsTabsFor } from '../../lib/nav';

export const metadata: Metadata = { title: 'Dashboard · Forest Admin' };

/**
 * A1 placeholder: the KPIs, funnel and "attention required" list come with first-party analytics
 * (Phase 4). No sample numbers are shown (docs/08: designs are "Namuna" data).
 */
export default async function DashboardPage() {
  const me = await requireFullSession();
  const shortcuts = settingsTabsFor(me.staff.role);
  return (
    <>
      <PageHeader title="Dashboard" subtitle={formatLongDate()} />
      <Panel className="flex flex-col gap-3 p-6 sm:p-8">
        <h2 className="text-xl font-semibold">Salom, {me.staff.name}!</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          {hasPermission(me.staff.role, 'analytics.view')
            ? "Ko'rsatkichlar (sessiyalar, buyurtmalar, tushum, konversiya), sotuv voronkasi va «Diqqat talab qiladi» ro'yxati birinchi tomon analitikasi bilan 4-bosqichda ulanadi. Hozircha bu yerda namunaviy raqamlar ko'rsatilmaydi."
            : "Buyurtmalar va SLA ogohlantirishlari shu yerda paydo bo'ladi — ular keyingi bosqichlarda ulanadi."}
        </p>
      </Panel>
      {shortcuts.length > 0 ? (
        <Panel className="flex flex-col gap-3 p-6 sm:p-8">
          <h2 className="text-lg font-semibold">Hozir ishlaydigan bo&apos;limlar</h2>
          <div className="flex flex-wrap gap-2">
            {shortcuts.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                prefetch={false}
                className="rounded-pill bg-canvas px-4 py-2 text-[13px] font-semibold hover:bg-sage"
              >
                Sozlamalar · {t.label}
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
