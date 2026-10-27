'use client';

import {
  CARRIERS,
  type Carrier,
  type DeliverySettingsDto,
  type DeliveryZone,
  deliveryPromisePreview,
  fromTashkent,
  TASHKENT_DISTRICTS,
  toTashkentParts,
  UZ_REGIONS,
} from '@forest/contracts/core';
import { Badge, Button, cn, Panel, Switch } from '@forest/ui';
import { Fragment, type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { adminFetch, ClientApiError, errorText } from '../../lib/client-api';
import { FormError } from '../auth-card';

type Rules = DeliverySettingsDto['rules'];
type Returns = DeliverySettingsDto['returns'];

const CARRIER_LABEL: Record<Carrier, string> = {
  YANDEX: 'Yandex Dostavka',
  BTS: 'BTS Express',
  PICKUP: 'Olib ketish',
};
const WEEKDAYS = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh']; // 0 = Sunday
const ISSUE_FIELD: Record<string, string> = {
  key: 'kalit',
  name: 'nomi',
  etaLabel: 'muddat matni',
  priceSoum: 'narx',
  freeFromSoum: 'bepul chegarasi',
  regions: 'hududlar',
  districts: 'tumanlar',
  cutoff: 'kesish vaqti',
  sameDayEnd: 'shu kun oxiri',
  afterCutoffBy: 'ertasi kun vaqti',
  promiseHours: 'va’da (soat)',
  workDays: 'ish kunlari',
  liveQuote: 'jonli narx',
  codMaxSoum: 'naqd to‘lov chegarasi',
};

const cell =
  'h-9 w-full rounded-xs border border-line bg-panel px-2 text-[13px] focus:border-ink focus:outline-none';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** `datetime-local` value in Tashkent wall-clock time. */
function toLocalInput(d: Date): string {
  const p = toTashkentParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function fromLocalInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  return fromTashkent(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

function NumberField({
  label,
  value,
  onChange,
  suffix,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold">
      {label}
      <span className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(num(e.target.value))}
          className={cn(cell, 'h-11 text-sm')}
        />
        {suffix ? <span className="shrink-0 font-normal text-muted">{suffix}</span> : null}
      </span>
    </label>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold">
      {label}
      {children}
    </label>
  );
}

/** A16 "Yetkazish": zones table, rules, and the storefront texts the edits would produce. */
export function DeliveryEditor({ initial, now }: { initial: DeliverySettingsDto; now: string }) {
  const [doc, setDoc] = useState(initial);
  const [zones, setZones] = useState<DeliveryZone[]>(initial.zones);
  const [rules, setRules] = useState<Rules>(initial.rules);
  const [returns, setReturns] = useState<Returns>(initial.returns);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [at, setAt] = useState(() => toLocalInput(new Date(now)));

  const dirty =
    JSON.stringify([zones, rules, returns]) !== JSON.stringify([doc.zones, doc.rules, doc.returns]);

  const patchZone = (index: number, patch: Partial<DeliveryZone>) => {
    setSaved(false);
    setZones((cur) => cur.map((z, i) => (i === index ? { ...z, ...patch } : z)));
  };
  const patchRule = (index: number, patch: Partial<DeliveryZone['rule']>) => {
    setSaved(false);
    setZones((cur) =>
      cur.map((z, i) => (i === index ? { ...z, rule: { ...z.rule, ...patch } } : z)),
    );
  };

  const preview = useMemo(() => {
    const date = fromLocalInput(at);
    return date ? deliveryPromisePreview(zones, date) : null;
  }, [zones, at]);

  function addZone() {
    const key = `zone-${Date.now().toString(36)}`;
    setZones((cur) => [
      ...cur,
      {
        key,
        name: { uz: '', ru: '' },
        carrier: 'BTS',
        regions: [],
        priceSoum: 0,
        freeFromSoum: null,
        etaLabel: { uz: '', ru: '' },
        rule: { promiseHours: 24, workDays: [0, 1, 2, 3, 4, 5, 6] },
        active: false,
        sort: Math.max(0, ...cur.map((z) => z.sort)) + 1,
      },
    ]);
    setOpen(key);
  }

  function describeIssue(e: unknown): string {
    if (!(e instanceof ClientApiError)) return errorText(e);
    const path = (e.details?.issues as { path: string; message: string }[] | undefined)?.[0]?.path;
    if (!path) return e.message;
    const parts = path.split('.');
    const field = ISSUE_FIELD[parts.at(-1) ?? ''] ?? parts.at(-1);
    if (parts[0] === 'zones' && parts[1] !== undefined) {
      const z = zones[Number(parts[1])];
      return `${e.message} Zona «${z?.name.uz || z?.key || '?'}»: ${field}.`;
    }
    return `${e.message} (${field})`;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await adminFetch<DeliverySettingsDto>('/admin/settings/delivery', {
        method: 'PUT',
        body: { zones, rules, returns, version: doc.version },
      });
      setDoc(next);
      setZones(next.zones);
      setRules(next.rules);
      setReturns(next.returns);
      setSaved(true);
    } catch (err) {
      setError(describeIssue(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Yetkazish sozlamalari">
      <Panel as="section" className="flex flex-col gap-3 p-5 text-[13px] sm:p-[22px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Yetkazish zonalari</h2>
          <Button size="sm" variant="outline" onClick={addZone}>
            + Zona
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[900px] border-collapse text-left"
            data-testid="zones-table"
          >
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="px-1.5 py-2 font-normal">
                  Zona
                </th>
                <th scope="col" className="w-[150px] px-1.5 py-2 font-normal">
                  Kuryer
                </th>
                <th scope="col" className="px-1.5 py-2 font-normal">
                  Muddat
                </th>
                <th scope="col" className="w-[120px] px-1.5 py-2 font-normal">
                  Narx, so&apos;m
                </th>
                <th scope="col" className="w-[130px] px-1.5 py-2 font-normal">
                  Bepul (dan)
                </th>
                <th scope="col" className="w-[70px] px-1.5 py-2 font-normal">
                  Faol
                </th>
                <th scope="col" className="w-[110px] px-1.5 py-2 font-normal">
                  <span className="sr-only">Batafsil</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z, i) => {
                const label = z.name.uz || z.key;
                const expanded = open === z.key;
                return (
                  <Fragment key={z.key}>
                    <tr
                      className={cn('border-b border-line-soft', !z.active && 'opacity-60')}
                      data-testid={`zone-${z.key}`}
                      data-carrier={z.carrier}
                    >
                      <td className="px-1.5 py-2">
                        <input
                          aria-label={`${label}: nomi (UZ)`}
                          className={cell}
                          value={z.name.uz}
                          onChange={(e) =>
                            patchZone(i, { name: { ...z.name, uz: e.target.value } })
                          }
                        />
                      </td>
                      <td className="px-1.5 py-2">
                        <select
                          aria-label={`${label}: kuryer`}
                          className={cell}
                          value={z.carrier}
                          onChange={(e) =>
                            patchZone(i, {
                              carrier: e.target.value as Carrier,
                              ...(e.target.value !== 'YANDEX' ? { liveQuote: false } : {}),
                            })
                          }
                        >
                          {CARRIERS.map((c) => (
                            <option key={c} value={c}>
                              {CARRIER_LABEL[c]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1.5 py-2">
                        <input
                          aria-label={`${label}: muddat (UZ)`}
                          className={cell}
                          value={z.etaLabel.uz}
                          onChange={(e) =>
                            patchZone(i, { etaLabel: { ...z.etaLabel, uz: e.target.value } })
                          }
                        />
                      </td>
                      <td className="px-1.5 py-2">
                        <input
                          aria-label={`${label}: narx`}
                          type="number"
                          min={0}
                          className={cn(cell, 'tabular')}
                          value={Number.isFinite(z.priceSoum) ? z.priceSoum : ''}
                          onChange={(e) => patchZone(i, { priceSoum: num(e.target.value) })}
                        />
                      </td>
                      <td className="px-1.5 py-2">
                        <input
                          aria-label={`${label}: bepul yetkazish chegarasi`}
                          type="number"
                          min={0}
                          placeholder="yo'q"
                          className={cn(cell, 'tabular')}
                          value={z.freeFromSoum ?? ''}
                          onChange={(e) =>
                            patchZone(i, {
                              freeFromSoum: e.target.value === '' ? null : num(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="px-1.5 py-2">
                        <Switch
                          aria-label={`${label}: faol`}
                          checked={z.active}
                          onCheckedChange={(v) => patchZone(i, { active: v })}
                        />
                      </td>
                      <td className="px-1.5 py-2 text-right">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setOpen(expanded ? null : z.key)}
                          className="text-xs font-semibold text-forest underline underline-offset-2"
                        >
                          {expanded ? 'Yopish' : 'Qoidalar'}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-b border-line-soft bg-off">
                        <td colSpan={7} className="px-3 py-4">
                          <ZoneDetails
                            zone={z}
                            label={label}
                            onZone={(p) => patchZone(i, p)}
                            onRule={(p) => patchRule(i, p)}
                            onRemove={() => {
                              if (
                                !window.confirm(
                                  `«${label}» zonasi o'chirilsinmi? Saqlangandan keyin kuchga kiradi.`,
                                )
                              )
                                return;
                              setZones((cur) => cur.filter((_, j) => j !== i));
                              setOpen(null);
                            }}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Narxlar so&apos;mda. Bepul chegarasi — chegirmadan keyingi tovarlar summasi. Yandex jonli
          narxi faqat ombor koordinatalari va mijoz nuqtasi bo&apos;lsa ishlaydi, aks holda zona
          narxi.
        </p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel as="section" className="flex flex-col gap-4 p-5 text-[13px] sm:p-[22px]">
          <h2 className="text-xl font-semibold">Qoidalar</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Naqd to'lov chegarasi"
              suffix="so'm"
              value={rules.codMaxSoum}
              onChange={(v) => setRules({ ...rules, codMaxSoum: v })}
            />
            <NumberField
              label="Tasdiqlanmagan naqd buyurtma bekor"
              suffix="soatdan keyin"
              value={rules.codAutoCancelHours}
              onChange={(v) => setRules({ ...rules, codAutoCancelHours: v })}
            />
            <NumberField
              label="Onlayn to'lov uchun band qilish"
              suffix="daqiqa"
              value={rules.onlineReservationMinutes}
              onChange={(v) => setRules({ ...rules, onlineReservationMinutes: v })}
            />
            <NumberField
              label="To'lov eslatmasi"
              suffix="daqiqadan keyin"
              value={rules.paymentReminderMinutes}
              onChange={(v) => setRules({ ...rules, paymentReminderMinutes: v })}
            />
          </div>
          <h3 className="pt-1 text-base font-semibold">Qaytarish</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              label="Qaytarish muddati"
              suffix="kun"
              value={returns.returnDays}
              onChange={(v) => setReturns({ ...returns, returnDays: v })}
            />
            <NumberField
              label="Nuqson haqida xabar"
              suffix="soat"
              value={returns.defectReportHours}
              onChange={(v) => setReturns({ ...returns, defectReportHours: v })}
            />
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              Pulni qaytarish (ish kuni)
              <input
                className={cn(cell, 'h-11 text-sm')}
                value={returns.refundBusinessDays}
                onChange={(e) => setReturns({ ...returns, refundBusinessDays: e.target.value })}
              />
            </label>
          </div>
        </Panel>

        <Panel
          as="section"
          className="flex flex-col gap-3 p-5 text-[13px] sm:p-[22px]"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Saytdagi matnlar (ko&apos;rib chiqish)</h2>
            <label className="flex items-center gap-2 text-xs font-semibold">
              Buyurtma vaqti (Toshkent)
              <input
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                className={cn(cell, 'w-auto')}
              />
            </label>
          </div>
          {preview ? (
            <div className="flex flex-col gap-3" data-testid="delivery-preview">
              <div className="rounded-sm bg-sage-50 p-3">
                <span className="text-xs text-muted">Mahsulot sahifasi va sarlavha</span>
                <p className="font-semibold">
                  {preview.express?.text.uz ??
                    'Toshkent express zonasi yo‘q — qator ko‘rsatilmaydi'}
                </p>
                {preview.express ? <p className="text-muted">{preview.express.text.ru}</p> : null}
              </div>
              <ul className="flex flex-col">
                {preview.zones.map((z) => (
                  <li key={z.zoneKey} className="flex flex-col border-t border-line-soft py-2">
                    <span className="flex items-center gap-2">
                      <b className="font-semibold">{z.text.uz}</b>
                      {!z.active ? <Badge>faol emas</Badge> : null}
                    </span>
                    <span className="text-muted">{z.text.ru}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                Savat va checkout shu matnlarni ko&apos;rsatadi. Saqlanmagan o&apos;zgarishlar ham
                hisobga olingan.
              </p>
            </div>
          ) : (
            <p className="text-muted">Vaqtni kiriting.</p>
          )}
        </Panel>
      </div>

      <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-md bg-panel/95 p-3 shadow-float">
        <Button type="submit" loading={busy} disabled={!dirty}>
          Saqlash
        </Button>
        {saved && !dirty ? (
          <span role="status" className="text-[13px] font-semibold text-good">
            Saqlandi — savat va checkout darhol yangi qiymatlarni ishlatadi
          </span>
        ) : dirty ? (
          <span className="text-[13px] text-muted">Saqlanmagan o&apos;zgarishlar bor</span>
        ) : null}
        <div className="min-w-0 flex-1">
          <FormError message={error} />
        </div>
      </div>
    </form>
  );
}

function ZoneDetails({
  zone,
  label,
  onZone,
  onRule,
  onRemove,
}: {
  zone: DeliveryZone;
  label: string;
  onZone: (p: Partial<DeliveryZone>) => void;
  onRule: (p: Partial<DeliveryZone['rule']>) => void;
  onRemove: () => void;
}) {
  const time = (v: string) => (v === '' ? undefined : v);
  const hasTashkent = zone.regions.includes('tashkent_city');
  return (
    <div className="grid gap-4 text-[13px] lg:grid-cols-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <Detail label="Nomi (RU)">
          <input
            className={cell}
            value={zone.name.ru}
            onChange={(e) => onZone({ name: { ...zone.name, ru: e.target.value } })}
          />
        </Detail>
        <Detail label="Muddat matni (RU)">
          <input
            className={cell}
            value={zone.etaLabel.ru}
            onChange={(e) => onZone({ etaLabel: { ...zone.etaLabel, ru: e.target.value } })}
          />
        </Detail>
        <Detail label="Va'da (soat)">
          <input
            aria-label={`${label}: va'da soati`}
            type="number"
            min={1}
            className={cell}
            value={Number.isFinite(zone.rule.promiseHours) ? zone.rule.promiseHours : ''}
            onChange={(e) => onRule({ promiseHours: num(e.target.value) })}
          />
        </Detail>
        <Detail label="Tartib">
          <input
            type="number"
            min={0}
            className={cell}
            value={zone.sort}
            onChange={(e) => onZone({ sort: num(e.target.value) })}
          />
        </Detail>
        <Detail label="Kesish vaqti (cut-off)">
          <input
            aria-label={`${label}: kesish vaqti`}
            type="time"
            className={cell}
            value={zone.rule.cutoff ?? ''}
            onChange={(e) => onRule({ cutoff: time(e.target.value) })}
          />
        </Detail>
        <Detail label="Shu kun oxiri">
          <input
            type="time"
            className={cell}
            value={zone.rule.sameDayEnd ?? ''}
            onChange={(e) => onRule({ sameDayEnd: time(e.target.value) })}
          />
        </Detail>
        <Detail label="Kesishdan keyin: ertasi kun soat">
          <input
            type="time"
            className={cell}
            value={zone.rule.afterCutoffBy ?? ''}
            onChange={(e) => onRule({ afterCutoffBy: time(e.target.value) })}
          />
        </Detail>
        <Detail label="Kalit (ichki)">
          <input className={cn(cell, 'bg-off font-mono')} value={zone.key} readOnly />
        </Detail>
        <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
          <legend className="pb-1 text-xs font-semibold">Ish kunlari</legend>
          <span className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, wd) => {
              const on = zone.rule.workDays.includes(wd);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onRule({
                      workDays: on
                        ? zone.rule.workDays.filter((x) => x !== wd)
                        : [...zone.rule.workDays, wd].sort((a, b) => a - b),
                    })
                  }
                  className={cn(
                    'h-8 w-10 rounded-pill text-xs font-semibold',
                    on ? 'bg-ink text-white' : 'bg-canvas text-muted',
                  )}
                >
                  {d}
                </button>
              );
            })}
          </span>
        </fieldset>
        {zone.carrier === 'YANDEX' ? (
          <div className="flex items-center gap-2 text-xs font-semibold sm:col-span-2">
            <Switch
              checked={zone.liveQuote ?? false}
              onCheckedChange={(v) => onZone({ liveQuote: v })}
              aria-label={`${label}: jonli narx`}
            />
            Yandex jonli narxi (check-price)
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1 text-xs font-semibold">
            Hududlar{' '}
            <span className="font-normal text-muted">(hech biri = qolgan barcha hududlar)</span>
          </legend>
          <span className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
            {UZ_REGIONS.map((r) => (
              <label key={r.code} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="size-4 accent-forest"
                  checked={zone.regions.includes(r.code)}
                  onChange={(e) =>
                    onZone({
                      regions: e.target.checked
                        ? [...zone.regions, r.code]
                        : zone.regions.filter((x) => x !== r.code),
                    })
                  }
                />
                {r.uz}
              </label>
            ))}
          </span>
        </fieldset>
        {hasTashkent ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1 text-xs font-semibold">
              Toshkent tumanlari{' '}
              <span className="font-normal text-muted">(hech biri = butun shahar)</span>
            </legend>
            <span className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
              {TASHKENT_DISTRICTS.map((d) => (
                <label key={d.code} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-forest"
                    checked={zone.districts?.includes(d.code) ?? false}
                    onChange={(e) => {
                      const cur = zone.districts ?? [];
                      onZone({
                        districts: e.target.checked
                          ? [...cur, d.code]
                          : cur.filter((x) => x !== d.code),
                      });
                    }}
                  />
                  {d.uz}
                </label>
              ))}
            </span>
          </fieldset>
        ) : null}
        <span>
          <Button size="sm" variant="danger" onClick={onRemove}>
            Zonani o&apos;chirish
          </Button>
        </span>
      </div>
    </div>
  );
}
