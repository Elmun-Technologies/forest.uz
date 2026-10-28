import { type ApiKeyDto, hasPermission } from '@forest/contracts/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ApiKeysManager } from '../../../../components/automation/api-keys-manager';
import { NoAccess, PageHeader } from '../../../../components/page';
import { adminGet, requireFullSession } from '../../../../lib/api';

export const metadata: Metadata = { title: 'API kalitlar · Forest Admin' };

const API_PUBLIC = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/** Partner REST API keys (A10): view `integrations.view`, create/revoke `integrations.keys`. */
export default async function ApiKeysPage() {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'integrations.view'))
    return (
      <>
        <PageHeader title="API kalitlar" />
        <NoAccess />
      </>
    );
  const keys = await adminGet<ApiKeyDto[]>('/admin/api-keys');
  return (
    <>
      <PageHeader
        title="API kalitlar"
        subtitle={
          <>
            <Link href="/integrations" prefetch={false} className="hover:text-ink">
              Integratsiyalar
            </Link>{' '}
            / API kalitlar · n8n, Make, Zapier uchun
          </>
        }
      />
      <ApiKeysManager
        keys={keys}
        canKeys={hasPermission(me.staff.role, 'integrations.keys')}
        apiBase={API_PUBLIC}
      />
    </>
  );
}
