import { Injectable } from '@nestjs/common';
import {
  type ApiKeyCreateInput,
  type ApiKeyCreatedDto,
  type ApiKeyDto,
  type ApiKeyScope,
  API_KEY_POLICY,
  API_KEY_SCOPES,
  DomainError,
} from '@forest/contracts';
import type { ApiKey } from '@forest/db';
import { PrismaService } from '../../prisma/prisma.service';
import { maskApiKey, newApiKey } from '../../partner/api-key';
import { type AuditActor, AuditService } from '../audit/audit.service';

const isScope = (s: string): s is ApiKeyScope => (API_KEY_SCOPES as readonly string[]).includes(s);

/** Partner API keys (CLAUDE.md §6): shown once, stored as sha256, revocable, audited. */
@Injectable()
export class ApiKeysAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private dto(k: ApiKey): ApiKeyDto {
    return {
      id: k.id,
      name: k.name,
      masked: maskApiKey(k.prefix, k.last4),
      scopes: k.scopes.filter(isScope),
      rateLimitPerMin: k.rateLimitPerMin,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
      revokedAt: k.revokedAt?.toISOString() ?? null,
    };
  }

  async list(): Promise<ApiKeyDto[]> {
    const rows = await this.prisma.apiKey.findMany({
      orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
    return rows.map((k) => this.dto(k));
  }

  async create(actor: AuditActor, input: ApiKeyCreateInput): Promise<ApiKeyCreatedDto> {
    const generated = newApiKey();
    const row = await this.prisma.$transaction(async (tx) => {
      // Serialises concurrent creates so the active-key cap can't be overshot.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('api_key.create'))`;
      if ((await tx.apiKey.count({ where: { revokedAt: null } })) >= API_KEY_POLICY.maxActiveKeys)
        throw new DomainError('API_KEY_LIMIT');
      const k = await tx.apiKey.create({
        data: {
          name: input.name,
          prefix: generated.prefix,
          keyHash: generated.hash,
          last4: generated.last4,
          scopes: input.scopes,
          rateLimitPerMin: input.rateLimitPerMin,
          createdById: actor.staffId,
        },
      });
      await this.audit.record(
        actor,
        {
          action: 'api_key.create',
          entity: 'ApiKey',
          entityId: k.id,
          after: {
            name: k.name,
            prefix: k.prefix,
            scopes: k.scopes,
            rateLimitPerMin: k.rateLimitPerMin,
          },
        },
        tx,
      );
      return k;
    });
    return { key: this.dto(row), secret: generated.key };
  }

  async revoke(actor: AuditActor, id: string): Promise<ApiKeyDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const k = await tx.apiKey.findUnique({ where: { id } });
      if (!k) throw new DomainError('NOT_FOUND');
      const next = k.revokedAt
        ? k
        : await tx.apiKey.update({
            where: { id },
            data: { revokedAt: new Date(), revokedById: actor.staffId },
          });
      await this.audit.record(
        actor,
        {
          action: 'api_key.revoke',
          entity: 'ApiKey',
          entityId: id,
          after: { prefix: k.prefix, ...(k.revokedAt ? { noop: true } : {}) },
        },
        tx,
      );
      return next;
    });
    return this.dto(row);
  }
}
