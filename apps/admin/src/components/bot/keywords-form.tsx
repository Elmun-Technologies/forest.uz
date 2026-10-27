'use client';

import { Button, Textarea } from '@forest/ui';
import { useState } from 'react';
import type { AdminBotOverviewDto } from '@forest/contracts/core';
import { adminFetch, errorText } from '../../lib/client-api';
import { COPY } from './copy';

/** Complaint keywords (`bot.rules`, `bot.edit`) with the settings version check. */
export function KeywordsForm({ initial, version }: { initial: string[]; version: string | null }) {
  const [text, setText] = useState(initial.join(', '));
  const [ver, setVer] = useState(version);
  const [state, setState] = useState<{ ok?: boolean; error?: string; busy?: boolean }>({});

  async function save() {
    setState({ busy: true });
    try {
      const o = await adminFetch<AdminBotOverviewDto>('/admin/bot/rules', {
        method: 'PUT',
        body: {
          complaintKeywords: text
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 2),
          version: ver,
        },
      });
      setText(o.complaintKeywords.join(', '));
      setVer(o.version);
      setState({ ok: true });
    } catch (e) {
      setState({ error: errorText(e) });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="bot-keywords" className="text-[13px] font-semibold">
        {COPY.keywords}
      </label>
      <Textarea
        id="bot-keywords"
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setState({});
        }}
        aria-describedby="bot-keywords-hint"
      />
      <p id="bot-keywords-hint" className="text-[12px] text-muted">
        {COPY.keywordsHint}
      </p>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={state.busy}>
          {COPY.save}
        </Button>
        {state.ok ? <span className="text-[13px] text-good">{COPY.saved}</span> : null}
        {state.error ? (
          <span role="alert" className="text-[13px] text-critical">
            {state.error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
