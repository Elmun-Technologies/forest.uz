import { hasPermission, type WebhookListDto } from '@forest/contracts/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { WebhooksManager } from '../../../../components/automation/webhooks-manager';
import { NoAccess, PageHeader } from '../../../../components/page';
import { adminGet, requireFullSession } from '../../../../lib/api';

export const metadata: Metadata = { title: 'Webhooklar · Forest Admin' };

/** Outbound webhooks (A10): view `integrations.view`, manage `integrations.keys` (Owner). */
export default async function WebhooksPage() {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'integrations.view'))
    return (
      <>
        <PageHeader title="Webhooklar" />
        <NoAccess />
      </>
    );
  const list = await adminGet<WebhookListDto>('/admin/webhooks');
  return (
    <>
      <PageHeader
        title="Webhooklar"
        subtitle={
          <>
            <Link href="/integrations" prefetch={false} className="hover:text-ink">
              Integratsiyalar
            </Link>{' '}
            / Webhooklar · imzolangan hodisalar boshqa tizimlarga
          </>
        }
      />
      <WebhooksManager list={list} canKeys={hasPermission(me.staff.role, 'integrations.keys')} />
    </>
  );
}
