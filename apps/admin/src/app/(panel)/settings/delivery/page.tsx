import { type DeliverySettingsDto, hasPermission } from '@forest/contracts/core';
import type { Metadata } from 'next';
import { NoAccess } from '../../../../components/page';
import { SettingsHeader } from '../../../../components/settings-header';
import { DeliveryEditor } from '../../../../components/settings/delivery-editor';
import { adminGet, requireFullSession } from '../../../../lib/api';

export const metadata: Metadata = { title: 'Yetkazish · Forest Admin' };

/** A16 "Yetkazish" tab (`settings.delivery`, Owner/Manager): zones, rules, storefront preview. */
export default async function DeliverySettingsPage() {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'settings.delivery')) {
    return (
      <>
        <SettingsHeader me={me} active="/settings/delivery" />
        <NoAccess />
      </>
    );
  }
  const doc = await adminGet<DeliverySettingsDto>('/admin/settings/delivery');
  return (
    <>
      <SettingsHeader me={me} active="/settings/delivery" />
      <DeliveryEditor initial={doc} now={new Date().toISOString()} />
    </>
  );
}
