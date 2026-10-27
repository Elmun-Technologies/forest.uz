'use client';

import { Button, Panel } from '@forest/ui';
import { useState } from 'react';
import { SECRET_ONCE } from './copy';

/** A freshly generated secret, shown once with a copy button. */
export function SecretOnce({
  label,
  value,
  onDone,
}: {
  label: string;
  value: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Panel
      role="alert"
      className="flex flex-col gap-2 border border-warn-bg p-4 text-[13px]"
      data-testid="secret-once"
    >
      <b className="font-semibold">{label}</b>
      <code
        className="rounded-sm bg-off px-3 py-2 font-mono text-xs break-all"
        data-testid="secret-value"
      >
        {value}
      </code>
      <p className="text-muted">{SECRET_ONCE}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard?.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? 'Nusxa olindi ✓' : 'Nusxa olish'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Saqladim
        </Button>
      </div>
    </Panel>
  );
}
