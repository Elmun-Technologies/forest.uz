/**
 * Minimal QR Code encoder (ISO/IEC 18004) for TOTP enrolment: byte mode, error correction level
 * M, versions 1–10 (≤ 213 bytes — an otpauth URI is ~130). In-repo to avoid a dependency for one
 * screen (CLAUDE.md §6); structure follows Project Nayuki's reference implementation (MIT).
 * Returns the module matrix `[y][x]` (true = dark), without the quiet zone.
 */

/** Level M, index = version (0 unused). From the standard's error correction table. */
const ECC_CODEWORDS_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_ECC_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;
/** Format info bits for level M (L=01, M=00, Q=11, H=10). */
const ECC_FORMAT_BITS = 0;

export function qrMatrix(text: string): boolean[][] {
  const data = new TextEncoder().encode(text);
  let version = 1;
  for (; version <= MAX_VERSION; version++) {
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + data.length * 8 <= numDataCodewords(version) * 8) break;
  }
  if (version > MAX_VERSION) throw new RangeError('text too long for the QR encoder');

  // Bit stream: mode (byte = 0100), length, data, terminator, byte padding, pad codewords.
  const bits: number[] = [];
  const append = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  const capacity = numDataCodewords(version) * 8;
  append(0b0100, 4);
  append(data.length, version < 10 ? 8 : 16);
  for (const b of data) append(b, 8);
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    codewords.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));

  return new QrBuilder(version, addEccAndInterleave(codewords, version)).modules;
}

function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver: number): number {
  return (
    Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ver]! * NUM_ECC_BLOCKS[ver]!
  );
}

function addEccAndInterleave(data: number[], ver: number): number[] {
  const numBlocks = NUM_ECC_BLOCKS[ver]!;
  const eccLen = ECC_CODEWORDS_PER_BLOCK[ver]!;
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push([...dat, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      // Skip the padding byte of short blocks.
      if (i !== shortBlockLen - eccLen || j >= numShortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

/** GF(2^8) multiplication modulo x^8 + x^4 + x^3 + x^2 + 1. */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i]! ^= gfMul(coef, factor)));
  }
  return result;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class QrBuilder {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly isFunction: boolean[][];

  constructor(
    private readonly version: number,
    codewords: number[],
  ) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.isFunction = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.drawFunctionPatterns();
    this.drawCodewords(codewords);
    let best = 0;
    let bestPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      this.applyMask(mask);
      this.drawFormatBits(mask);
      const penalty = this.penalty();
      if (penalty < bestPenalty) {
        best = mask;
        bestPenalty = penalty;
      }
      this.applyMask(mask); // XOR again = undo
    }
    this.applyMask(best);
    this.drawFormatBits(best);
  }

  private set(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.isFunction[y]![x] = true;
  }

  private drawFunctionPatterns(): void {
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(s - 4, 3);
    this.drawFinder(3, s - 4);
    const align = this.alignmentPositions();
    const n = align.length;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (!((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)))
          this.drawAlignment(align[i]!, align[j]!);
    this.drawFormatBits(0); // reserve; overwritten after masking
    this.drawVersion();
  }

  private drawFinder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size)
          this.set(xx, yy, dist !== 2 && dist !== 4);
      }
  }

  private drawAlignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  private alignmentPositions(): number[] {
    if (this.version === 1) return [];
    const numAlign = Math.floor(this.version / 7) + 2;
    const step = Math.ceil((this.size - 13) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = this.size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  private drawFormatBits(mask: number): void {
    const data = (ECC_FORMAT_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true); // dark module
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  private drawCodewords(data: number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y]![x] && i < data.length * 8) {
            this.modules[y]![x] = ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  private applyMask(mask: number): void {
    const fn = MASKS[mask]!;
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++)
        if (!this.isFunction[y]![x] && fn(x, y)) this.modules[y]![x] = !this.modules[y]![x];
  }

  /** Simplified ISO penalty (N1 runs, N2 blocks, N3 finder-like, N4 balance) to pick the mask. */
  private penalty(): number {
    const s = this.size;
    const m = this.modules;
    let result = 0;
    const lines: boolean[][] = [];
    for (let i = 0; i < s; i++) {
      lines.push(m[i]!);
      lines.push(m.map((row) => row[i]!));
    }
    const finderLike = [true, false, true, true, true, false, true];
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= s; i++) {
        if (i < s && line[i] === line[i - 1]) run++;
        else {
          if (run >= 5) result += 3 + (run - 5);
          run = 1;
        }
      }
      const padded = [
        ...new Array<boolean>(4).fill(false),
        ...line,
        ...new Array<boolean>(4).fill(false),
      ];
      for (let i = 0; i + 7 <= padded.length; i++) {
        if (!finderLike.every((v, k) => padded[i + k] === v)) continue;
        const before = padded.slice(Math.max(0, i - 4), i);
        const after = padded.slice(i + 7, i + 11);
        if (
          (before.length === 4 && before.every((v) => !v)) ||
          (after.length === 4 && after.every((v) => !v))
        )
          result += 40;
      }
    }
    let dark = 0;
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        if (m[y]![x]) dark++;
        if (
          x < s - 1 &&
          y < s - 1 &&
          m[y]![x] === m[y]![x + 1] &&
          m[y]![x] === m[y + 1]![x] &&
          m[y]![x] === m[y + 1]![x + 1]
        )
          result += 3;
      }
    const total = s * s;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return result;
  }
}

/** SVG path (1 unit per module, quiet zone of 4) for `<svg viewBox="0 0 n n">`. */
export function qrSvgPath(matrix: boolean[][]): { path: string; size: number } {
  const quiet = 4;
  let path = '';
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }),
  );
  return { path, size: matrix.length + quiet * 2 };
}
