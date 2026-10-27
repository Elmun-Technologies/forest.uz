'use client';

import type { TotpSetupDto } from '@forest/contracts/core';
import { Button } from '@forest/ui';
import { useState } from 'react';
import { FormError } from '../../../../components/auth-card';
import { QrCode } from '../../../../components/qr-code';
import { TotpCodeForm } from '../../../../components/totp-code-form';
import { adminFetch, errorText } from '../../../../lib/client-api';

/**
 * Step 1 asks the API for a fresh secret (explicit click: a mount effect would run twice in dev
 * and could show a secret the server already replaced). Step 2 verifies the first code.
 */
export function TotpSetup({ email }: { email: string }) {
  const [setup, setSetup] = useState<TotpSetupDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setSetup(await adminFetch<TotpSetupDto>('/admin/auth/totp/setup', { method: 'POST' }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-4">
        <FormError message={error} />
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
          <li>Ilovani telefoningizga o&apos;rnating.</li>
          <li>«QR kodni olish» tugmasini bosing va kodni ilovada skanerlang.</li>
          <li>Ilova ko&apos;rsatgan 6 xonali kodni kiriting.</li>
        </ol>
        <Button size="lg" block onClick={start} loading={busy}>
          QR kodni olish
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <QrCode
          value={setup.otpauthUri}
          label={`Forest Admin 2FA QR kodi: ${email}`}
          className="size-[200px] shrink-0 rounded-sm border border-line"
        />
        <div className="flex min-w-0 flex-col gap-2 text-[13px]">
          <p className="text-muted">
            Skanerlab bo&apos;lmasa, kalitni ilovaga qo&apos;lda kiriting:
          </p>
          <code
            data-testid="totp-secret"
            className="rounded-xs bg-canvas px-3 py-2 font-mono text-[15px] tracking-[0.12em] break-all text-ink"
          >
            {setup.secret.match(/.{1,4}/g)?.join(' ')}
          </code>
          <a
            href={setup.otpauthUri}
            className="font-semibold text-forest underline underline-offset-2"
          >
            Shu qurilmadagi ilovada ochish
          </a>
          <p className="text-muted">
            Kalit faqat hozir ko&apos;rsatiladi — uni hech kimga bermang.
          </p>
        </div>
      </div>
      <TotpCodeForm submitLabel="2FA ni yoqish" />
    </div>
  );
}
