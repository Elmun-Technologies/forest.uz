import { Body, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type AdminSegmentDto,
  type AdminSegmentListDto,
  type AdminSegmentMembersDto,
  type AudienceRules,
  type AudienceSizeDto,
  audiencePreviewQuerySchema,
  type SegmentCreateInput,
  segmentCreateSchema,
  segmentMembersQuerySchema,
  type SegmentUpdateInput,
  segmentUpdateSchema,
} from '@forest/contracts';
import { AudiencesModule } from '../../audiences/audiences.module';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { AdminAudiencesService } from './audiences.service';

/** A8 Auditoriyalar: O/M/Mk (`audiences.edit`). Members are listed masked only. */
@AdminController('audiences')
export class AdminAudiencesController {
  constructor(private readonly audiences: AdminAudiencesService) {}

  @Get()
  @RequirePermissions('audiences.edit')
  list(): Promise<AdminSegmentListDto> {
    return this.audiences.list();
  }

  /** Live size of unsaved rules — a read, so a GET (rules as base64url JSON). */
  @Get('preview')
  @RequirePermissions('audiences.edit')
  preview(
    @Query(new ZodPipe(audiencePreviewQuerySchema)) q: { rules: AudienceRules },
  ): Promise<AudienceSizeDto> {
    return this.audiences.preview(q.rules);
  }

  @Get(':id')
  @RequirePermissions('audiences.edit')
  get(@Param('id') id: string): Promise<AdminSegmentDto> {
    return this.audiences.get(id);
  }

  @Get(':id/members')
  @RequirePermissions('audiences.edit')
  members(
    @Param('id') id: string,
    @Query(new ZodPipe(segmentMembersQuerySchema)) q: { cursor?: string; limit: number },
  ): Promise<AdminSegmentMembersDto> {
    return this.audiences.members(id, q);
  }

  @Post()
  @RequirePermissions('audiences.edit')
  create(
    @Body(new ZodPipe(segmentCreateSchema)) body: SegmentCreateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminSegmentDto> {
    return this.audiences.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('audiences.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(segmentUpdateSchema)) body: SegmentUpdateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminSegmentDto> {
    return this.audiences.update(actor, id, body);
  }

  @Post(':id/refresh')
  @RequirePermissions('audiences.edit')
  refresh(@Param('id') id: string, @Actor() actor: AuditActor): Promise<{ queued: true }> {
    return this.audiences.refreshNow(actor, id);
  }
}

@Module({
  imports: [AudiencesModule],
  controllers: [AdminAudiencesController],
  providers: [AdminAudiencesService],
})
export class AdminAudiencesModule {}
