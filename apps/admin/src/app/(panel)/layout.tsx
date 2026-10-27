import type { ReactNode } from 'react';
import { Shell } from '../../components/shell';
import { Sidebar } from '../../components/sidebar';
import { requireFullSession } from '../../lib/api';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.APP_URL ?? 'http://localhost:3000';

/** Every panel page needs a full session (password + TOTP where required). */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const me = await requireFullSession();
  return <Shell sidebar={<Sidebar me={me} siteUrl={SITE_URL} />}>{children}</Shell>;
}
