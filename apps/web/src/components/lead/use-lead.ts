'use client';

import type { LeadResultDto } from '@forest/contracts';
import { parseUzPhone } from '@forest/contracts/core';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';

/** Visitor already left a phone in this browser → never show the exit popup again. */
export const LEAD_FLAG = 'fr_lead';

export function markLeadCaptured() {
  try {
    localStorage.setItem(LEAD_FLAG, '1');
  } catch {
    /* storage disabled — popup may reappear next session, acceptable */
  }
}

type Source = 'popup' | 'home' | 'footer' | 'selector';

/** Phone → POST /api/leads with inline validation and localized, non-blaming errors. */
export function useLead(source: Source) {
  const t = useTranslations('lead.errors');
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<LeadResultDto | null>(null);

  async function submit(): Promise<LeadResultDto | null> {
    const parsed = parseUzPhone(digits);
    if (!parsed.ok) {
      setError(t(parsed.error));
      return null;
    }
    setError(null);
    setPending(true);
    try {
      const res = await clientApi.leads.create({ phone: parsed.e164, source });
      markLeadCaptured();
      setResult(res);
      return res;
    } catch (e) {
      if (e instanceof ClientApiError && e.code === 'NETWORK') setError(t('network'));
      else if (e instanceof ClientApiError && e.status === 400 && e.message) setError(e.message);
      else setError(t('generic'));
      return null;
    } finally {
      setPending(false);
    }
  }

  return {
    digits,
    setDigits: (v: string) => {
      setDigits(v);
      if (error) setError(null);
    },
    error,
    pending,
    result,
    submit,
  };
}
