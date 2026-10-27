'use client';

import type { DayPointDto } from '@forest/contracts/core';
import { useEffect, useRef, useState } from 'react';
import { INT, PCT, SOUM_SHORT } from './copy';

const TOP_H = 210;
const BAR_H = 64;
const GAP = 26;
const PAD = { l: 44, r: 12, t: 10 };

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10;
  return step * pow;
}

const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

/**
 * A1 "Tashriflar": daily sessions (area) with purchases as a separate bar strip on the same days —
 * two measures, two y-scales, never one dual-axis chart. Hover / arrow keys show the day.
 */
export function VisitsChart({ points }: { points: DayPointDto[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const empty = points.every((p) => p.sessions === 0 && p.orders === 0);
  const n = points.length;
  const plotW = width - PAD.l - PAD.r;
  const x = (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const sMax = niceMax(Math.max(...points.map((p) => p.sessions), 0));
  const oMax = niceMax(Math.max(...points.map((p) => p.orders), 0));
  const y = (v: number) => PAD.t + TOP_H - (v / sMax) * TOP_H;
  const barTop = PAD.t + TOP_H + GAP;
  const barW = Math.max(2, Math.min(14, plotW / Math.max(n, 1) - 4));
  const height = barTop + BAR_H + 24;

  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.sessions).toFixed(1)}`)
    .join('');
  const area = `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(sMax * f));
  const labelEvery = Math.max(1, Math.ceil(n / 6));

  const pick = (clientX: number, rect: DOMRect) => {
    const rel = clientX - rect.left - PAD.l;
    setActive(Math.min(n - 1, Math.max(0, Math.round((rel / plotW) * (n - 1)))));
  };
  const a = active !== null ? points[active] : null;

  if (empty)
    return (
      <p className="grid h-[200px] place-items-center rounded-md bg-canvas text-center text-muted">
        Bu davrda tashriflar hali yo&apos;q. Trekker ma&apos;lumot yig&apos;ishi bilan grafik
        to&apos;ladi.
      </p>
    );

  return (
    <div ref={wrap} className="relative w-full" data-testid="visits-chart">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Kunlik sessiyalar va xaridlar, ${n} kun`}
        tabIndex={0}
        className="block touch-none outline-none focus-visible:ring-2 focus-visible:ring-ink"
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setActive((v) => Math.min(n - 1, (v ?? -1) + 1));
          else if (e.key === 'ArrowLeft') setActive((v) => Math.max(0, (v ?? n) - 1));
          else if (e.key === 'Escape') setActive(null);
        }}
        onBlur={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.l}
              x2={width - PAD.r}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--color-line-soft)"
              strokeWidth={1}
            />
            <text
              x={PAD.l - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--color-muted)"
            >
              {INT(t)}
            </text>
          </g>
        ))}
        <path d={area} fill="var(--color-chart-1)" fillOpacity={0.12} />
        <path
          d={line}
          fill="none"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <text x={PAD.l} y={barTop - 8} fontSize={11} fill="var(--color-muted)">
          Xaridlar (max {INT(oMax)})
        </text>
        <line
          x1={PAD.l}
          x2={width - PAD.r}
          y1={barTop + BAR_H}
          y2={barTop + BAR_H}
          stroke="var(--color-line)"
        />
        {points.map((p, i) => {
          const h = (p.orders / oMax) * BAR_H;
          return h > 0 ? (
            <rect
              key={p.day}
              x={x(i) - barW / 2}
              y={barTop + BAR_H - h}
              width={barW}
              height={h}
              rx={Math.min(4, barW / 2)}
              fill="var(--color-chart-2)"
              opacity={active === null || active === i ? 1 : 0.45}
            />
          ) : null;
        })}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text
              key={p.day}
              x={x(i)}
              y={height - 6}
              textAnchor="middle"
              fontSize={11}
              fill="var(--color-muted)"
            >
              {dm(p.day)}
            </text>
          ) : null,
        )}
        {a && active !== null ? (
          <g pointerEvents="none">
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD.t}
              y2={barTop + BAR_H}
              stroke="var(--color-ink)"
              strokeOpacity={0.3}
            />
            <circle
              cx={x(active)}
              cy={y(a.sessions)}
              r={5}
              fill="var(--color-chart-1)"
              stroke="var(--color-panel)"
              strokeWidth={2}
            />
          </g>
        ) : null}
      </svg>
      {a && active !== null ? (
        <div
          role="status"
          className="pointer-events-none absolute top-2 rounded-sm bg-ink px-3 py-2 text-xs text-white shadow-float"
          style={{
            left: Math.min(Math.max(x(active) - 80, 0), width - 170),
          }}
        >
          <span className="block text-on-dark-muted">{dm(a.day)}</span>
          <b className="block text-base font-semibold">{INT(a.sessions)} sessiya</b>
          <span className="block">
            {INT(a.orders)} xarid · {PCT(a.sessions ? a.orders / a.sessions : null)}
            {a.revenueSoum ? ` · ${SOUM_SHORT(a.revenueSoum)}` : ''}
          </span>
        </div>
      ) : null}
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer select-none">Jadval ko&apos;rinishi</summary>
        <table className="mt-2 w-full text-left tabular">
          <thead>
            <tr className="text-muted">
              <th className="py-1 font-medium">Kun</th>
              <th className="py-1 text-right font-medium">Sessiya</th>
              <th className="py-1 text-right font-medium">Xarid</th>
              <th className="py-1 text-right font-medium">Daromad</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day} className="border-t border-line-soft text-ink">
                <td className="py-1">{dm(p.day)}</td>
                <td className="py-1 text-right">{INT(p.sessions)}</td>
                <td className="py-1 text-right">{INT(p.orders)}</td>
                <td className="py-1 text-right">{SOUM_SHORT(p.revenueSoum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
