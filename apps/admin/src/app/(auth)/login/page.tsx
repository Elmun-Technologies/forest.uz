import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '../../../components/auth-card';
import { getMe, stagePath } from '../../../lib/api';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Kirish · Forest Admin' };

export default async function LoginPage() {
  const me = await getMe();
  if (me) redirect(stagePath(me));
  return (
    <AuthCard title="Kirish" lead="Xodim email manzili va parolingiz bilan kiring.">
      <LoginForm />
    </AuthCard>
  );
}
