'use client';

import { type ReactNode, useState } from 'react';
import { adminFetch } from '../lib/client-api';
import { Icon, ICONS } from './icon';

export function LogoutButton({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await adminFetch('/admin/auth/logout', { method: 'POST' });
    } catch {
      // Session already gone (expired/revoked): the login page is the right place either way.
    }
    window.location.assign('/login');
  }
  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      aria-label={children ? undefined : 'Chiqish'}
      title="Chiqish"
      className={
        className ??
        'grid size-9 shrink-0 place-items-center rounded-full text-on-dark-muted transition-colors hover:bg-dark-2 hover:text-white disabled:opacity-50'
      }
    >
      {children ?? <Icon d={ICONS.logout} size={17} />}
    </button>
  );
}
