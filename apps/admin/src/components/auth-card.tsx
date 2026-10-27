import { Panel } from '@forest/ui';
import Image from 'next/image';
import type { ReactNode } from 'react';
import logo from '../../public/brand/forest-logo-green.png';

/** Centered card for login, TOTP and invite screens. */
export function AuthCard({
  title,
  lead,
  children,
  wide,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Panel
        className={`flex w-full flex-col gap-6 p-6 sm:p-9 ${wide ? 'max-w-[560px]' : 'max-w-[440px]'}`}
      >
        <div className="flex items-center justify-between">
          <Image src={logo} alt="Forest" width={104} priority />
          <span className="rounded-pill bg-sage px-2.5 py-1 text-[11px] font-bold tracking-[0.08em] text-forest">
            ADMIN
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-[28px] font-medium tracking-[-0.03em]">{title}</h1>
          {lead ? <p className="text-sm leading-relaxed text-muted">{lead}</p> : null}
        </div>
        {children}
      </Panel>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-sm bg-critical-bg px-4 py-3 text-[13px] font-medium text-critical"
    >
      {message}
    </p>
  );
}
