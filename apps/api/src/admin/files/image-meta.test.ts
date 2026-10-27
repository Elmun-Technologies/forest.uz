import { imageMeta } from './image-meta';

describe('imageMeta (magic bytes, header size)', () => {
  it('reads PNG width/height from IHDR', () => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(1200, 16);
    b.writeUInt32BE(800, 20);
    expect(imageMeta(b)).toEqual({ mime: 'image/png', ext: 'png', width: 1200, height: 800 });
  });

  it('walks JPEG segments to the SOF frame', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
    const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0];
    const b = Buffer.from([0xff, 0xd8, ...app0, ...sof0]);
    expect(imageMeta(b)).toEqual({ mime: 'image/jpeg', ext: 'jpg', width: 640, height: 480 });
  });

  it('reads lossy, lossless and extended WebP sizes', () => {
    const webp = (chunk: string, fill: (b: Buffer) => void) => {
      const b = Buffer.alloc(40);
      b.write('RIFF', 0, 'ascii');
      b.write('WEBP', 8, 'ascii');
      b.write(chunk, 12, 'ascii');
      fill(b);
      return b;
    };
    expect(
      imageMeta(
        webp('VP8 ', (b) => {
          b.writeUInt16LE(300, 26);
          b.writeUInt16LE(200, 28);
        }),
      ),
    ).toMatchObject({ mime: 'image/webp', width: 300, height: 200 });
    expect(
      imageMeta(webp('VP8L', (b) => b.writeUInt32LE((299 & 0x3fff) | ((199 & 0x3fff) << 14), 21))),
    ).toMatchObject({ width: 300, height: 200 });
    expect(
      imageMeta(
        webp('VP8X', (b) => {
          b.writeUIntLE(1919, 24, 3);
          b.writeUIntLE(1079, 27, 3);
        }),
      ),
    ).toMatchObject({ width: 1920, height: 1080 });
  });

  it('rejects absurd dimensions (int4 overflow, decompression bombs)', () => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(0xffffffff, 16);
    b.writeUInt32BE(10, 20);
    expect(imageMeta(b)).toBeNull();
    b.writeUInt32BE(20_001, 16);
    expect(imageMeta(b)).toBeNull();
    b.writeUInt32BE(20_000, 16);
    expect(imageMeta(b)).toMatchObject({ width: 20_000, height: 10 });
  });

  it('rejects anything else (SVG, GIF, text) whatever the name says', () => {
    expect(imageMeta(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(imageMeta(Buffer.from('GIF89a........'))).toBeNull();
    expect(imageMeta(Buffer.alloc(0))).toBeNull();
  });
});
