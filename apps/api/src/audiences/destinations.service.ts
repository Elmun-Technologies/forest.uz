import { Injectable, Logger } from '@nestjs/common';
import {
  AD_DESTINATION_INTEGRATION,
  AD_DESTINATION_MIN_CREATE,
  AD_DESTINATIONS,
  type AdDestination,
  type SegmentSyncStatus,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { IntegrationsService } from '../integrations/integrations.service';
import { hashPhone } from '../integrations/providers/ads/types';
import { PrismaService } from '../prisma/prisma.service';
import { AdsProvidersService } from './ads-providers.service';
import { consentGranted } from './compile';

export interface DestinationSyncSummary {
  destination: AdDestination;
  status: SegmentSyncStatus;
  added: number;
  removed: number;
  members: number;
  error?: string;
}

/** Prefix of a stored platform id whose two-step creation (Yandex confirm) is unfinished. */
const UNCONFIRMED = 'unconfirmed:';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * Pushes segment membership to ad platforms as hashed phones (CLAUDE.md §6 "Audience
 * destinations"). `SegmentDestinationMember` mirrors what each platform holds, so every run sends
 * only the difference — including removals after consent withdrawal, erasure or a phone change.
 */
@Injectable()
export class DestinationsService {
  private readonly logger = new Logger('AudienceDestinations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ads: AdsProvidersService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** Members a platform may receive: current, live, with a phone and ADS_MATCHING granted. */
  private async desired(segmentId: string): Promise<{ customerId: string; phone: string }[]> {
    return this.prisma.$queryRaw<{ customerId: string; phone: string }[]>(Prisma.sql`
      SELECT c.id AS "customerId", c.phone FROM "SegmentMember" sm
      JOIN "Customer" c ON c.id = sm."customerId"
      WHERE sm."segmentId" = ${segmentId} AND sm."removedAt" IS NULL
        AND c."deletedAt" IS NULL AND c.phone IS NOT NULL AND ${consentGranted('ads')}`);
  }

  /**
   * `removalsOnly`: used when the segment's refresh failed — membership is stale, but members who
   * withdrew ads consent, were erased or changed phone must still leave the platforms.
   */
  async syncSegment(
    segmentId: string,
    opts: { removalsOnly?: boolean } = {},
  ): Promise<DestinationSyncSummary[]> {
    const segment = await this.prisma.segment.findUnique({ where: { id: segmentId } });
    if (!segment) return [];
    const out: DestinationSyncSummary[] = [];
    let desired: { customerId: string; phone: string }[] | null = null;
    for (const destination of AD_DESTINATIONS) {
      const enabled = segment.active && segment.destinations.includes(destination);
      const state = await this.prisma.segmentDestination.findUnique({
        where: { segmentId_destination: { segmentId, destination } },
      });
      const uploaded = await this.prisma.segmentDestinationMember.findMany({
        where: { segmentId, destination },
        select: { customerId: true, hash: true },
      });
      if (!enabled && !state && !uploaded.length) continue;
      if (enabled && !desired) desired = await this.desired(segmentId);
      out.push(
        await this.syncOne(segment.id, segment.name, destination, {
          enabled,
          externalId: state?.externalId ?? null,
          uploaded,
          desired: enabled ? (desired ?? []) : [],
          removalsOnly: opts.removalsOnly ?? false,
        }),
      );
    }
    return out;
  }

  private async syncOne(
    segmentId: string,
    name: string,
    destination: AdDestination,
    input: {
      enabled: boolean;
      externalId: string | null;
      uploaded: { customerId: string; hash: string }[];
      desired: { customerId: string; phone: string }[];
      removalsOnly: boolean;
    },
  ): Promise<DestinationSyncSummary> {
    const want = new Map<string, string>();
    for (const m of input.desired) {
      const hash = hashPhone(m.phone, destination);
      if (hash) want.set(m.customerId, hash);
    }
    const have = new Map(input.uploaded.map((u) => [u.customerId, u.hash]));
    const add = [...want].filter(([id, h]) => have.get(id) !== h);

    const save = (
      status: SegmentSyncStatus,
      data: { error?: string; externalId?: string | null },
    ) =>
      this.prisma.segmentDestination.upsert({
        where: { segmentId_destination: { segmentId, destination } },
        create: {
          segmentId,
          destination,
          status,
          externalId: data.externalId ?? input.externalId,
          members: have.size,
          lastError: data.error ?? null,
          lastSyncAt: status === 'ok' || status === 'off' ? new Date() : null,
        },
        update: {
          status,
          ...(data.externalId !== undefined ? { externalId: data.externalId } : {}),
          lastError: data.error ?? null,
          ...(status === 'ok' || status === 'off' ? { lastSyncAt: new Date() } : {}),
        },
      });
    const summary = (status: SegmentSyncStatus, extra: Partial<DestinationSyncSummary> = {}) => ({
      destination,
      status,
      added: 0,
      removed: 0,
      members: have.size,
      ...extra,
    });

    const provider = await this.ads.audience(destination);
    if (!provider) {
      // Not connected: nothing can be sent or removed; keep the mirror as it is.
      if (!input.removalsOnly) await save(input.enabled ? 'not_connected' : 'off', {});
      return summary(input.enabled ? 'not_connected' : 'off');
    }
    let externalId = input.externalId;
    let added = 0;
    let removed = 0;
    try {
      if (input.enabled && !externalId && !input.removalsOnly) {
        if (want.size < AD_DESTINATION_MIN_CREATE[destination]) {
          await save('too_small', {});
          return summary('too_small');
        }
        const created = await provider.create(
          name,
          add.map(([, h]) => h),
        );
        // Stored before any further call: a later failure continues on this audience next time
        // instead of creating another one.
        externalId = provider.confirm ? `${UNCONFIRMED}${created.id}` : created.id;
        await save('pending', { externalId });
        if (created.seeded) {
          await this.record(segmentId, destination, add, []);
          for (const [id, h] of add) have.set(id, h);
          added += add.length;
        }
      }
      if (externalId?.startsWith(UNCONFIRMED) && provider.confirm) {
        const id = externalId.slice(UNCONFIRMED.length);
        await provider.confirm(id, name);
        externalId = id;
        await this.prisma.segmentDestination.update({
          where: { segmentId_destination: { segmentId, destination } },
          data: { externalId },
        });
      }
      if (externalId && !externalId.startsWith(UNCONFIRMED)) {
        const toRemove = [...have].filter(([id, h]) => want.get(id) !== h);
        if (toRemove.length) {
          await provider.remove(externalId, [...new Set(toRemove.map(([, h]) => h))]);
          await this.record(segmentId, destination, [], toRemove);
          for (const [id] of toRemove) have.delete(id);
          removed += toRemove.length;
        }
        const toAdd = input.removalsOnly ? [] : [...want].filter(([id, h]) => have.get(id) !== h);
        if (toAdd.length) {
          await provider.add(
            externalId,
            toAdd.map(([, h]) => h),
          );
          await this.record(segmentId, destination, toAdd, []);
          for (const [id, h] of toAdd) have.set(id, h);
          added += toAdd.length;
        }
      }
      const status: SegmentSyncStatus = input.enabled ? 'ok' : 'off';
      await this.prisma.segmentDestination.update({
        where: { segmentId_destination: { segmentId, destination } },
        // A removal-only pass (refresh failed) keeps the status the last full sync set.
        data: input.removalsOnly
          ? { members: have.size }
          : { status, members: have.size, lastError: null, lastSyncAt: new Date() },
      });
      await this.log(destination, true, segmentId, added, removed);
      return summary(status, { added, removed, members: have.size });
    } catch (e) {
      const error = errorText(e);
      this.logger.warn(`segment ${segmentId} → ${destination}: ${error}`);
      await this.prisma.segmentDestination.upsert({
        where: { segmentId_destination: { segmentId, destination } },
        create: {
          segmentId,
          destination,
          status: 'error',
          externalId,
          members: have.size,
          lastError: error,
        },
        update: { status: 'error', members: have.size, lastError: error },
      });
      await this.log(destination, false, segmentId, added, removed, error);
      return summary('error', { error, members: have.size });
    }
  }

  /** Mirror rows for what the platform accepted. */
  private async record(
    segmentId: string,
    destination: AdDestination,
    added: [string, string][],
    removed: [string, string][],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (removed.length)
        await tx.segmentDestinationMember.deleteMany({
          where: { segmentId, destination, customerId: { in: removed.map(([id]) => id) } },
        });
      for (const [customerId, hash] of added)
        await tx.segmentDestinationMember.upsert({
          where: { segmentId_destination_customerId: { segmentId, destination, customerId } },
          create: { segmentId, destination, customerId, hash },
          update: { hash, syncedAt: new Date() },
        });
    });
  }

  private async log(
    destination: AdDestination,
    ok: boolean,
    segmentId: string,
    added: number,
    removed: number,
    error?: string,
  ): Promise<void> {
    await this.integrations
      .log(AD_DESTINATION_INTEGRATION[destination], {
        direction: 'OUT',
        kind: 'audience.sync',
        ok,
        message: ok
          ? `segment ${segmentId}: +${added} / −${removed}`
          : `segment ${segmentId}: ${error ?? 'failed'}`,
      })
      .catch((e: unknown) => this.logger.warn(`integration log failed: ${String(e)}`));
  }
}
