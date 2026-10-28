import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { isIP } from 'node:net';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/**
 * IP → country/region/city from a local MaxMind DB file (docs/07: DB-IP Lite City or GeoLite2
 * City, refreshed monthly, path in `GEOIP_DB_PATH`). In-repo read-only reader of the documented
 * MMDB v2 format (search tree + data section), reading the file through a small page cache so
 * the ~100 MB database is never loaded into memory. No file → every lookup is null.
 * The IP itself is never stored anywhere.
 */
export interface Geo {
  country: string | null;
  region: string | null;
  city: string | null;
}

/** Random access to the database bytes. */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Buffer;
}

export function bufferSource(buf: Buffer): ByteSource {
  return { size: buf.length, read: (o, l) => buf.subarray(o, o + l) };
}

const PAGE = 4096;
const MAX_PAGES = 512;

/** File-backed source with an LRU of 4 KB pages (≤ 2 MB). */
export function fileSource(path: string): ByteSource & { close(): void } {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  const pages = new Map<number, Buffer>();
  const page = (n: number): Buffer => {
    let p = pages.get(n);
    if (p) {
      pages.delete(n);
      pages.set(n, p);
      return p;
    }
    p = Buffer.alloc(Math.min(PAGE, size - n * PAGE));
    readSync(fd, p, 0, p.length, n * PAGE);
    pages.set(n, p);
    if (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value!);
    return p;
  };
  return {
    size,
    read(offset, length) {
      const first = Math.floor(offset / PAGE);
      const last = Math.floor((offset + length - 1) / PAGE);
      if (first === last) return page(first).subarray(offset % PAGE, (offset % PAGE) + length);
      const parts: Buffer[] = [];
      for (let n = first; n <= last; n++) parts.push(page(n));
      const start = offset - first * PAGE;
      return Buffer.concat(parts).subarray(start, start + length);
    },
    close: () => closeSync(fd),
  };
}

const METADATA_MARKER = Buffer.from('abcdef4d61784d696e642e636f6d', 'hex');

export class MmdbReader {
  private readonly nodeCount: number;
  private readonly recordSize: number;
  private readonly ipVersion: number;
  private readonly treeSize: number;
  private ipv4Start = -1;

  constructor(private readonly src: ByteSource) {
    // The metadata map follows the last marker, within the last 128 KiB of the file.
    const tailLen = Math.min(src.size, 128 * 1024);
    const tail = src.read(src.size - tailLen, tailLen);
    const at = tail.lastIndexOf(METADATA_MARKER);
    if (at < 0) throw new Error('not a MaxMind DB file (metadata marker missing)');
    const metaStart = src.size - tailLen + at + METADATA_MARKER.length;
    const meta = this.decode(metaStart, metaStart)[0] as Record<string, unknown>;
    this.nodeCount = Number(meta.node_count);
    this.recordSize = Number(meta.record_size);
    this.ipVersion = Number(meta.ip_version);
    if (![24, 28, 32].includes(this.recordSize) || !(this.nodeCount > 0))
      throw new Error('unsupported MaxMind DB metadata');
    this.treeSize = (this.recordSize * 2 * this.nodeCount) / 8;
  }

  /** The data record for an IPv4/IPv6 address, or null. */
  get(ip: string): unknown {
    const bits = ipBits(ip);
    if (!bits) return null;
    let node: number;
    let path: number[];
    if (bits.length === 32 && this.ipVersion === 6) {
      node = this.ipv4StartNode();
      path = bits;
    } else if (bits.length === 128 && this.ipVersion === 4) {
      return null;
    } else {
      node = 0;
      path = bits;
    }
    for (const bit of path) {
      if (node >= this.nodeCount) break;
      node = this.record(node, bit);
    }
    if (node <= this.nodeCount) return null;
    const offset = node - this.nodeCount - 16;
    const base = this.treeSize + 16;
    return this.decode(base + offset, base)[0];
  }

  /** IPv4 addresses live under ::/96 in an IPv6 tree. */
  private ipv4StartNode(): number {
    if (this.ipv4Start >= 0) return this.ipv4Start;
    let node = 0;
    for (let i = 0; i < 96 && node < this.nodeCount; i++) node = this.record(node, 0);
    return (this.ipv4Start = node);
  }

  private record(node: number, bit: number): number {
    const size = this.recordSize;
    const b = this.src.read((node * size * 2) / 8, (size * 2) / 8);
    if (size === 24) return bit ? b.readUIntBE(3, 3) : b.readUIntBE(0, 3);
    if (size === 32) return bit ? b.readUInt32BE(4) : b.readUInt32BE(0);
    // 28 bits: the middle byte holds the high nibbles of both records.
    return bit
      ? ((b[3]! & 0x0f) << 24) | b.readUIntBE(4, 3)
      : (((b[3]! & 0xf0) << 20) | b.readUIntBE(0, 3)) >>> 0;
  }

