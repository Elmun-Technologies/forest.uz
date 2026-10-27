'use client';

import {
  STAFF_ROLES,
  type StaffDto,
  type StaffInviteResultDto,
  type StaffRole,
} from '@forest/contracts/core';
import { Badge, Button, cn, Field, Input, Panel } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { FormError } from '../../../../components/auth-card';
import { adminFetch, errorText } from '../../../../lib/client-api';
import { ROLE_LABEL } from '../../../../lib/copy';
import { formatLastSeen, initials } from '../../../../lib/format';

/** A16 "Xodimlar": list + invite + role/active changes + TOTP reset (Owner only). */
export function StaffPanel({ staff, meId }: { staff: StaffDto[]; meId: string }) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState<StaffInviteResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, run: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await run();
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyId(null);
    }
  }

  const changeRole = (s: StaffDto, role: StaffRole) => {
    if (!window.confirm(`${s.name}: rol «${ROLE_LABEL[role]}» bo'lsinmi?`)) return router.refresh();
    return act(s.id, () => adminFetch(`/admin/staff/${s.id}`, { method: 'PATCH', body: { role } }));
  };
  const toggleActive = (s: StaffDto) => {
    const q = s.active
      ? `${s.name} panelga kira olmaydi va barcha seanslari yopiladi. Davom etasizmi?`
      : `${s.name} yana panelga kira oladi. Davom etasizmi?`;
    if (!window.confirm(q)) return;
    return act(s.id, () =>
      adminFetch(`/admin/staff/${s.id}`, { method: 'PATCH', body: { active: !s.active } }),
    );
  };
  const resetTotp = (s: StaffDto) => {
    if (
      !window.confirm(
        `${s.name} uchun 2FA qayta o'rnatilsinmi? Keyingi kirishda yangi QR kod beriladi.`,
      )
    )
      return;
    return act(s.id, () => adminFetch(`/admin/staff/${s.id}/reset-totp`, { method: 'POST' }));
  };
  const reissue = (s: StaffDto) =>
    act(s.id, async () =>
      setInvite(
        await adminFetch<StaffInviteResultDto>(`/admin/staff/${s.id}/invite`, { method: 'POST' }),
      ),
    );

  return (
    <Panel as="section" className="flex flex-col gap-1 p-5 text-[13px] sm:p-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <h2 className="text-xl font-semibold">Xodimlar</h2>
        <Button size="sm" onClick={() => setInviting((v) => !v)} aria-expanded={inviting}>
          + Taklif qilish
        </Button>
      </div>

      {inviting ? (
        <InviteForm
          onDone={(r) => {
            setInvite(r);
            setInviting(false);
            router.refresh();
          }}
        />
      ) : null}
      {invite ? <InviteLink result={invite} onClose={() => setInvite(null)} /> : null}
      <FormError message={error} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th scope="col" className="px-1 py-2 font-normal">
                Xodim
              </th>
              <th scope="col" className="w-[150px] px-1 py-2 font-normal">
                Rol
              </th>
              <th scope="col" className="px-1 py-2 font-normal">
                Oxirgi kirish
              </th>
              <th scope="col" className="w-[90px] px-1 py-2 font-normal">
                2FA
              </th>
              <th scope="col" className="px-1 py-2 text-right font-normal">
                <span className="sr-only">Amallar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const self = s.id === meId;
              const busy = busyId === s.id;
              return (
                <tr
                  key={s.id}
                  className={cn('border-b border-line-soft', !s.active && 'opacity-55')}
                  data-testid="staff-row"
                >
                  <td className="px-1 py-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden
                        className="grid size-[34px] shrink-0 place-items-center rounded-full bg-sage text-xs font-bold"
                      >
                        {initials(s.name)}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <b className="font-semibold">
                          {s.name}
                          {self ? <span className="font-normal text-muted"> (siz)</span> : null}
                        </b>
                        <span className="truncate text-xs text-muted">
                          {s.email}
                          {s.phone ? ` · ${s.phone}` : ''}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-1 py-3">
                    {self || !s.active ? (
                      <span className="rounded-pill bg-canvas px-2.5 py-[5px] text-xs font-semibold">
                        {ROLE_LABEL[s.role]}
                      </span>
                    ) : (
                      <select
                        aria-label={`${s.name} roli`}
                        value={s.role}
                        disabled={busy}
                        onChange={(e) => void changeRole(s, e.target.value as StaffRole)}
                        className="h-8 rounded-pill bg-canvas px-2.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-forest"
                      >
                        {STAFF_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-1 py-3 text-muted">
                    {!s.active ? (
                      'Faol emas'
                    ) : s.invitePending ? (
                      <Badge tone="warn">Taklif yuborilgan</Badge>
                    ) : (
                      formatLastSeen(s.lastLoginAt)
                    )}
                  </td>
                  <td className="px-1 py-3">
                    <Badge
                      tone={s.totpEnabled ? 'good' : 'critical'}
                      className="h-auto py-1 text-[11px]"
                    >
                      {s.totpEnabled ? 'Yoniq' : "O'chiq"}
                    </Badge>
                  </td>
                  <td className="px-1 py-3">
                    {self ? null : (
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {s.invitePending && s.active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void reissue(s)}
                          >
                            Yangi havola
                          </Button>
                        ) : null}
                        {s.totpEnabled && s.active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void resetTotp(s)}
                          >
                            2FA ni tiklash
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant={s.active ? 'danger' : 'outline'}
                          disabled={busy}
                          onClick={() => void toggleActive(s)}
                        >
                          {s.active ? "O'chirish" : 'Faollashtirish'}
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function InviteForm({ onDone }: { onDone: (r: StaffInviteResultDto) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      onDone(
        await adminFetch<StaffInviteResultDto>('/admin/staff', {
          method: 'POST',
          body: {
            name: String(f.get('name') ?? ''),
            email: String(f.get('email') ?? ''),
            role: String(f.get('role') ?? ''),
            phone: String(f.get('phone') ?? ''),
          },
        }),
      );
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-3 grid gap-3 rounded-md bg-off p-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Xodimni taklif qilish"
    >
      <div className="sm:col-span-2 lg:col-span-4">
        <FormError message={error} />
      </div>
      <Field label="Ism">{(p) => <Input {...p} name="name" required minLength={2} />}</Field>
      <Field label="Email">
        {(p) => <Input {...p} name="email" type="email" required autoComplete="off" />}
      </Field>
      <Field label="Rol">
        {(p) => (
          <select
            {...p}
            name="role"
            defaultValue="OPERATOR"
            className="h-[52px] w-full rounded-sm border border-line bg-panel px-4 text-[15px] focus:border-ink focus:outline-none"
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Telefon (ixtiyoriy)">
        {(p) => <Input {...p} name="phone" type="tel" inputMode="tel" placeholder="90 123 45 67" />}
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="submit" loading={busy}>
          Taklif havolasini yaratish
        </Button>
        <span className="text-xs text-muted">
          Havola 72 soat ishlaydi va faqat bir marta ko&apos;rsatiladi.
        </span>
      </div>
    </form>
  );
}

function InviteLink({ result, onClose }: { result: StaffInviteResultDto; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div role="status" className="mb-3 flex flex-col gap-2 rounded-md bg-good-bg p-4 text-good">
      <b className="font-semibold">
        {result.staff.name} uchun taklif havolasi tayyor — uni xodimga xavfsiz kanal orqali
        yuboring.
      </b>
      <div className="flex flex-wrap items-center gap-2">
        <code
          data-testid="invite-url"
          className="min-w-0 flex-1 rounded-xs bg-panel px-3 py-2 font-mono text-xs break-all text-ink"
        >
          {result.inviteUrl}
        </code>
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? 'Nusxa olindi' : 'Nusxa olish'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Yopish
        </Button>
      </div>
      <span className="text-xs">
        Bu havola qayta ko&apos;rsatilmaydi; kerak bo&apos;lsa «Yangi havola» yarating.
      </span>
    </div>
  );
}
