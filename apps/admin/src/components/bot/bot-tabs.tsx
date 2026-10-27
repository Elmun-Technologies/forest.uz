import { hasPermission, type StaffRole } from '@forest/contracts/core';
import { TabLinks } from '../page';
import { COPY } from './copy';

/** A12 sub-pages the role may open: overview + messages (`bot.edit`), inbox (`bot.inbox`). */
export function BotTabs({ role, active }: { role: StaffRole; active: string }) {
  const tabs = [
    ...(hasPermission(role, 'bot.edit') ? [{ href: '/bot', label: COPY.tabs.overview }] : []),
    ...(hasPermission(role, 'bot.inbox') ? [{ href: '/bot/inbox', label: COPY.tabs.inbox }] : []),
    ...(hasPermission(role, 'bot.edit')
      ? [{ href: '/bot/messages', label: COPY.tabs.messages }]
      : []),
  ];
  return tabs.length > 1 ? <TabLinks tabs={tabs} active={active} label="Telegram bot" /> : null;
}
