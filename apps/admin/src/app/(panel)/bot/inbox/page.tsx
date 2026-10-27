import {
  type AdminBotConversationDto,
  type AdminBotConversationListDto,
  BOT_CONVERSATION_STATUSES,
  hasPermission,
} from '@forest/contracts/core';
import type { Metadata } from 'next';
import { BotTabs } from '../../../../components/bot/bot-tabs';
import { COPY } from '../../../../components/bot/copy';
import { InboxView } from '../../../../components/bot/inbox-view';
import { NoAccess, PageHeader } from '../../../../components/page';
import { AdminApiError, adminGet, requireFullSession } from '../../../../lib/api';

export const metadata: Metadata = { title: 'Operator inbox · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;

/** A12 operator inbox (`bot.inbox`): status tabs, conversation list, thread with reply (`?c=`). */
export default async function BotInboxPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'bot.inbox')) {
    return (
      <>
        <PageHeader title={COPY.inboxTitle} />
        <NoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const rawStatus = typeof sp.status === 'string' ? sp.status : 'all';
  const status = (BOT_CONVERSATION_STATUSES as readonly string[]).includes(rawStatus)
    ? rawStatus
    : 'all';
  const selectedId = typeof sp.c === 'string' ? sp.c.slice(0, 64) : null;
  const [list, selected] = await Promise.all([
    adminGet<AdminBotConversationListDto>(`/admin/bot/conversations?status=${status}&limit=40`),
    selectedId
      ? adminGet<AdminBotConversationDto>(
          `/admin/bot/conversations/${encodeURIComponent(selectedId)}`,
        ).catch((e: unknown) => {
          if (e instanceof AdminApiError && e.status === 404) return null;
          throw e;
        })
      : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        title={COPY.inboxTitle}
        subtitle={COPY.subtitle}
        actions={<BotTabs role={me.staff.role} active="/bot/inbox" />}
      />
      <InboxView
        key={`${status}:${selectedId ?? ''}`}
        list={list}
        status={status}
        selected={selected}
        canSeeCustomers={hasPermission(me.staff.role, 'customers.view')}
      />
    </>
  );
}
