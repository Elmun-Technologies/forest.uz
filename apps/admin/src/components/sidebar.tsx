import type { AdminMeDto } from '@forest/contracts/core';
import { Badge } from '@forest/ui';
import Image from 'next/image';
import logoWhite from '../../public/brand/forest-logo-white.png';
import { ROLE_HINT } from '../lib/copy';
import { initials } from '../lib/format';
import { navFor } from '../lib/nav';
import { Icon, ICONS } from './icon';
import { LogoutButton } from './logout-button';
import { NavLink } from './nav-link';

/** Dark admin sidebar (design `AdminNav`): only the items the role may use. */
export function Sidebar({ me, siteUrl }: { me: AdminMeDto; siteUrl: string }) {
  const groups = navFor(me.staff.role);
  return (
    <nav
      aria-label="Admin menyusi"
      className="flex w-full flex-1 flex-col gap-[18px] rounded-lg bg-ink px-3.5 py-[22px] text-on-dark-muted"
    >
      <div className="flex items-center justify-between px-2">
        <Image src={logoWhite} alt="Forest" width={104} priority />
        <Badge className="bg-forest tracking-[0.08em] text-sage" tone="dark">
          ADMIN
        </Badge>
      </div>

      {/* Global search arrives with the orders/customers lists; shown disabled, not faked. */}
      <label
        className="flex h-[42px] cursor-not-allowed items-center gap-2 rounded-sm bg-dark-2 px-3 opacity-70"
        title="Qidiruv tez orada"
      >
        <Icon d={ICONS.search} size={16} className="text-subtle" />
        <span className="sr-only">Qidiruv</span>
        <input
          disabled
          placeholder="Buyurtma, mijoz, telefon"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-white placeholder:text-subtle disabled:cursor-not-allowed"
        />
      </label>

      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <span className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.1em] text-[#6E7768] uppercase">
            {g.label}
          </span>
          {g.items.map((item) => (
            <NavLink key={item.id} item={item} />
          ))}
        </div>
      ))}

      <div className="mt-auto flex flex-col gap-2.5">
        <a
          href={siteUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-sm border border-dark-3 px-3 py-[11px] text-[13px] font-medium text-white hover:border-on-dark-subtle"
        >
          <Icon d={ICONS.external} size={16} />
          Saytni ochish
        </a>
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-full bg-sage text-sm font-bold text-ink"
          >
            {initials(me.staff.name)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col text-[13px] leading-[1.3]">
            <b className="truncate font-semibold text-white" data-testid="staff-name">
              {me.staff.name}
            </b>
            <span className="truncate text-xs">{ROLE_HINT[me.staff.role]}</span>
          </span>
          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}
