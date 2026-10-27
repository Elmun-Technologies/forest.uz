'use client';

import type { AdminBotOverviewDto, BotScenario } from '@forest/contracts/core';
import { Switch } from '@forest/ui';
import { useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { COPY, RESULT_UNIT, SCENARIO_LABEL } from './copy';

const num = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, ' ');

/** A12 "Ssenariylar": 30-day sends and results from data, one switch per flow (`bot.edit`). */
export function ScenariosTable({ initial }: { initial: AdminBotOverviewDto['scenarios'] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<BotScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: BotScenario, enabled: boolean) {
    setBusy(key);
    setError(null);
    try {
      const o = await adminFetch<AdminBotOverviewDto>('/admin/bot/scenarios', {
        method: 'PUT',
        body: { scenario: key, enabled },
      });
      setRows(o.scenarios);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[12px] text-muted">
              <th className="py-2 pr-3 font-medium">{COPY.colScenario}</th>
              <th className="py-2 pr-3 text-right font-medium">{COPY.colSent}</th>
              <th className="py-2 pr-3 text-right font-medium">{COPY.colResult}</th>
              <th className="py-2" aria-label="Holat" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className="border-b border-line last:border-0"
                data-testid={`scenario-${r.key}`}
              >
                <td className="py-3 pr-3">
                  <div className="text-[15px] font-semibold">{SCENARIO_LABEL[r.key].title}</div>
                  <div className="text-[12px] text-muted">{SCENARIO_LABEL[r.key].trigger}</div>
                </td>
                <td className="tabular py-3 pr-3 text-right">{num(r.sent30d)}</td>
                <td className="tabular py-3 pr-3 text-right font-semibold text-good">
                  {r.result30d === null || !r.resultKind
                    ? COPY.none
                    : `${num(r.result30d)} ${RESULT_UNIT[r.resultKind]}`}
                </td>
                <td className="py-3 text-right">
                  <Switch
                    checked={r.enabled}
                    disabled={busy !== null}
                    onCheckedChange={(v) => void toggle(r.key, v)}
                    aria-label={`${SCENARIO_LABEL[r.key].title}: yoqilgan`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-critical">
          {error}
        </p>
      ) : null}
      <p className="text-[12px] text-muted">{COPY.resultNote}</p>
    </div>
  );
}
