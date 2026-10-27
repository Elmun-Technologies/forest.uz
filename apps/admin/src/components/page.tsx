import { Panel } from '@forest/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@forest/ui';

/** Admin page title row (design: 36 px / 500 / −0.035em, subtitle 13 px muted). */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 px-1 py-2">
      <div className="mr-auto flex flex-col gap-0.5">
        <h1 className="text-[30px] font-medium tracking-[-0.035em] sm:text-[36px]">{title}</h1>
        {subtitle ? <p className="text-[13px] text-muted">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  );
}

/** Pill tabs (design segmented control) as links: only tabs whose pages exist and are permitted. */
export function TabLinks({
  tabs,
  active,
  label,
}: {
  tabs: { href: string; label: string }[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex gap-1 rounded-pill bg-panel p-1">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          prefetch={false}
          aria-current={t.href === active ? 'page' : undefined}
          className={cn(
            'rounded-pill px-4 py-[9px] text-[13px] font-semibold transition-colors',
            t.href === active ? 'bg-ink text-white' : 'text-muted hover:text-ink',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Section({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Panel
      as="section"
      className={cn('flex flex-col gap-1 p-5 text-[13px] sm:p-[22px]', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </Panel>
  );
}

/** Shown instead of a page the role may not open (the API refuses it anyway). */
export function NoAccess() {
  return (
    <Panel className="flex flex-col gap-2 p-8">
      <h2 className="text-xl font-semibold">Bu bo&apos;lim uchun huquq yo&apos;q</h2>
      <p className="text-sm text-muted">
        Kerak bo&apos;lsa, do&apos;kon egasidan rolingizni o&apos;zgartirishni so&apos;rang.
      </p>
    </Panel>
  );
}
