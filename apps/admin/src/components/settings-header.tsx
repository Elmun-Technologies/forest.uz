import type { AdminMeDto } from '@forest/contracts/core';
import { settingsTabsFor } from '../lib/nav';
import { PageHeader, TabLinks } from './page';

/** A16 header: title + tabs of the settings pages that exist and the role may open. */
export function SettingsHeader({ me, active }: { me: AdminMeDto; active: string }) {
  const tabs = settingsTabsFor(me.staff.role);
  return (
    <PageHeader
      title="Sozlamalar"
      subtitle="Do'kon, xodimlar va yetkazish qoidalari"
      actions={tabs.length > 1 ? <TabLinks tabs={tabs} active={active} label="Bo'limlar" /> : null}
    />
  );
}
