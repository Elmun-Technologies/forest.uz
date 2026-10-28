import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MmdbReader, bufferSource, fileSource, ipBits, toGeo } from './geoip';

/** Minimal MMDB encoder (strings, uints, maps, arrays) for building a test database. */
function enc(v: unknown): Buffer {
  const ctrl = (type: number, size: number): Buffer => {
    const head = type <= 7 ? [(type << 5) | Math.min(size, 28)] : [Math.min(size, 28), type - 7];
    if (size < 29) return Buffer.from(head);
    throw new Error('test encoder: size too large');
  };
  if (typeof v === 'string') {
    const b = Buffer.from(v, 'utf8');
    return Buffer.concat([ctrl(2, b.length), b]);
  }
  if (typeof v === 'number') {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v);
    return Buffer.concat([ctrl(6, 4), b]);
  }
  if (Array.isArray(v)) return Buffer.concat([ctrl(11, v.length), ...v.map(enc)]);
  const entries = Object.entries(v as Record<string, unknown>);
  return Buffer.concat([ctrl(7, entries.length), ...entries.flatMap(([k, x]) => [enc(k), enc(x)])]);
}

/** IPv4 tree (24-bit records) with one /24 network → `record`. */
function buildDb(network: string, record: unknown, ipVersion: 4 | 6 = 4): Buffer {
  const prefix = (ipVersion === 6 ? Array<number>(96).fill(0) : []).concat(
    ipBits(network)!.slice(0, 24),
  );
  const nodeCount = prefix.length;
  const tree = Buffer.alloc(nodeCount * 6);
  const data = enc(record);
  prefix.forEach((bit, i) => {
    const next = i === nodeCount - 1 ? nodeCount + 16 : i + 1; // last: data pointer (offset 0)
    const empty = nodeCount;
    tree.writeUIntBE(bit ? empty : next, i * 6, 3);
    tree.writeUIntBE(bit ? next : empty, i * 6 + 3, 3);
  });
  const meta = enc({
    node_count: nodeCount,
    record_size: 24,
    ip_version: ipVersion,
    database_type: 'Test-City',
    languages: ['en'],
    binary_format_major_version: 2,
    binary_format_minor_version: 0,
  });
  return Buffer.concat([
    tree,
    Buffer.alloc(16),
    data,
    Buffer.from('abcdef4d61784d696e642e636f6d', 'hex'),
    meta,
  ]);
}

const TASHKENT = {
  country: { iso_code: 'UZ', names: { en: 'Uzbekistan' } },
  subdivisions: [{ iso_code: 'TK', names: { en: 'Tashkent' } }],
  city: { names: { en: 'Tashkent', ru: 'Ташкент' } },
};

describe('MMDB reader', () => {
  it('finds the network in an IPv4 tree and misses others', () => {
    const r = new MmdbReader(bufferSource(buildDb('84.54.64.0', TASHKENT)));
    expect(toGeo(r.get('84.54.64.77'))).toEqual({
      country: 'UZ',
      region: 'Tashkent',
      city: 'Tashkent',
    });
    expect(r.get('84.54.65.1')).toBeNull();
    expect(r.get('2001:db8::1')).toBeNull();
    expect(r.get('not-an-ip')).toBeNull();
  });

  it('IPv4 (also IPv4-mapped) in an IPv6 tree, via the file source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmdb-'));
    try {
      const file = join(dir, 'test.mmdb');
      writeFileSync(file, buildDb('10.1.2.0', TASHKENT, 6));
      const src = fileSource(file);
      const r = new MmdbReader(src);
      expect(toGeo(r.get('::ffff:10.1.2.3'))?.region).toBe('Tashkent');
      expect(toGeo(r.get('10.1.2.200'))?.country).toBe('UZ');
      expect(r.get('10.1.3.1')).toBeNull();
      src.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects files without metadata', () => {
    expect(() => new MmdbReader(bufferSource(Buffer.from('nope')))).toThrow(/metadata/);
  });

  it('ipBits', () => {
    expect(ipBits('1.2.3.4')).toHaveLength(32);
    expect(ipBits('::1')).toHaveLength(128);
    expect(ipBits('::1')!.at(-1)).toBe(1);
    expect(ipBits('fe80::1:2')).toHaveLength(128);
    expect(ipBits('x')).toBeNull();
  });
});
