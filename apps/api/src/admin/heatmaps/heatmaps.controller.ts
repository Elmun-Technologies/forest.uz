import { Body, Get, Module, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  type HeatmapDto,
  type HeatmapPagesDto,
  type HeatmapPagesQuery,
  heatmapPagesQuerySchema,
  type HeatmapQuery,
  heatmapQuerySchema,
  type HeatmapRefreshInput,
  heatmapRefreshSchema,
  type ReplayListDto,
  type ReplayListQuery,
  replayListQuerySchema,
  type ReplayOpenDto,
  replaySessionIdSchema,
  type ReplaySettingsDto,
  type ReplaySettingsInput,
  replaySettingsInputSchema,
} from '@forest/contracts';
import type { Response } from 'express';
import { ZodPipe } from '../../common/http';
import { HeatmapsModule, HeatmapsScheduler } from '../../heatmaps/heatmaps.module';
import type { AdminContext } from '../admin-access';
import { Actor, Admin, AdminController, RequirePermissions } from '../admin-http';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AdminSettingsModule } from '../settings/admin-settings.module';
import { AdminSettingsService } from '../settings/admin-settings.service';
import { AdminHeatmapsService } from './heatmaps.service';
import { AdminReplaysService } from './replays.service';

/** A3 heatmaps (docs/02 "Analytics & heatmaps": `analytics.view`, O/M/Mk). */
@AdminController('heatmaps')
export class AdminHeatmapsController {
  constructor(
    private readonly heatmaps: AdminHeatmapsService,
    private readonly scheduler: HeatmapsScheduler,
    private readonly settings: AdminSettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('pages')
  @RequirePermissions('analytics.view')
  pages(
    @Query(new ZodPipe(heatmapPagesQuerySchema)) q: HeatmapPagesQuery,
  ): Promise<HeatmapPagesDto> {
    return this.heatmaps.pages(q);
  }

  @Get()
  @RequirePermissions('analytics.view')
  heatmap(@Query(new ZodPipe(heatmapQuerySchema)) q: HeatmapQuery): Promise<HeatmapDto> {
    return this.heatmaps.heatmap(q);
  }

  /** Queues a rebuild of the last N days (the hourly job covers today and yesterday). */
  @Post('refresh')
  @RequirePermissions('analytics.view')
  async refresh(
    @Body(new ZodPipe(heatmapRefreshSchema)) body: HeatmapRefreshInput,
    @Actor() actor: AuditActor,
  ): Promise<{ queued: true }> {
    await this.scheduler.enqueueAggregate(body.days);
    await this.audit.record(actor, {
      action: 'heatmap.refresh',
      entity: 'Heatmap',
      after: { days: body.days },
    });
    return { queued: true };
  }

  @Get('settings')
  @RequirePermissions('analytics.view')
  replaySettings(@Res({ passthrough: true }) res: Response): Promise<ReplaySettingsDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.settings.tracking();
  }

  /** Replay kill switch / sample rates: a privacy setting → Owner (`settings.store`). */
  @Put('settings')
  @RequirePermissions('settings.store')
  saveReplaySettings(
    @Body(new ZodPipe(replaySettingsInputSchema)) body: ReplaySettingsInput,
    @Actor() actor: AuditActor,
  ): Promise<ReplaySettingsDto> {
    return this.settings.saveTracking(actor, body);
  }
}

/** A3 session recordings. Opening one is a POST: it writes the `session.view_replay` audit row. */
@AdminController('replays')
export class AdminReplaysController {
  constructor(private readonly replays: AdminReplaysService) {}

  @Get()
  @RequirePermissions('analytics.view')
  list(
    @Query(new ZodPipe(replayListQuerySchema)) q: ReplayListQuery,
    @Admin() admin: AdminContext,
  ): Promise<ReplayListDto> {
    return this.replays.list(q, admin.staff.role);
  }

  @Post(':sessionId/open')
  @RequirePermissions('analytics.view')
  open(
    @Param('sessionId', new ZodPipe(replaySessionIdSchema)) sessionId: string,
    @Actor() actor: AuditActor,
    @Admin() admin: AdminContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReplayOpenDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.replays.open(sessionId, actor, admin.staff.role);
  }
}

@Module({
  imports: [HeatmapsModule, AdminSettingsModule],
  controllers: [AdminHeatmapsController, AdminReplaysController],
  providers: [AdminHeatmapsService, AdminReplaysService],
})
export class AdminHeatmapsModule {}
