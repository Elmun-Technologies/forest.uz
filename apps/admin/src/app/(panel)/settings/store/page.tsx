import { hasPermission, type StoreSettingsDto } from '@forest/contracts/core';
import type { Metadata } from 'next';
import { NoAccess } from '../../../../components/page';
import { SettingsHeader } from '../../../../components/settings-header';
import { StoreForm } from '../../../../components/settings/store-form';
import { adminGet, requireFullSession } from '../../../../lib/api';

export const metadata: Metadata = { title: "Do'kon · Forest Admin" };

/** A16 "Do'kon" tab (`settings.store`, Owner). */
export default async function StoreSettingsPage() {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'settings.store')) {
    return (
      <>
        <SettingsHeader me={me} active="/settings/store" />
        <NoAccess />
      </>
    );
  }
  const store = await adminGet<StoreSettingsDto>('/admin/settings/store');
  return (
    <>
      <SettingsHeader me={me} active="/settings/store" />
      <StoreForm initial={store} />
    </>
  );
}
