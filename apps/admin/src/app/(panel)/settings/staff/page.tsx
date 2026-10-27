import {
  type AuditPageDto,
  hasPermission,
  matrixCell,
  RBAC_MATRIX_ROWS,
  STAFF_ROLES,
  type StaffDto,
} from '@forest/contracts/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuditList } from '../../../../components/audit-list';
import { NoAccess, Section } from '../../../../components/page';
import { SettingsHeader } from '../../../../components/settings-header';
import { adminGet, requireFullSession } from '../../../../lib/api';
import { EXTRA_MATRIX_ROWS, MATRIX_NOTE, MATRIX_ROW_LABEL, ROLE_LABEL } from '../../../../lib/copy';
import { StaffPanel } from './staff-panel';

export const metadata: Metadata = { title: 'Xodimlar · Forest Admin' };

export default async function StaffPage() {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'settings.staff')) {
    return (
      <>
        <SettingsHeader me={me} active="/settings/staff" />
        <NoAccess />
      </>
    );
  }
  const canAudit = hasPermission(me.staff.role, 'audit.view');
  const [staff, audit] = await Promise.all([
    adminGet<StaffDto[]>('/admin/staff'),
    canAudit ? adminGet<AuditPageDto>('/admin/audit?limit=5') : Promise.resolve(null),
  ]);

  const rows = [
    ...RBAC_MATRIX_ROWS.map((r) => ({
      label: MATRIX_ROW_LABEL[r.key],
      cells: STAFF_ROLES.map((role) => matrixCell(r, role)),
    })),
    ...EXTRA_MATRIX_ROWS.map((r) => ({
      label: r.label,
      cells: STAFF_ROLES.map((role) => matrixCell(r, role)),
    })),
  ];

  return (
    <>
      <SettingsHeader me={me} active="/settings/staff" />
      <StaffPanel staff={staff} meId={me.staff.id} />

      <Section title="Rollar va huquqlar">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="px-1 py-2 font-normal">
                  Huquq
                </th>
                {STAFF_ROLES.map((role) => (
                  <th key={role} scope="col" className="w-[90px] px-1 py-2 text-center font-normal">
                    {ROLE_LABEL[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-line-soft">
                  <th scope="row" className="px-1 py-2.5 font-semibold">
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td key={STAFF_ROLES[i]} className="px-1 py-2.5 text-center font-bold">
                      {cell === 'yes' ? (
                        <span className="text-good" aria-label="ha">
                          ✓
                        </span>
                      ) : cell === 'partial' ? (
                        <span className="text-[11px] text-warn">qisman</span>
                      ) : (
                        <span className="text-[#B9BEB2]" aria-label="yo'q">
                          —
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pt-2 text-xs leading-relaxed text-muted">{MATRIX_NOTE}</p>
      </Section>

      {audit ? (
        <Section
          title="Faoliyat jurnali"
          actions={
            <Link
              href="/settings/audit"
              prefetch={false}
              className="text-[13px] font-semibold text-forest underline underline-offset-2"
            >
              Hammasi
            </Link>
          }
        >
          <AuditList items={audit.items} compact />
        </Section>
      ) : null}
    </>
  );
}
