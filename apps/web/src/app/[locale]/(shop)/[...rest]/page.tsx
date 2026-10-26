import type { Metadata } from 'next';
import { notFoundWithRedirect } from '@/lib/not-found';

export const metadata: Metadata = { robots: { index: false } };

/** Any unknown storefront URL: admin redirect if one exists, otherwise a logged 404. */
export default async function CatchAll({
  params,
}: {
  params: Promise<{ locale: string; rest: string[] }>;
}) {
  const { locale, rest } = await params;
  return notFoundWithRedirect(`/${locale}/${rest.join('/')}`);
}
