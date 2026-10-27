'use client';

import {
  AUDIENCE_CONDITION_TYPES,
  AUDIENCE_CONSENTS,
  AUDIENCE_DEVICES,
  AUDIENCE_EVENTS,
  AUDIENCE_LEAD_SOURCES,
  type AudienceCondition,
  type AudienceConditionType,
  type RegionCode,
  UZ_REGIONS,
} from '@forest/contracts/core';
import { cn } from '@forest/ui';
import type { ReactNode } from 'react';
import {
  CONDITION_LABEL,
  CONSENT_LABEL,
  COPY,
  DEVICE_LABEL,
  EVENT_LABEL,
  LEAD_SOURCE_LABEL,
} from './copy';

const pill =
  'h-9 rounded-pill border-0 bg-canvas px-3 text-[13px] font-medium text-ink focus-visible:outline-2 focus-visible:outline-forest';
const num = cn(pill, 'w-[76px] tabular');

export function defaultCondition(
  type: AudienceConditionType,
  products: { id: string }[],
): AudienceCondition {
  switch (type) {
    case 'event':
      return { type, event: 'add_to_cart', did: true, withinDays: 7 };
    case 'page_time':
      return {
        type,
        path: { op: 'equals', value: '/p/' },
        minSeconds: 30,
        withinDays: 30,
        did: true,
      };
    case 'orders':
      return { type, metric: 'count', op: 'gte', value: 1 };
    case 'last_order':
      return { type, op: 'older', days: 60 };
    case 'product':
      return { type, productId: products[0]?.id ?? '', bought: true };
    case 'consent':
      return { type, channel: 'ads', granted: true };
    case 'tag':
      return { type, tag: '', has: true };
    case 'region':
      return { type, regions: ['tashkent_city'], include: true };
    case 'device':
      return { type, device: 'mobile' };
    case 'lead':
      return { type, has: true };
  }
}

function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      className={pill}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Num({
  value,
  onChange,
  label,
  min = 1,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  min?: number;
  suffix?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="number"
        aria-label={label}
        className={num}
        min={min}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(Math.max(min, Math.floor(Number(e.target.value) || 0)))}
      />
      {suffix ? <span className="text-[13px] text-muted">{suffix}</span> : null}
    </span>
  );
}

const yesNo = (yes: string, no: string) =>
  [
    { value: 'yes' as const, label: yes },
    { value: 'no' as const, label: no },
  ] as const;

function PathInput({
  value,
  onChange,
}: {
  value: { op: 'equals' | 'prefix'; value: string };
  onChange: (v: { op: 'equals' | 'prefix'; value: string }) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Select
        label="Sahifa mosligi"
        value={value.op}
        options={[
          { value: 'equals', label: 'sahifa =' },
          { value: 'prefix', label: 'sahifa bilan boshlanadi' },
        ]}
        onChange={(op) => onChange({ ...value, op })}
      />
      <input
        aria-label="Sahifa yo'li"
        className={cn(pill, 'w-[220px] font-mono')}
        value={value.value}
        maxLength={200}
        placeholder="/p/divan-yangilash-toplami"
        onChange={(e) => onChange({ ...value, value: e.target.value })}
      />
    </span>
  );
}

