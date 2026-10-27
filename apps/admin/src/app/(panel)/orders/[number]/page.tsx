import {
  type AdminOrderDetailDto,
  hasPermission,
  type OrderJourneyDto,
} from '@forest/contracts/core';
import { Panel } from '@forest/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OrderJourney } from '../../../../components/analytics/order-journey';
import { NoAccess, PageHeader } from '../../../../components/page';
import { AutoRefresh } from '../../../../components/orders/auto-refresh';
import { OrderDetail } from '../../../../components/orders/order-detail';
import { AdminApiError, adminGet, requireFullSession } from '../../../../lib/api';

type Params = { number: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { number } = await params;
  return { title: `${decodeURIComponent(number)} · Buyurtma · Forest Admin` };
}

/** A7 Buyurtma: detail, stepper with the API's next actions, payment, delivery, journal. */
export default async function OrderPage({ params }: { params: Promise<Params> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'orders.view'))
    return (
      <>
        <PageHeader title="Buyurtma" />
        <NoAccess />
      </>
    );
  const number = decodeURIComponent((await params).number);
  let order: AdminOrderDetailDto;
  try {
    order = await adminGet<AdminOrderDetailDto>(`/admin/orders/${encodeURIComponent(number)}`);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    throw e;
  }
  // A7 journey needs analytics.view too; a failure must not break the order page.
  const journey = hasPermission(me.staff.role, 'analytics.view')
    ? await adminGet<OrderJourneyDto>(
        `/admin/analytics/orders/${encodeURIComponent(number)}/journey`,
      ).catch(() => null)
    : null;
  return (
    <>
      <AutoRefresh seconds={60} />
      <OrderDetail
        key={`${order.status}-${order.timeline.length}`}
        order={order}
        canCancelPaidClaim={hasPermission(me.staff.role, 'orders.cancel_refund')}
        journey={
          journey ? (
            <Panel className="p-5">
              <OrderJourney j={journey} />
            </Panel>
          ) : null
        }
      />
    </>
  );
}

/** Never cached: every order view is personal (permissions) and live. */
export const dynamic = 'force-dynamic';
