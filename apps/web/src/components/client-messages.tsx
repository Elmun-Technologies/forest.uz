import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';

/** Namespaces every page's client islands need (header, cart, popup, consent, cards…). */
export const GLOBAL_NAMESPACES = [
  'common',
  'header',
  'footer',
  'fab',
  'cart',
  'consent',
  'lead',
  'popup',
  'card',
];

/**
 * Ships only the given message namespaces (plus the global ones) to client components, so a page
 * doesn't download copy for other screens. Wrap page-level islands: `<ClientMessages namespaces={['catalog']}>`.
 */
export async function ClientMessages({
  namespaces = [],
  children,
}: {
  namespaces?: string[];
  children: ReactNode;
}) {
  const all = await getMessages();
  const keep = new Set([...GLOBAL_NAMESPACES, ...namespaces]);
  const messages = Object.fromEntries(Object.entries(all).filter(([ns]) => keep.has(ns)));
  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
