import { Injectable } from '@nestjs/common';
import type { ConsentsDto } from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { PrismaService } from '../../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

const CHANNELS = {
  smsMarketing: 'SMS_MARKETING',
  telegram: 'TELEGRAM',
  adsMatching: 'ADS_MATCHING',
} as const satisfies Record<keyof ConsentsDto, string>;

/**
 * Consent is an append-only log (docs/02): the latest row per channel is the current state, older
 * rows are the history shown in admin and in data exports.
 */
@Injectable()
export class ConsentsService {
  constructor(private readonly prisma: PrismaService) {}

  async current(customerId: string, db: Db = this.prisma): Promise<ConsentsDto> {
    const rows = await db.consent.findMany({
      where: { customerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      distinct: ['channel'],
    });
    const state = (channel: string) => rows.find((r) => r.channel === channel)?.granted ?? false;
    return {
      smsMarketing: state(CHANNELS.smsMarketing),
      telegram: state(CHANNELS.telegram),
      adsMatching: state(CHANNELS.adsMatching),
    };
  }

  /** Appends rows only for channels whose state actually changes (no duplicate history). */
  async record(
    db: Db,
    customerId: string,
    changes: Partial<ConsentsDto>,
    source: string,
  ): Promise<ConsentsDto> {
    const next = await this.current(customerId, db);
    const rows: Prisma.ConsentCreateManyInput[] = [];
    for (const key of Object.keys(CHANNELS) as (keyof ConsentsDto)[]) {
      const granted = changes[key];
      if (granted === undefined || granted === next[key]) continue;
      rows.push({ customerId, channel: CHANNELS[key], granted, source });
      next[key] = granted;
    }
    if (rows.length) await db.consent.createMany({ data: rows });
    return next;
  }
}