/** One rule of the A8 builder: "Hodisa: add_to_cart · bajarilgan · oxirgi 7 kun". */
export function RuleRow({
  lead,
  condition,
  products,
  onChange,
  onRemove,
}: {
  lead: string;
  condition: AudienceCondition;
  products: { id: string; name: string }[];
  onChange: (c: AudienceCondition) => void;
  onRemove: () => void;
}) {
  const c = condition;
  let body: ReactNode = null;
  switch (c.type) {
    case 'event':
      body = (
        <>
          <Select
            label="Hodisa"
            value={c.event}
            options={AUDIENCE_EVENTS.map((e) => ({ value: e, label: EVENT_LABEL[e] }))}
            onChange={(event) => onChange({ ...c, event })}
          />
          <Select
            label="Bajarilganmi"
            value={c.did ? 'yes' : 'no'}
            options={yesNo('bajarilgan', 'bajarilmagan')}
            onChange={(v) => onChange({ ...c, did: v === 'yes' })}
          />
          <Num
            label="Kunlar"
            value={c.withinDays}
            suffix="kun ichida"
            onChange={(withinDays) => onChange({ ...c, withinDays })}
          />
          {c.event !== 'purchase' ? (
            c.path ? (
              <PathInput value={c.path} onChange={(path) => onChange({ ...c, path })} />
            ) : (
              <button
                type="button"
                className="text-[13px] font-semibold text-forest underline"
                onClick={() => onChange({ ...c, path: { op: 'prefix', value: '/p/' } })}
              >
                + sahifa sharti
              </button>
            )
          ) : null}
        </>
      );
      break;
    case 'page_time':
      body = (
        <>
          <PathInput value={c.path} onChange={(path) => onChange({ ...c, path })} />
          <Select
            label="Vaqt sharti"
            value={c.did ? 'yes' : 'no'}
            options={yesNo('kamida', 'kamroq')}
            onChange={(v) => onChange({ ...c, did: v === 'yes' })}
          />
          <Num
            label="Soniya"
            value={c.minSeconds}
            suffix="soniya"
            onChange={(minSeconds) => onChange({ ...c, minSeconds })}
          />
          <Num
            label="Kunlar"
            value={c.withinDays}
            suffix="kun ichida"
            onChange={(withinDays) => onChange({ ...c, withinDays })}
          />
        </>
      );
      break;
    case 'orders':
      body = (
        <>
          <Select
            label="O'lchov"
            value={c.metric}
            options={[
              { value: 'count', label: 'soni' },
              { value: 'sum', label: "summasi (so'm)" },
            ]}
            onChange={(metric) => onChange({ ...c, metric })}
          />
          <Select
            label="Taqqoslash"
            value={c.op}
            options={[
              { value: 'gte', label: '≥' },
              { value: 'lte', label: '≤' },
            ]}
            onChange={(op) => onChange({ ...c, op })}
          />
          <Num
            label="Qiymat"
            min={0}
            value={c.value}
            onChange={(value) => onChange({ ...c, value })}
          />
          <Select
            label="Davr"
            value={c.withinDays ? 'window' : 'all'}
            options={[
              { value: 'all', label: 'butun davr' },
              { value: 'window', label: 'oxirgi N kun' },
            ]}
            onChange={(v) => onChange({ ...c, withinDays: v === 'window' ? 30 : null })}
          />
          {c.withinDays ? (
            <Num
              label="Kunlar"
              value={c.withinDays}
              suffix="kun"
              onChange={(withinDays) => onChange({ ...c, withinDays })}
            />
          ) : null}
        </>
      );
      break;
    case 'last_order':
      body = (
        <>
          <Select
            label="Oxirgi xarid"
            value={c.op}
            options={[
              { value: 'older', label: "dan ko'p o'tgan" },
              { value: 'within', label: "ichida bo'lgan" },
            ]}
            onChange={(op) => onChange({ ...c, op })}
          />
          <Num
            label="Kunlar"
            value={c.days}
            suffix="kun"
            onChange={(days) => onChange({ ...c, days })}
          />
        </>
      );
      break;
    case 'product':
      body = (
        <>
          <Select
            label="Mahsulot"
            value={c.productId}
            options={products.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(productId) => onChange({ ...c, productId })}
          />
          <Select
            label="Sotib olinganmi"
            value={c.bought ? 'yes' : 'no'}
            options={yesNo('sotib olgan', 'sotib olmagan')}
            onChange={(v) =>
              onChange({
                ...c,
                bought: v === 'yes',
                olderThanDays: v === 'yes' ? c.olderThanDays : null,
              })
            }
          />
          {c.bought ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              kamida
              <Num
                label="Necha kun oldin"
                min={0}
                value={c.olderThanDays ?? 0}
                suffix="kun oldin"
                onChange={(v) => onChange({ ...c, olderThanDays: v || null })}
              />
            </span>
          ) : null}
        </>
      );
      break;
    case 'consent':
      body = (
        <>
          <Select
            label="Kanal"
            value={c.channel}
            options={AUDIENCE_CONSENTS.map((v) => ({ value: v, label: CONSENT_LABEL[v] }))}
            onChange={(channel) => onChange({ ...c, channel })}
          />
          <Select
            label="Holat"
            value={c.granted ? 'yes' : 'no'}
            options={yesNo('bor', "yo'q")}
            onChange={(v) => onChange({ ...c, granted: v === 'yes' })}
          />
        </>
      );
      break;
    case 'tag':
      body = (
        <>
          <input
            aria-label="Teg"
            className={cn(pill, 'w-[160px]')}
            value={c.tag}
            maxLength={40}
            placeholder="vip"
            onChange={(e) => onChange({ ...c, tag: e.target.value })}
          />
          <Select
            label="Teg bormi"
            value={c.has ? 'yes' : 'no'}
            options={yesNo('bor', "yo'q")}
            onChange={(v) => onChange({ ...c, has: v === 'yes' })}
          />
        </>
      );
      break;
    case 'region':
      body = (
        <>
          <Select
            label="Hudud sharti"
            value={c.include ? 'yes' : 'no'}
            options={yesNo('ichida', 'tashqarida')}
            onChange={(v) => onChange({ ...c, include: v === 'yes' })}
          />
          <select
            aria-label="Hududlar"
            multiple
            className="min-h-9 rounded-md bg-canvas px-2 py-1 text-[13px]"
            value={c.regions}
            onChange={(e) =>
              onChange({
                ...c,
                regions: [...e.target.selectedOptions].map((o) => o.value as RegionCode),
              })
            }
          >
            {UZ_REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.uz}
              </option>
            ))}
          </select>
        </>
      );
      break;
    case 'device':
      body = (
        <Select
          label="Qurilma"
          value={c.device}
          options={AUDIENCE_DEVICES.map((v) => ({ value: v, label: DEVICE_LABEL[v] }))}
          onChange={(device) => onChange({ ...c, device })}
        />
      );
      break;
    case 'lead':
      body = (
        <>
          <Select
            label="Lead bormi"
            value={c.has ? 'yes' : 'no'}
            options={yesNo('raqam qoldirgan', 'qoldirmagan')}
            onChange={(v) => onChange({ ...c, has: v === 'yes' })}
          />
          <Select
            label="Manba"
            value={c.source ?? ''}
            options={[
              { value: '', label: 'istalgan manba' },
              ...AUDIENCE_LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABEL[s] })),
            ]}
            onChange={(v) => onChange({ ...c, source: v ? (v as typeof c.source) : null })}
          />
        </>
      );
      break;
  }
  return (
    <div className="flex items-start gap-3" data-testid="audience-rule">
      <span className="w-[42px] shrink-0 pt-2 text-xs font-semibold text-muted">{lead}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <Select
          label="Qoida turi"
          value={c.type}
          options={AUDIENCE_CONDITION_TYPES.map((t) => ({ value: t, label: CONDITION_LABEL[t] }))}
          onChange={(type) => onChange(defaultCondition(type, products))}
        />
        {body}
      </div>
      <button
        type="button"
        aria-label={COPY.removeRule}
        className="size-9 shrink-0 rounded-pill text-muted hover:bg-canvas hover:text-ink"
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}
