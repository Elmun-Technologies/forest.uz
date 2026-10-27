'use client';

import type { AiDraftStatusDto } from '@forest/contracts/core';
import { Panel, Switch } from '@forest/ui';
import { useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';

/**
 * A10 "AI qoralamalar": operator reply drafts send the customer's latest chat message to Anthropic
 * (servers outside Uzbekistan), so they are off by default and only the Owner switches them on
 * (`PUT /admin/ai/settings`, audited). Product/SEO drafts carry no customer data.
 */
export function AiSettingsPanel({
  status: initial,
  canKeys,
}: {
  status: AiDraftStatusDto;
  canKeys: boolean;
}) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(replyDrafts: boolean) {
    if (
      replyDrafts &&
      !window.confirm(
        'Mijozning oxirgi xabari Anthropic (AQSh) serveriga yuboriladi. Yurist bilan kelishilganmi?',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      setStatus(
        await adminFetch<AiDraftStatusDto>('/admin/ai/settings', {
          method: 'PUT',
          body: { replyDrafts },
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      as="section"
      className="flex flex-col gap-2 p-5 text-[13px] sm:p-[22px]"
      data-testid="ai-settings"
    >
      <h2 className="text-xl font-semibold">AI qoralamalar (Claude)</h2>
      <p className="text-muted">
        Mahsulot tavsifi va SEO qoralamalarida mijoz ma&apos;lumoti yo&apos;q.{' '}
        {status.available ? 'Claude ulangan.' : 'Claude ulanmagan — tugmalar xato qaytaradi.'}
      </p>
      <div className="flex items-center gap-3">
        <Switch
          checked={status.replyDrafts}
          disabled={!canKeys || busy}
          aria-label="Operator javobi uchun AI qoralama"
          onCheckedChange={(v) => void toggle(v)}
        />
        <span>
          <b className="font-semibold">Operator javobi qoralamasi</b> — mijozning oxirgi xabari
          Anthropic (AQSh) serveriga yuboriladi. Standart: o&apos;chiq; faqat Egasi yoqadi.
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-critical">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}
