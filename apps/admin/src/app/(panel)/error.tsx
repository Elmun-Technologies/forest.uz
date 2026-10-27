'use client';

import { buttonClasses, Panel } from '@forest/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition } from 'react';
import { PAGE_ERROR } from '../../lib/copy';

/**
 * Panel error boundary: an API 4xx/5xx during a page's server render (stale `?cursor=`, garbage
 * filters, API restart) shows this instead of Next's generic "Application error". The sidebar
 * (layout) stays usable.
 */
export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  // A server-render error needs fresh RSC data, not only a client re-render.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <Panel as="section" role="alert" className="flex flex-col items-start gap-3 p-8 text-[13px]">
      <h1 className="text-2xl font-medium tracking-[-0.03em]">{PAGE_ERROR.title}</h1>
      <p className="max-w-[560px] text-muted">{PAGE_ERROR.text}</p>
      {error.digest ? (
        <p className="text-xs text-subtle">
          {PAGE_ERROR.code}: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={retry} className={buttonClasses('primary', 'md')}>
          {PAGE_ERROR.retry}
        </button>
        <Link href="/" prefetch={false} className={buttonClasses('outline', 'md')}>
          {PAGE_ERROR.back}
        </Link>
      </div>
    </Panel>
  );
}
