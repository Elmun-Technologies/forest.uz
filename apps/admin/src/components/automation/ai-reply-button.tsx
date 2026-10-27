'use client';

import type { AiReplyDraftDto } from '@forest/contracts/core';
import { Button } from '@forest/ui';
import { useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';

/**
 * Bot inbox: "AI qoralama" (CLAUDE.md §6) — asks for a reply draft and hands it to the reply box.
 * Nothing is sent: the operator reads, edits and presses "Yuborish".
 */
export function AiReplyButton({
  conversationId,
  onDraft,
  disabled,
}: {
  conversationId: string;
  onDraft: (text: string) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function draft() {
    setBusy(true);
    setNote(null);
    try {
      const r = await adminFetch<AiReplyDraftDto>('/admin/ai/reply', {
        method: 'POST',
        body: { conversationId },
      });
      onDraft(r.text);
      setNote(
        r.fake ? 'Sinov rejimi (fake): matn namunaviy.' : "Qoralama qo'yildi — tekshirib yuboring.",
      );
    } catch (e) {
      setNote(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        loading={busy}
        disabled={disabled}
        onClick={() => void draft()}
        data-testid="inbox-ai-draft"
      >
        ✦ AI qoralama
      </Button>
      {note ? (
        <span role="status" className="text-[12px] text-muted">
          {note}
        </span>
      ) : null}
    </>
  );
}
