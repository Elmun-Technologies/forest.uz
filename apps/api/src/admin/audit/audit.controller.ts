import { Get, Query, Res } from '@nestjs/common';
import {
  type AuditActorDto,
  type AuditPageDto,
  type AuditQuery,
  auditQuerySchema,
} from '@forest/contracts';
import type { Response } from 'express';
import { ZodPipe } from '../../common/http';
import { AdminController, RequirePermissions } from '../admin-http';
import { AuditService } from './audit.service';

/** A16 "Faoliyat jurnali": newest first, cursor pagination, filters entity/action/staff/dates. */
@AdminController('audit')
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.view')
  list(
    @Query(new ZodPipe(auditQuerySchema)) q: AuditQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuditPageDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.audit.list(q);
  }

  @Get('filters')
  @RequirePermissions('audit.view')
  async filters(): Promise<{ actors: AuditActorDto[]; entities: string[] }> {
    const [actors, entities] = await Promise.all([this.audit.actors(), this.audit.entities()]);
    return { actors, entities };
  }
}
