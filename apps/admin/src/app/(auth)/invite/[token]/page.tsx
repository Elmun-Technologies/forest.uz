import type { InviteInfoDto } from '@forest/contracts/core';
import type { Metadata } from 'next';
import { AuthCard } from '../../../../components/auth-card';
import { AdminApiError, adminGet } from '../../../../lib/api';
import { ROLE_LABEL } from '../../../../lib/copy';
import { AcceptInviteForm } from './accept-invite-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Taklif · Forest Admin',
  // The token is in the URL: never send it to other sites.
  referrer: 'no-referrer',
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invite: InviteInfoDto | null = null;
  try {
    invite = await adminGet<InviteInfoDto>(`/admin/auth/invite/${encodeURIComponent(token)}`);
  } catch (e) {
    if (!(e instanceof AdminApiError && e.status < 500)) throw e;
  }
  if (!invite) {
    return (
      <AuthCard
        title="Havola ishlamaydi"
        lead="Taklif havolasi eskirgan yoki allaqachon ishlatilgan. Do'kon egasidan yangi havola so'rang."
      >
        <a href="/login" className="text-sm font-semibold text-forest underline underline-offset-2">
          Kirish sahifasiga
        </a>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={`Xush kelibsiz, ${invite.name}!`}
      lead={
        <>
          Siz Forest admin paneliga <b className="text-ink">{ROLE_LABEL[invite.role]}</b> sifatida
          taklif qilindingiz ({invite.email}). Parol o&apos;rnating
          {invite.totpRequired ? ', keyin ikki bosqichli himoyani (2FA) yoqasiz.' : '.'}
        </>
      }
    >
      <AcceptInviteForm token={token} email={invite.email} name={invite.name} />
    </AuthCard>
  );
}
