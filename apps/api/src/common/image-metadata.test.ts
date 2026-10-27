import { crc32 } from 'node:zlib';
import { imageMeta, sanitizeImage } from '../admin/files/image-meta';
import { stripImageMetadata } from './image-metadata';

const ascii = (s: string) => Buffer.from(s, 'latin1');

/** JPEG segment with a length field: FF <marker> <len> <payload>. */
function seg(marker: number, payload: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** Exif APP1 payload with a big-endian TIFF header and a GPS IFD tag + its text. */
function exifPayload(): Buffer {
  return Buffer.concat([
    ascii('Exif\0\0MM\0*\0\0\0\x08'),
    Buffer.from([0x00, 0x01, 0x88, 0x25, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0, 0, 0, 0x1a]),
    ascii('GPSLatitude 41.3111N 69.2797E Tashkent'),
  ]);
}

describe('stripImageMetadata — JPEG', () => {
  const soi = Buffer.from([0xff, 0xd8]);
  const eoi = Buffer.from([0xff, 0xd9]);
  const jfif = seg(0xe0, ascii('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'));
  const icc = seg(0xe2, ascii('ICC_PROFILE\0\x01\x01fake-profile'));
  const adobe = seg(0xee, ascii('Adobe\0\x64\0\0\0\0\x01'));
  const exif = seg(0xe1, exifPayload());
  const xmp = seg(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPSPosition</x:xmpmeta>'));
  const iptc = seg(0xed, ascii('Photoshop 3.0\x008BIM\x04\x04 City: Tashkent'));
  const mpf = seg(0xe2, ascii('MPF\0secondary-image'));
  const com = seg(0xfe, ascii('shot on my phone at home'));
  const dqt = seg(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)]));
  // SOF0: precision 8, height 3, width 4, 1 component.
  const sof0 = seg(0xc0, Buffer.from([0x08, 0x00, 0x03, 0x00, 0x04, 0x01, 0x01, 0x11, 0x00]));
  const dht = seg(0xc4, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(16, 0)]));
  const sos = seg(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]));
  // Entropy data with byte stuffing (FF 00) and a restart marker (FF D0): copied verbatim.
  const scan = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78]);

  it('drops Exif/GPS, XMP, IPTC, MPF, comments and trailers; keeps JFIF, ICC, Adobe and image data', () => {
    const input = Buffer.concat([
      soi,
      jfif,
      exif,
      xmp,
      icc,
      mpf,
      iptc,
      adobe,
      com,
      dqt,
      sof0,
      dht,
      sos,
      scan,
      eoi,
      ascii('MotionPhoto_Data GPS trailer'),
    ]);
    const out = stripImageMetadata(input, 'image/jpeg')!;
    expect(out).toEqual(Buffer.concat([soi, jfif, icc, adobe, dqt, sof0, dht, sos, scan, eoi]));
    const text = out.toString('latin1');
    for (const s of ['Exif', 'GPS', 'xmpmeta', 'Photoshop', 'MPF', 'my phone', 'MotionPhoto'])
      expect(text).not.toContain(s);
    expect(imageMeta(out)).toEqual({ mime: 'image/jpeg', ext: 'jpg', width: 4, height: 3 });
  });

  it('walks progressive scans and drops APPn segments between them', () => {
    const input = Buffer.concat([soi, sof0, dht, sos, scan, exif, dht, sos, scan, eoi]);
    expect(stripImageMetadata(input, 'image/jpeg')).toEqual(
      Buffer.concat([soi, sof0, dht, sos, scan, dht, sos, scan, eoi]),
    );
  });

  it('is a no-op on an image without metadata', () => {
    const clean = Buffer.concat([soi, jfif, dqt, sof0, dht, sos, scan, eoi]);
    expect(stripImageMetadata(clean, 'image/jpeg')).toEqual(clean);
  });

  it('refuses truncated or malformed files', () => {
    const full = Buffer.concat([soi, exif, sof0, sos, scan, eoi]);
    expect(stripImageMetadata(full.subarray(0, 10), 'image/jpeg')).toBeNull(); // cut inside APP1
    expect(stripImageMetadata(Buffer.concat([soi, sof0, sos, scan]), 'image/jpeg')).toBeNull();
    expect(
      stripImageMetadata(Buffer.concat([soi, Buffer.from([0x00, 0x01])]), 'image/jpeg'),
    ).toBeNull();
    expect(stripImageMetadata(Buffer.concat([soi, sof0]), 'image/jpeg')).toBeNull(); // no EOI
    expect(sanitizeImage(full.subarray(0, full.length - 4))).toBeNull();
  });
});

