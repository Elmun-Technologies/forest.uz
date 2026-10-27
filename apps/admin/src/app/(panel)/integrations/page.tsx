import {
  type ApiKeyDto,
  hasPermission,
  type IntegrationsHubDto,
  type WebhookListDto,
} from '@forest/contracts/core';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DeveloperSummary } from '../../../components/automation/developer-summary';
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
  const [hub, hooks, keys] = await Promise.all([
    adminGet<IntegrationsHubDto>('/admin/integrations'),
    adminGet<WebhookListDto>('/admin/webhooks'),
    adminGet<ApiKeyDto[]>('/admin/api-keys'),
  ]);
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
        <IntegrationsHub
          hub={hub}
          canKeys={hasPermission(me.staff.role, 'integrations.keys')}
          developer={<DeveloperSummary hooks={hooks} keys={keys} />}
        />
      </Suspense>
    </>
  );
}
