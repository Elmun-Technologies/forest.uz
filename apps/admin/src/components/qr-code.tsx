import { qrMatrix, qrSvgPath } from '../lib/qr';

/** QR code as inline SVG (in-repo encoder, no dependency). Falls back to nothing if too long. */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  let drawn: { path: string; size: number };
  try {
    drawn = qrSvgPath(qrMatrix(value));
  } catch {
    return null;
  }
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${drawn.size} ${drawn.size}`}
      shapeRendering="crispEdges"
      className={className}
      data-testid="totp-qr"
    >
      <rect width={drawn.size} height={drawn.size} fill="#fff" />
      <path d={drawn.path} fill="#141712" />
    </svg>
  );
}