  /** Decodes the value at `offset`; returns [value, next offset]. `base` = data section start. */
  private decode(offset: number, base: number): [unknown, number] {
    const ctrl = this.src.read(offset, 1)[0]!;
    let pos = offset + 1;
    let type = ctrl >> 5;
    if (type === 1) {
      const ss = (ctrl >> 3) & 0x3;
      const v = ctrl & 0x7;
      const b = this.src.read(pos, ss + 1);
      const ptr =
        ss === 0
          ? (v << 8) | b[0]!
          : ss === 1
            ? ((v << 16) | b.readUInt16BE(0)) + 2048
            : ss === 2
              ? ((v << 24) | b.readUIntBE(0, 3)) + 526_336
              : b.readUInt32BE(0);
      return [this.decode(base + ptr, base)[0], pos + ss + 1];
    }
    if (type === 0) {
      type = 7 + this.src.read(pos, 1)[0]!;
      pos++;
    }
    let size = ctrl & 0x1f;
    if (size >= 29) {
      const n = size - 28;
      const ext = this.src.read(pos, n).readUIntBE(0, n);
      size = size === 29 ? 29 + ext : size === 30 ? 285 + ext : 65_821 + ext;
      pos += n;
    }
    switch (type) {
      case 2:
        return [this.src.read(pos, size).toString('utf8'), pos + size];
      case 3:
        return [this.src.read(pos, 8).readDoubleBE(0), pos + 8];
      case 4:
        return [Buffer.from(this.src.read(pos, size)), pos + size];
      case 5:
      case 6:
      case 9:
      case 10:
        return [size ? Number(uint(this.src.read(pos, size))) : 0, pos + size];
      case 8:
        return [size ? this.src.read(pos, size).readIntBE(0, size) : 0, pos + size];
      case 7: {
        const out: Record<string, unknown> = {};
        for (let i = 0; i < size; i++) {
          const [k, a] = this.decode(pos, base);
          const [v, b] = this.decode(a, base);
          out[String(k)] = v;
          pos = b;
        }
        return [out, pos];
      }
      case 11: {
        const out: unknown[] = [];
        for (let i = 0; i < size; i++) {
          const [v, b] = this.decode(pos, base);
          out.push(v);
          pos = b;
        }
        return [out, pos];
      }
      case 14:
        return [size !== 0, pos];
      case 15:
        return [this.src.read(pos, 4).readFloatBE(0), pos + 4];
      default:
        throw new Error(`unsupported MaxMind DB data type ${type}`);
    }
  }
}

function uint(b: Buffer): bigint {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}

/** Address bits (32 for IPv4 incl. IPv4-mapped IPv6, 128 for IPv6), or null. */
export function ipBits(raw: string): number[] | null {
  const ip = raw.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  const kind = isIP(ip);
  const bits: number[] = [];
  const push = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1);
  };
  if (kind === 4) {
    for (const p of ip.split('.')) push(Number(p), 8);
    return bits;
  }
  if (kind !== 6) return null;
  const [head = '', tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const groups = [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t];
  for (const g of groups) push(parseInt(g, 16) || 0, 16);
  return bits.length === 128 ? bits : null;
}

const name = (v: unknown): string | null => {
  const names = (v as { names?: Record<string, unknown> } | undefined)?.names;
  const n = names?.en ?? names?.ru;
  return typeof n === 'string' ? n.slice(0, 80) : null;
};

/** GeoLite2 / DB-IP City record → Geo. */
export function toGeo(rec: unknown): Geo | null {
  if (!rec || typeof rec !== 'object') return null;
  const r = rec as { country?: { iso_code?: unknown }; subdivisions?: unknown[]; city?: unknown };
  const country = typeof r.country?.iso_code === 'string' ? r.country.iso_code : null;
  const region = name(r.subdivisions?.[0]);
  const city = name(r.city);
  return country || region || city ? { country, region, city } : null;
}

@Injectable()
export class GeoIpService implements OnModuleDestroy {
  private readonly logger = new Logger('GeoIp');
  private reader: MmdbReader | null = null;
  private source: (ByteSource & { close(): void }) | null = null;

  constructor(@Inject(ENV) env: Env) {
    if (!env.GEOIP_DB_PATH) return;
    try {
      this.source = fileSource(env.GEOIP_DB_PATH);
      this.reader = new MmdbReader(this.source);
    } catch (e) {
      // Analytics keeps working without geo (regions show as unknown).
      this.logger.warn(`GeoIP database unavailable: ${e instanceof Error ? e.message : String(e)}`);
      this.source?.close();
      this.source = null;
    }
  }

  lookup(ip: string | null | undefined): Geo | null {
    if (!this.reader || !ip) return null;
    try {
      return toGeo(this.reader.get(ip));
    } catch {
      return null;
    }
  }

  onModuleDestroy(): void {
    this.source?.close();
  }
}
