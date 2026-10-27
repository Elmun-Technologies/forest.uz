import type { PublicSettingsDto } from '@forest/contracts';
import { hasPermission } from '@forest/contracts/core';
import type { Metadata } from 'next';
import { NoAccess, PageHeader } from '../../../../components/page';
import { ManualOrderForm } from '../../../../components/orders/manual-order-form';
import { adminGet, requireFullSession } from '../../../../lib/api';

export const metadata: Metadata = { title: "Qo'lda buyurtma · Forest Admin" };

/** A6 "+ Qo'lda buyurtma": phone order, COD, priced by the API like a storefront checkout. */
export default async function NewOrderPage() {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'orders.edit'))
    return (
      <>
        <PageHeader title="Qo'lda buyurtma" />
        <NoAccess />
      </>
    );
  const settings = await adminGet<PublicSettingsDto>('/settings/public');
  return (
    <>
      <PageHeader
        title="Qo'lda buyurtma"
        subtitle="Telefon orqali buyurtma · naqd to'lov · narx va yetkazish sayt bilan bir xil hisoblanadi"
      />
      <ManualOrderForm
        zones={settings.delivery.zones.map((z) => ({
          key: z.key,
          name: z.name.uz,
          carrier: z.carrier,
          priceSoum: z.priceSoum,
          freeFromSoum: z.freeFromSoum,
        }))}
      />
    </>
  );
}
