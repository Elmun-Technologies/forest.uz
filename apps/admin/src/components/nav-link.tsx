'use client';

import { cn } from '@forest/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '../lib/nav';
import { Icon } from './icon';

const base =
  'flex items-center gap-3 rounded-sm px-3 py-[11px] text-sm font-medium transition-colors';

export function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  if (!item.href) {
    return (
      <span
        aria-disabled="true"
        title="Tez orada"
        className={cn(base, 'cursor-default text-on-dark-muted/45')}
      >
        <Icon d={item.icon} />
        <span className="flex-1">
          {item.label}
          <span className="sr-only"> (tez orada)</span>
        </span>
      </span>
    );
  }
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className={cn(
        base,
        active ? 'bg-white text-ink' : 'text-on-dark-muted hover:bg-dark-2 hover:text-white',
      )}
    >
      <Icon d={item.icon} />
      <span className="flex-1">{item.label}</span>
    </Link>
  );
}
