import { hasPermission, type IntegrationsHubDto } from '@forest/contracts/core';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { IntegrationsHub } from '../../../components/integrations/integrations-hub';
import { NoAccess, PageHeader } from '../../../components/page';
import { adminGet, requireFullSession } from '../../../lib/api';

export const metadata: Metadata = { title: 'Integratsiyalar · Forest Admin' };

/** A10 Integrations hub (`integrations.view` O/M; keys `integrations.keys` Owner). */
export default async function IntegrationsPage() {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'integrations.view')) {
    return (
      <>
        <PageHeader title="Integratsiyalar markazi" />
        <NoAccess />
      </>
    );
  }
  const hub = await adminGet<IntegrationsHubDto>('/admin/integrations');
  return (
    <>
      <PageHeader
        title="Integratsiyalar markazi"
        subtitle="Hammasi bir joydan ulanadi · kalitlar serverda shifrlangan · kodga tegish shart emas"
        actions={
          <span
            className="rounded-pill bg-panel px-4 py-2 text-[13px] font-semibold"
            data-testid="integrations-connected"
          >
            {hub.connected} / {hub.total} ulangan
          </span>
        }
      />
      <Suspense>
        <IntegrationsHub hub={hub} canKeys={hasPermission(me.staff.role, 'integrations.keys')} />
      </Suspense>
    </>
  );
}
