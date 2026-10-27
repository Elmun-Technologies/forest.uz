import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvgPath } from './qr';

const OTPAUTH =
  'otpauth://totp/Forest%20Admin:owner%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Forest%20Admin&algorithm=SHA1&digits=6&period=30';

const digest = (m: boolean[][]) =>
  createHash('sha256')
    .update(m.map((r) => r.map((v) => (v ? '1' : '0')).join('')).join('\n'))
    .digest('hex');

/** Reads the 15 format bits around the top-left finder (ISO 18004 §7.9). */
function formatBits(m: boolean[][]): number {
  const cells: [number, number][] = [];
  for (let i = 0; i <= 5; i++) cells.push([8, i]);
  cells.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) cells.push([14 - i, 8]);
  return cells.reduce((acc, [x, y], i) => acc | ((m[y]![x] ? 1 : 0) << i), 0);
}

describe('QR encoder', () => {
  it('picks the smallest version that fits (byte mode, level M)', () => {
    expect(qrMatrix('A')).toHaveLength(21); // v1
    expect(qrMatrix('x'.repeat(20))).toHaveLength(25); // v2
    expect(qrMatrix(OTPAUTH)).toHaveLength(49); // v8
    expect(qrMatrix('e'.repeat(213))).toHaveLength(57); // v10, the limit
    expect(() => qrMatrix('e'.repeat(214))).toThrow(RangeError);
  });

  it('draws finder patterns and timing lines', () => {
    const m = qrMatrix(OTPAUTH);
    const n = m.length;
    for (const [ox, oy] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ] as const) {
      for (let i = 0; i < 7; i++) {
        expect(m[oy]![ox + i]).toBe(true);
        expect(m[oy + 6]![ox + i]).toBe(true);
      }
      expect(m[oy + 1]![ox + 1]).toBe(false);
      expect(m[oy + 3]![ox + 3]).toBe(true);
    }
    for (let i = 8; i < n - 8; i++) expect(m[6]![i]).toBe(i % 2 === 0);
    expect(m[n - 8]![8]).toBe(true); // dark module
  });

  it('format info is a valid BCH codeword for level M', () => {
    const bits = formatBits(qrMatrix(OTPAUTH)) ^ 0x5412;
    const data = bits >>> 10;
    expect(data >>> 3).toBe(0); // level M
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    expect(((data << 10) | rem) & 0x7fff).toBe(bits);
  });

  // Matrices verified once with an independent decoder (ZXing) when the encoder was written;
  // pinned so refactors can't silently produce unreadable codes.
  it('matches decoder-verified output', () => {
    expect(digest(qrMatrix(OTPAUTH))).toBe(
      'ca28324f6effd74db3821594730082ee3d501644a395766d87a739cdc1a1fcbc',
    );
    expect(digest(qrMatrix('Salom dunyo — Привет 12345'))).toBe(
      'd8a2d1912acde1957238ba3fcaa3368854b0b32c52fb3a5186023c1814df601c',
    );
  });

  it('SVG path includes a 4-module quiet zone', () => {
    const { size, path } = qrSvgPath(qrMatrix('A'));
    expect(size).toBe(29);
    expect(path.startsWith('M4 4h1v1h-1z')).toBe(true);
  });
});
