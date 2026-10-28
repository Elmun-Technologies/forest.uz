import { Injectable, Logger } from '@nestjs/common';
import { REPLAY_RETENTION_DAYS } from '@forest/contracts';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { tashkentDay } from './heatmap-days';

const ROOT = 'replays/';
const DAY_MS = 86_400_000;

/**
 * Replay retention (docs/14: 30 days) and per-customer removal. Object keys carry the session's
 * day (`replays/<day>/<sessionId>/<n>.json.gz`), so whole day folders are dropped by listing the
 * bucket — orphans (a session row deleted, a crashed flag update) go too.
 */
@Injectable()
export class ReplayRetentionService {
  private readonly logger = new Logger('ReplayRetention');

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async purge(now = new Date()): Promise<{ folders: number; objects: number; sessions: number }> {
    const cutoff = tashkentDay(new Date(now.getTime() - REPLAY_RETENTION_DAYS * DAY_MS));
    const { prefixes } = await this.files.listPrivate(ROOT, '/');
    let folders = 0;
    let objects = 0;
    for (const prefix of prefixes) {
      const day = prefix.slice(ROOT.length, -1);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= cutoff) continue;
      const { keys } = await this.files.listPrivate(prefix);
      await this.files.removeManyPrivate(keys);
      folders++;
      objects += keys.length;
    }
    const { count } = await this.prisma.session.updateMany({
      where: { hasReplay: true, replayKey: { lt: `${ROOT}${cutoff}/` } },
      data: { hasReplay: false, replayKey: null },
    });
    if (folders) this.logger.log(`purged ${objects} replay objects in ${folders} day folders`);
    return { folders, objects, sessions: count };
  }

  /** Deletes the replay objects under these session prefixes (customer erasure). */
  async removePrefixes(prefixes: readonly string[]): Promise<number> {
    let objects = 0;
    for (const prefix of prefixes) {
      if (!prefix.startsWith(ROOT)) continue;
      const { keys } = await this.files.listPrivate(prefix);
      await this.files.removeManyPrivate(keys);
      objects += keys.length;
    }
    return objects;
  }
}
