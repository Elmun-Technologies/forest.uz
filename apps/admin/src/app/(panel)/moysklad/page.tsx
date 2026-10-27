import {
  hasPermission,
  type MoyskladLogPageDto,
  type MoyskladStatusDto,
} from '@forest/contracts/core';
import type { Metadata } from 'next';
import { MoyskladPanel } from '../../../components/moysklad/moysklad-panel';
import { NoAccess, PageHeader } from '../../../components/page';
import { adminGet, requireFullSession } from '../../../lib/api';

export const metadata: Metadata = { title: 'MoySklad · Forest Admin' };

/** A13 MoySklad (`moysklad.sync` O/M/W; settings `moysklad.edit` O/M; secret URL Owner). */
export default async function MoyskladPage() {
  const me = await requireFullSession();
  const header = (
    <PageHeader
      title="MoySklad sinxronlash"
      subtitle="Ombor, narx va qoldiq uchun yagona manba · buyurtmalar MoySklad'ga yuboriladi"
    />
  );
  if (!hasPermission(me.staff.role, 'moysklad.sync')) {
    return (
      <>
        {header}
        <NoAccess />
      </>
    );
  }
  const [status, log] = await Promise.all([
    adminGet<MoyskladStatusDto>('/admin/moysklad/status'),
    adminGet<MoyskladLogPageDto>('/admin/moysklad/log?limit=30'),
  ]);
  return (
    <>
      {header}
      <MoyskladPanel
        status={status}
        log={log}
        canEdit={hasPermission(me.staff.role, 'moysklad.edit')}
        canReveal={
          hasPermission(me.staff.role, 'moysklad.edit') &&
          hasPermission(me.staff.role, 'integrations.keys')
        }
      />
    </>
  );
}
