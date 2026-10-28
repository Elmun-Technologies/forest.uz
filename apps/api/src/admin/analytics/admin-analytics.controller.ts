import { Body, Get, Header, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import {
  type AdSpendImportInput,
  adSpendImportSchema,
  type AdSpendImportResultDto,
  type AdSpendSummaryDto,
  type AdSpendSummaryQuery,
  adSpendSummaryQuerySchema,
  type AdSpendSyncInput,
  adSpendSyncSchema,
  type AnalyticsQuery,
  analyticsQuerySchema,
  type CohortsDto,
  type CustomerJourneyDto,
  type DashboardDto,
  type DashboardQuery,
  dashboardQuerySchema,
  type DevicesDto,
  type EventsDto,
  type FunnelDto,
  type OrderJourneyDto,
  type PagesDto,
  type RealtimeDto,
  type SourcesDto,
} from '@forest/contracts';
import { ZodPipe } from '../../common/http';
import type { AdminContext } from '../admin-access';
import { Actor, Admin, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { AdSpendService } from './ad-spend.service';
import { DashboardService } from './dashboard.service';
import { JourneyService } from './journey.service';
import { RealtimeService } from './realtime.service';
import { ReportsService } from './reports.service';

/**
 * A1 dashboard (`dashboard.view`; analytics blocks need `analytics.view`), A2 reports
 * (`analytics.view`), ad spend import (`analytics.import`), journeys (A5 `customers.view`, A7
 * `orders.view`, both + `analytics.view`). Reports are personal to the role: never cached.
 */
@AdminController()
export class AdminAnalyticsController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly reports: ReportsService,
    private readonly realtime: RealtimeService,
    private readonly adSpend: AdSpendService,
    private readonly journeys: JourneyService,
  ) {}

  @Get('dashboard')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('dashboard.view')
  dashboard(
    @Query(new ZodPipe(dashboardQuerySchema)) q: DashboardQuery,
    @Admin() admin: AdminContext,
  ): Promise<DashboardDto> {
    return this.dashboardService.dashboard(q, admin.permissions);
  }

  @Get('analytics/realtime')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('analytics.view')
  realtimeSnapshot(): Promise<RealtimeDto> {
    return this.realtime.snapshot();
  }

  @Get('analytics/sources')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('analytics.view')
  sources(@Query(new ZodPipe(analyticsQuerySchema)) q: AnalyticsQuery): Promise<SourcesDto> {
    return this.reports.sources(q);
  }

  @Get('analytics/pages')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('analytics.view')
  pages(@Query(new ZodPipe(analyticsQuerySchema)) q: AnalyticsQuery): Promise<PagesDto> {
    return this.reports.pages(q);
  }

  @Get('analytics/events')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('analytics.view')
  events(@Query(new ZodPipe(analyticsQuerySchema)) q: AnalyticsQuery): Promise<EventsDto> {
    return this.reports.events(q);
  }

  @Get('analytics/funnel')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('analytics.view')
  funnel(@Query(new ZodPipe(analyticsQuerySchema)) q: AnalyticsQuery): Promise<FunnelDto> {
    return this.reports.funnel(q);
  }

  @Get('analytics/devices')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('analytics.view')
  devices(@Query(new ZodPipe(analyticsQuerySchema)) q: AnalyticsQuery): Promise<DevicesDto> {
    return this.reports.devices(q);
  }

  @Get('analytics/cohorts')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('analytics.view')
  cohorts(): Promise<CohortsDto> {
    return this.reports.cohorts();
  }

  @Get('analytics/ad-spend')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('analytics.view')
  adSpendSummary(
    @Query(new ZodPipe(adSpendSummaryQuerySchema)) q: AdSpendSummaryQuery,
  ): Promise<AdSpendSummaryDto> {
    return this.adSpend.summary(q);
  }

  @Post('analytics/ad-spend/import')
  @HttpCode(200)
  @RequirePermissions('analytics.import')
  importAdSpend(
    @Body(new ZodPipe(adSpendImportSchema)) body: AdSpendImportInput,
    @Actor() actor: AuditActor,
  ): Promise<AdSpendImportResultDto> {
    return this.adSpend.importCsv(actor, body.csv);
  }

  @Post('analytics/ad-spend/sync')
  @HttpCode(200)
  @RequirePermissions('analytics.import')
  syncAdSpend(
    @Body(new ZodPipe(adSpendSyncSchema)) body: AdSpendSyncInput,
    @Actor() actor: AuditActor,
  ): Promise<AdSpendImportResultDto> {
    return this.adSpend.sync(actor, body);
  }

  @Get('analytics/customers/:id/journey')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('customers.view', 'analytics.view')
  customerJourney(@Param('id') id: string): Promise<CustomerJourneyDto> {
    return this.journeys.customer(id);
  }

  @Get('analytics/orders/:number/journey')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('orders.view', 'analytics.view')
  orderJourney(@Param('number') number: string): Promise<OrderJourneyDto> {
    return this.journeys.order(number);
  }
}

/** `/v1/admin/dashboard` + `/v1/admin/analytics/*` (Phase 4 reports). */
@Module({
  controllers: [AdminAnalyticsController],
  providers: [ReportsService, DashboardService, RealtimeService, AdSpendService, JourneyService],
})
export class AdminAnalyticsModule {}
