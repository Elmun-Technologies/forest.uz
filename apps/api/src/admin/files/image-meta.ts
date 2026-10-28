import { stripImageMetadata } from '../../common/image-metadata';

/**
 * Image type and size from the file header (the API has no image library). The type comes from
 * magic bytes only — never from the client's MIME type or file name.
 */
export interface ImageMeta {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  ext: 'jpg' | 'png' | 'webp';
  width: number | null;
  height: number | null;
}

/** Larger than any real product photo; also keeps `File.width/height` within int4. */
export const MAX_IMAGE_SIDE = 20_000;

/** Type + size, or null for anything that isn't a JPEG/PNG/WebP of sane dimensions. */
export function imageMeta(buf: Buffer): ImageMeta | null {
  const meta = sniff(buf);
  if (!meta) return null;
  const { width, height } = meta;
  if (
    (width !== null && (width < 1 || width > MAX_IMAGE_SIDE)) ||
    (height !== null && (height < 1 || height > MAX_IMAGE_SIDE))
  )
    return null;
  return meta;
}

/**
 * The bytes to store for an uploaded image: type/size checked, metadata (Exif/GPS, XMP, IPTC,
 * text chunks) stripped, re-checked. Null = refuse the file (not an image we accept, or it doesn't
 * parse completely). Every path that stores an image uses this (CLAUDE.md §6 "Image metadata").
 */
export function sanitizeImage(buf: Buffer): { bytes: Buffer; meta: ImageMeta } | null {
  const meta = imageMeta(buf);
  if (!meta) return null;
  const bytes = stripImageMetadata(buf, meta.mime);
  if (!bytes) return null;
  const after = imageMeta(bytes);
  if (!after || after.mime !== meta.mime) return null;
  return { bytes, meta: after };
}

function sniff(buf: Buffer): ImageMeta | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a)
    return {
      mime: 'image/png',
      ext: 'png',
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { mime: 'image/jpeg', ext: 'jpg', ...jpegSize(buf) };
  if (
    buf.length >= 30 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return { mime: 'image/webp', ext: 'webp', ...webpSize(buf) };
  return null;
}

type Size = { width: number | null; height: number | null };
const UNKNOWN: Size = { width: null, height: null };

/** Walks the JPEG segments to the first SOFn frame header. */
function jpegSize(buf: Buffer): Size {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return UNKNOWN;
    const marker = buf[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return UNKNOWN;
}

function webpSize(buf: Buffer): Size {
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ' && buf.length >= 30)
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && buf.length >= 25) {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && buf.length >= 30)
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  return UNKNOWN;
}
