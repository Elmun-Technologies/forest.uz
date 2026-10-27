import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '../../../../components/auth-card';
import { LogoutButton } from '../../../../components/logout-button';
import { TotpCodeForm } from '../../../../components/totp-code-form';
import { getMe, stagePath } from '../../../../lib/api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Tasdiqlash kodi · Forest Admin' };

export default async function TotpLoginPage() {
  const me = await getMe();
  if (me?.stage !== 'totp') redirect(stagePath(me));
  return (
    <AuthCard
      title="Tasdiqlash kodi"
      lead={
        <>
          Parol to&apos;g&apos;ri. Endi autentifikator ilovasidagi (Google Authenticator, Authy va
          h.k.) kodni kiriting — <b className="text-ink">{me.staff.email}</b>.
        </>
      }
    >
      <TotpCodeForm submitLabel="Kirish" />
      <div className="flex items-center justify-between gap-3 border-t border-line-soft pt-4 text-[13px] text-muted">
        <span>Telefon yo&apos;qolganmi? Do&apos;kon egasi 2FA ni qayta o&apos;rnatadi.</span>
        <LogoutButton className="shrink-0 rounded-pill px-3 py-2 font-semibold text-ink hover:bg-canvas">
          Chiqish
        </LogoutButton>
      </div>
    </AuthCard>
  );
}
