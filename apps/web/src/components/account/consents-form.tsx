'use client';

import type { ConsentsDto } from '@forest/contracts';
import { Switch } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { clientApi } from '@/lib/client-api';

const KEYS = ['smsMarketing', 'telegram', 'adsMatching'] as const;

/** Marketing opt-in/opt-out per channel (PATCH /me/consents). Service messages need no consent. */
export function ConsentsForm({ initial }: { initial: ConsentsDto }) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const toast = useToast();
  const [value, setValue] = useState(initial);
  const id = useId();

  async function change(key: (typeof KEYS)[number], on: boolean) {
    const prev = value;
    setValue({ ...value, [key]: on });
    try {
      setValue(await clientApi.me.consents({ [key]: on }));
      toast(t('saved'), 'good');
    } catch {
      setValue(prev);
      toast(tc('generic'), 'critical');
    }
  }

  return (
    <ul className="flex flex-col divide-y divide-line-soft">
      {KEYS.map((k) => (
        <li key={k} className="flex items-center justify-between gap-6 py-4">
          <span className="flex flex-col gap-0.5">
            <label htmlFor={`${id}-${k}`} className="font-semibold">
              {t(`consents.${k}`)}
            </label>
            <span id={`${id}-${k}-hint`} className="text-[13px] text-muted">
              {t(`consents.${k}Hint`)}
            </span>
          </span>
          <Switch
            id={`${id}-${k}`}
            checked={value[k]}
            onCheckedChange={(on) => void change(k, on)}
            aria-describedby={`${id}-${k}-hint`}
            data-testid={`consent-${k}`}
          />
        </li>
      ))}
    </ul>
  );
}
