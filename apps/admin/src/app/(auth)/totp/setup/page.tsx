import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '../../../../components/auth-card';
import { getMe, stagePath } from '../../../../lib/api';
import { TotpSetup } from './totp-setup';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '2FA ni yoqish · Forest Admin' };

/**
 * TOTP enrolment: mandatory for Owner/Manager (stage `setup`), voluntary for the other roles
 * from a full session without TOTP.
 */
export default async function TotpSetupPage() {
  const me = await getMe();
  const allowed = me && (me.stage === 'setup' || (me.stage === 'full' && !me.totp.enabled));
  if (!allowed) redirect(stagePath(me));
  return (
    <AuthCard
      wide
      title="Ikki bosqichli himoya (2FA)"
      lead={
        me.totp.required
          ? "Sizning rolingiz uchun 2FA majburiy. Telefoningizga autentifikator ilovasini (Google Authenticator, Authy, 1Password…) o'rnating va quyidagi QR kodni skanerlang."
          : "2FA hisobingizni parol o'g'irlanganda ham himoya qiladi. Autentifikator ilovasida QR kodni skanerlang."
      }
    >
      <TotpSetup email={me.staff.email} />
    </AuthCard>
  );
}
