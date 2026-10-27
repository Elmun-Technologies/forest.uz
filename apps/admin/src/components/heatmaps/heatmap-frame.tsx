'use client';

import {
  type HeatmapCellDto,
  type HeatmapDevice,
  type HeatmapDto,
  HEATMAP_FRAME_WIDTH,
  HEATMAP_X_STEP,
  HEATMAP_Y_STEP,
} from '@forest/contracts/core';
import { useEffect, useRef, useState } from 'react';
import { COPY } from './copy';

/** "kam → ko'p" ramp (design legend): pale yellow → orange → deep red. */
const RAMP: [number, number, number][] = [
  [255, 220, 120],
  [240, 150, 60],
  [214, 80, 40],
  [150, 20, 20],
];

function rampColor(t: number): [number, number, number] {
  const x = Math.min(0.999, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RAMP[i]!;
  const b = RAMP[i + 1]!;
  return [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * f)) as [number, number, number];
}

/**
 * Draws click density: soft alpha blobs per bin (weighted by √count), then the alpha channel is
 * mapped onto the colour ramp. Coordinates: x ‰ of the frame width, y document px × scale.
 */
function drawHeatmap(
  canvas: HTMLCanvasElement,
  cells: HeatmapCellDto[],
  rage: HeatmapCellDto[],
  frameWidth: number,
  scale: number,
  height: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(frameWidth * scale);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, height);
  const max = Math.max(1, ...cells.map((c) => c.count));
  const radius = Math.max(14, 34 * scale);
  for (const c of cells) {
    const cx = ((c.x + HEATMAP_X_STEP / 2) / 1000) * w;
    const cy = (c.y + HEATMAP_Y_STEP / 2) * scale;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, `rgba(0,0,0,${0.15 + 0.85 * Math.sqrt(c.count / max)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let p = 3; p < d.length; p += 4) {
    const a = d[p]!;
    if (a === 0) continue;
    const [r, gg, b] = rampColor(a / 255);
    d[p - 3] = r;
    d[p - 2] = gg;
    d[p - 1] = b;
    d[p] = Math.min(220, 60 + a);
  }
  ctx.putImageData(img, 0, 0);
  // Rage clicks: red rings on top.
  ctx.strokeStyle = 'rgba(138,28,18,0.9)';
  ctx.lineWidth = 2;
  for (const c of rage) {
    const cx = ((c.x + HEATMAP_X_STEP / 2) / 1000) * w;
    const cy = (c.y + HEATMAP_Y_STEP / 2) * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(6, 10 * scale), 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * The storefront page (sanitized SSR snapshot in a script-less sandboxed srcdoc iframe) at the
 * device's design width, scaled to the panel, with the click heatmap or scroll bands on top.
 */
export function HeatmapFrame({
  path,
  device,
  type,
  data,
}: {
  path: string;
  device: HeatmapDevice;
  type: 'click' | 'scroll';
  data: HeatmapDto;
}) {
  const frameWidth = HEATMAP_FRAME_WIDTH[device];
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [docHeight, setDocHeight] = useState(0);
  const [boxWidth, setBoxWidth] = useState(0);

  useEffect(() => {
    let alive = true;
    setHtml(null);
    setError(false);
    setDocHeight(0);
    fetch(`/heatmap-snapshot?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const text = await r.text();
        if (alive) setHtml(text);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    setBoxWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Same-origin srcdoc (no scripts): the real document height at this width, kept current while
  // images and fonts load.
  const ready = html !== null && boxWidth > 0;
  useEffect(() => {
    const f = frame.current;
    if (!f || !ready) return;
    let ro: ResizeObserver | undefined;
    const measure = () => {
      const doc = f.contentDocument;
      if (!doc?.documentElement) return;
      setDocHeight(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0));
    };
    const onLoad = () => {
      measure();
      const body = f.contentDocument?.body;
      if (body) {
        ro = new ResizeObserver(measure);
        ro.observe(body);
      }
    };
    f.addEventListener('load', onLoad);
    return () => {
      f.removeEventListener('load', onLoad);
      ro?.disconnect();
    };
  }, [ready, html]);

  const scale = boxWidth > 0 ? Math.min(1, boxWidth / frameWidth) : 0;
  const height = Math.round(docHeight * scale);

  useEffect(() => {
    if (type !== 'click' || !canvas.current || !scale || !height) return;
    drawHeatmap(canvas.current, data.clicks, data.rage, frameWidth, scale, height);
  }, [type, data, frameWidth, scale, height]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={box}
        className="relative max-h-[1100px] w-full overflow-y-auto overflow-x-hidden rounded-md border border-line bg-off"
        data-testid="heatmap-frame"
      >
        {error ? (
          <p className="p-8 text-center text-sm text-muted">{COPY.frameError}</p>
        ) : html === null || !scale ? (
          <p className="p-8 text-center text-sm text-muted">{COPY.frameLoading}</p>
        ) : null}
        {html !== null && scale > 0 ? (
          <div
            className="relative mx-auto"
            style={{ width: frameWidth * scale, height: Math.max(height, 200) }}
          >
            <iframe
              ref={frame}
              title={`${path} (${frameWidth} px)`}
              srcDoc={html}
              // No allow-scripts: nothing on the page runs (no tracker, no popups, no cookies).
              sandbox="allow-same-origin"
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white"
              style={{
                width: frameWidth,
                height: Math.max(docHeight, 800),
                transform: `scale(${scale})`,
              }}
            />
            {type === 'click' ? (
              <canvas ref={canvas} className="pointer-events-none absolute top-0 left-0" />
            ) : (
              <ScrollBands data={data} height={height} />
            )}
          </div>
        ) : null}
      </div>
      <p className="text-[11px] text-muted">{COPY.frameNote(frameWidth)}</p>
    </div>
  );
}

/** Scroll map: bands between 0/25/50/75/100 % of the page, shaded by the share that got there. */
function ScrollBands({ data, height }: { data: HeatmapDto; height: number }) {
  if (!height) return null;
  const reach = [100, ...data.scroll.map((s) => s.reachedPct ?? 0)];
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="scroll-bands">
      {data.scroll.map((s, i) => {
        const top = (i * height) / 4;
        const share = (reach[i]! + (s.reachedPct ?? 0)) / 200;
        const [r, g, b] = rampColor(1 - share);
        return (
          <div
            key={s.depth}
            className="absolute inset-x-0 flex items-end justify-end border-b border-dashed border-ink/40"
            style={{ top, height: height / 4, background: `rgba(${r},${g},${b},0.28)` }}
          >
            <span className="m-2 rounded-pill bg-ink px-2.5 py-1 text-[11px] font-semibold text-white">
              {COPY.scrollReached(s.depth, s.reachedPct)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
