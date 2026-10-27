/**
 * Removes metadata (Exif incl. GPS, XMP, IPTC, comments, text chunks) from JPEG, PNG and WebP
 * images without decoding them: the container is walked and only the parts a decoder needs —
 * plus colour information — are copied (CLAUDE.md §6 "Image metadata"). Pure, no dependency.
 *
 * Returns null when the input doesn't parse completely (truncated segment/chunk, wrong sizes):
 * callers refuse such files instead of storing bytes nobody looked at.
 * Known loss: the Exif orientation tag (camera JPEGs that rely on it display unrotated).
 */
export type StrippableMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function stripImageMetadata(buf: Buffer, mime: StrippableMime): Buffer | null {
  try {
    if (mime === 'image/jpeg') return stripJpeg(buf);
    if (mime === 'image/png') return stripPng(buf);
    return stripWebp(buf);
  } catch {
    // Out-of-range reads on hostile input: same answer as any other malformed file.
    return null;
  }
}

// ─────────────────────────────── JPEG ───────────────────────────────

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;
const APP0 = 0xe0;
const APP2 = 0xe2;
const APP14 = 0xee;

/** APPn segments kept, by marker → identifier at the start of the payload. */
const KEPT_APP: ReadonlyMap<number, string> = new Map([
  [APP0, 'JFIF\0'], // JFIF header (density/aspect); JFXX thumbnails are dropped
  [APP2, 'ICC_PROFILE\0'], // colour profile
  [APP14, 'Adobe'], // colour transform flag needed to decode CMYK/YCCK files correctly
]);

/** Markers without a length field (besides SOI/EOI): RST0–RST7 and TEM. */
const isStandalone = (m: number) => (m >= 0xd0 && m <= 0xd7) || m === 0x01;

function keepJpegSegment(marker: number, payload: Buffer): boolean {
  if (marker === COM) return false;
  if (marker >= 0xe0 && marker <= 0xef) {
    const id = KEPT_APP.get(marker);
    return id !== undefined && payload.toString('latin1', 0, id.length) === id;
  }
  return true;
}

function stripJpeg(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== SOI) return null;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  for (;;) {
    if (i >= buf.length) return null; // ended without EOI before any scan
    if (buf[i] !== 0xff) return null;
    // Fill bytes (FF FF …) before a marker.
    while (i < buf.length && buf[i + 1] === 0xff) i++;
    if (i + 1 >= buf.length) return null;
    const marker = buf[i + 1]!;
    if (marker === EOI) {
      out.push(buf.subarray(i, i + 2));
      return Buffer.concat(out); // anything after EOI (trailers, appended files) is dropped
    }
    if (marker === SOI || marker === 0x00) return null;
    if (isStandalone(marker)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    const segment = buf.subarray(i, i + 2 + len);
    if (keepJpegSegment(marker, segment.subarray(4))) out.push(segment);
    i += 2 + len;
    if (marker === SOS) {
      // Entropy-coded data: copied unchanged up to the next real marker. 0xFF is followed by
      // 0x00 (stuffing) or RSTn inside the scan; any other marker ends it (EOI, or the next
      // table/scan of a progressive image, which the loop above walks like any segment).
      const start = i;
      while (i < buf.length) {
        if (buf[i] === 0xff && i + 1 < buf.length) {
          const next = buf[i + 1]!;
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            i += 2;
            continue;
          }
          if (next === 0xff) {
            i++;
            continue;
          }
          break;
        }
        i++;
      }
      if (i >= buf.length) return null; // scan ran to the end without EOI: truncated file
      out.push(buf.subarray(start, i));
    }
  }
}

// ─────────────────────────────── PNG ───────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROPPED = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPng(buf: Buffer): Buffer | null {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  let first = true;
  while (i < buf.length) {
    if (i + 12 > buf.length) return null;
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if (first && type !== 'IHDR') return null;
    first = false;
    const end = i + 12 + len; // length + type + data + CRC
    if (len > 0x7fffffff || end > buf.length) return null;
    if (!PNG_DROPPED.has(type)) out.push(buf.subarray(i, end)); // whole chunk: CRC stays valid
    i = end;
    if (type === 'IEND') break; // data after IEND is dropped
  }
  return first ? null : Buffer.concat(out);
}

// ─────────────────────────────── WebP ───────────────────────────────

const WEBP_DROPPED = new Set(['EXIF', 'XMP ']);
/** VP8X flag bits (RIFF container spec): EXIF = 0x08, XMP = 0x04. */
const VP8X_METADATA_FLAGS = 0x08 | 0x04;

function stripWebp(buf: Buffer): Buffer | null {
  if (
    buf.length < 20 ||
    buf.toString('latin1', 0, 4) !== 'RIFF' ||
    buf.toString('latin1', 8, 12) !== 'WEBP'
  )
    return null;
  const riffEnd = 8 + buf.readUInt32LE(4);
  if (riffEnd > buf.length || riffEnd < 20) return null;
  const chunks: Buffer[] = [];
  let i = 12;
  while (i < riffEnd) {
    if (i + 8 > riffEnd) return null;
    const fourcc = buf.toString('latin1', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    const dataEnd = i + 8 + size;
    if (dataEnd > riffEnd) return null;
    const padded = dataEnd + (size & 1);
    if (!WEBP_DROPPED.has(fourcc)) {
      const chunk = Buffer.alloc(8 + size + (size & 1)); // pad byte written as 0 even if missing
      buf.copy(chunk, 0, i, dataEnd);
      if (fourcc === 'VP8X' && size >= 1) chunk[8] = chunk[8]! & ~VP8X_METADATA_FLAGS;
      chunks.push(chunk);
    }
    i = Math.min(padded, riffEnd);
  }
  if (chunks.length === 0) return null;
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]); // nothing past the declared RIFF size is copied
}