describe('stripImageMetadata — PNG', () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function chunk(type: string, data: Buffer): Buffer {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  }
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1200, 0);
  ihdrData.writeUInt32BE(800, 4);
  ihdrData.set([8, 2, 0, 0, 0], 8);
  const ihdr = chunk('IHDR', ihdrData);
  const iccp = chunk('iCCP', ascii('sRGB\0\0compressed-profile'));
  const idat = chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00]));
  const iend = chunk('IEND', Buffer.alloc(0));

  it('drops eXIf, tEXt, zTXt, iTXt and tIME; other chunks are copied whole (CRCs intact)', () => {
    const input = Buffer.concat([
      sig,
      ihdr,
      chunk('tEXt', ascii('Comment\0GPS 41.31 69.27')),
      iccp,
      chunk('eXIf', exifPayload().subarray(6)),
      chunk('zTXt', ascii('Author\0\0xyz')),
      idat,
      chunk('iTXt', ascii('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>')),
      chunk('tIME', Buffer.from([0x07, 0xea, 10, 27, 12, 0, 0])),
      iend,
      ascii('junk after IEND GPS'),
    ]);
    const out = stripImageMetadata(input, 'image/png')!;
    expect(out).toEqual(Buffer.concat([sig, ihdr, iccp, idat, iend]));
    expect(out.toString('latin1')).not.toContain('GPS');
    expect(imageMeta(out)).toEqual({ mime: 'image/png', ext: 'png', width: 1200, height: 800 });
  });

  it('refuses a truncated chunk or a first chunk other than IHDR', () => {
    const good = Buffer.concat([sig, ihdr, idat, iend]);
    expect(stripImageMetadata(good.subarray(0, good.length - 3), 'image/png')).toBeNull();
    expect(stripImageMetadata(Buffer.concat([sig, idat, ihdr, iend]), 'image/png')).toBeNull();
    expect(stripImageMetadata(sig, 'image/png')).toBeNull();
  });
});

describe('stripImageMetadata — WebP', () => {
  function chunk(fourcc: string, data: Buffer): Buffer {
    const head = Buffer.alloc(8);
    head.write(fourcc, 0, 'latin1');
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  }
  function riff(...chunks: Buffer[]): Buffer {
    const body = Buffer.concat(chunks);
    const head = Buffer.alloc(12);
    head.write('RIFF', 0, 'latin1');
    head.writeUInt32LE(4 + body.length, 4);
    head.write('WEBP', 8, 'latin1');
    return Buffer.concat([head, body]);
  }
  // VP8X: flags (ICC 0x20, alpha 0x10, EXIF 0x08, XMP 0x04), reserved, canvas 640×480 (minus one).
  const vp8x = (flags: number) => {
    const d = Buffer.alloc(10);
    d[0] = flags;
    d.writeUIntLE(639, 4, 3);
    d.writeUIntLE(479, 7, 3);
    return chunk('VP8X', d);
  };
  const iccp = chunk('ICCP', ascii('profile'));
  const alph = chunk('ALPH', Buffer.from([0x00, 0x01, 0x02]));
  const vp8l = chunk('VP8L', Buffer.from([0x2f, 0x7f, 0xc0, 0xdd, 0x01, 0x10, 0x07]));

  it('drops EXIF and XMP chunks, clears their VP8X flags and rewrites the RIFF size', () => {
    const input = Buffer.concat([
      riff(
        vp8x(0x20 | 0x10 | 0x08 | 0x04),
        iccp,
        alph,
        vp8l,
        chunk('EXIF', exifPayload().subarray(6)), // odd size: padded
        chunk('XMP ', ascii('<x:xmpmeta>GPSPosition</x:xmpmeta>')),
      ),
      ascii('bytes past the RIFF size GPS'),
    ]);
    const out = stripImageMetadata(input, 'image/webp')!;
    expect(out).toEqual(riff(vp8x(0x20 | 0x10), iccp, alph, vp8l));
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect(out.toString('latin1')).not.toContain('GPS');
    expect(imageMeta(out)).toEqual({ mime: 'image/webp', ext: 'webp', width: 640, height: 480 });
  });

  it('refuses a RIFF size beyond the data or a chunk overrunning it', () => {
    const good = riff(vp8x(0), vp8l);
    const longRiff = Buffer.from(good);
    longRiff.writeUInt32LE(good.length + 100, 4);
    expect(stripImageMetadata(longRiff, 'image/webp')).toBeNull();
    const longChunk = Buffer.from(good);
    longChunk.writeUInt32LE(1000, 16); // VP8X size
    expect(stripImageMetadata(longChunk, 'image/webp')).toBeNull();
  });
});

describe('sanitizeImage', () => {
  it('returns stripped bytes with their header size, or null for non-images', () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      seg(0xe1, exifPayload()),
      seg(0xc0, Buffer.from([0x08, 0x01, 0xe0, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00])),
      Buffer.from([0xff, 0xd9]),
    ]);
    const res = sanitizeImage(jpeg)!;
    expect(res.meta).toEqual({ mime: 'image/jpeg', ext: 'jpg', width: 640, height: 480 });
    expect(res.bytes.toString('latin1')).not.toContain('GPS');
    expect(sanitizeImage(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});
