import { redirect } from 'next/navigation';
import { NoAccess, PageHeader } from '../../../components/page';
import { requireFullSession } from '../../../lib/api';
import { settingsTabsFor } from '../../../lib/nav';

/** `/settings` → the first settings tab this role may open. */
export default async function SettingsIndex() {
  const me = await requireFullSession();
  const first = settingsTabsFor(me.staff.role)[0];
  if (first) redirect(first.href);
  return (
    <>
      <PageHeader title="Sozlamalar" />
      <NoAccess />
    </>
  );
}
