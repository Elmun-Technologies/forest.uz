import { Body, Delete, Get, Module, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import {
  type AdminCwvDto,
  type AdminNotFoundDto,
  type AdminRedirectDto,
  type AdminRedirectPageDto,
  type AdminSearchQueriesDto,
  type AdminSeoOverviewDto,
  type AdminSeoPageDto,
  type AdminSeoPagesDto,
  type AdminZeroResultDto,
  indexNowInputSchema,
  notFoundDismissSchema,
  notFoundQuerySchema,
  type PageSpeedRunDto,
  pageSpeedRunInputSchema,
  type RedirectInput,
  redirectInputSchema,
  redirectListQuerySchema,
  robotsInputSchema,
  schemaTogglesInputSchema,
  searchQueriesQuerySchema,
  type SeoMetaInput,
  seoMetaInputSchema,
  type SeoSchemaToggles,
  type VerificationInput,
  verificationInputSchema,
} from '@forest/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { ZodPipe } from '../../common/http';
import type { AdminContext } from '../admin-access';
import { Actor, Admin, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { AdminSeoService } from './admin-seo.service';

/**
 * A9 SEO center (`/v1/admin/seo/*`). View and edit both need `seo.edit` (O/M/Mk, CLAUDE.md §6);
 * every non-GET is audited in the service.
 */
@AdminController('seo')
export class AdminSeoController {
  constructor(private readonly seo: AdminSeoService) {}

  @Get('overview')
  @RequirePermissions('seo.edit')
  overview(@Res({ passthrough: true }) res: Response): Promise<AdminSeoOverviewDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.seo.overview();
  }

  @Get('pages')
  @RequirePermissions('seo.edit')
  pages(): Promise<AdminSeoPagesDto> {
    return this.seo.pages();
  }

  @Put('meta')
  @RequirePermissions('seo.edit')
  saveMeta(
    @Body(new ZodPipe(seoMetaInputSchema)) body: SeoMetaInput,
    @Actor() actor: AuditActor,
    @Admin() admin: AdminContext,
  ): Promise<AdminSeoPageDto> {
    return this.seo.saveMeta(actor, body, admin.permissions.includes('seo.canonical_external'));
  }

  @Get('redirects')
  @RequirePermissions('seo.edit')
  redirects(
    @Query(new ZodPipe(redirectListQuerySchema)) q: z.infer<typeof redirectListQuerySchema>,
  ): Promise<AdminRedirectPageDto> {
    return this.seo.redirects(q);
  }

  @Post('redirects')
  @RequirePermissions('seo.edit')
  createRedirect(
    @Body(new ZodPipe(redirectInputSchema)) body: RedirectInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminRedirectDto> {
    return this.seo.saveRedirect(actor, body);
  }

  @Patch('redirects/:id')
  @RequirePermissions('seo.edit')
  updateRedirect(
    @Param('id') id: string,
    @Body(new ZodPipe(redirectInputSchema)) body: RedirectInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminRedirectDto> {
    return this.seo.saveRedirect(actor, body, id);
  }

  @Delete('redirects/:id')
  @RequirePermissions('seo.edit')
  async deleteRedirect(@Param('id') id: string, @Actor() actor: AuditActor): Promise<{ ok: true }> {
    await this.seo.deleteRedirect(actor, id);
    return { ok: true };
  }

  @Get('not-found')
  @RequirePermissions('seo.edit')
  notFound(
    @Query(new ZodPipe(notFoundQuerySchema)) q: z.infer<typeof notFoundQuerySchema>,
  ): Promise<AdminNotFoundDto[]> {
    return this.seo.notFound(q.days);
  }

  @Post('not-found/dismiss')
  @RequirePermissions('seo.edit')
  async dismiss(
    @Body(new ZodPipe(notFoundDismissSchema)) body: z.infer<typeof notFoundDismissSchema>,
    @Actor() actor: AuditActor,
  ): Promise<{ ok: true }> {
    await this.seo.dismissNotFound(actor, body.path);
    return { ok: true };
  }

  @Put('verification')
  @RequirePermissions('seo.edit')
  verification(
    @Body(new ZodPipe(verificationInputSchema)) body: VerificationInput,
    @Actor() actor: AuditActor,
  ) {
    return this.seo.saveVerification(actor, body);
  }

  @Put('robots')
  @RequirePermissions('seo.edit')
  robots(
    @Body(new ZodPipe(robotsInputSchema)) body: z.infer<typeof robotsInputSchema>,
    @Actor() actor: AuditActor,
  ) {
    return this.seo.saveRobots(actor, body.custom);
  }

  @Put('schema')
  @RequirePermissions('seo.edit')
  schema(
    @Body(new ZodPipe(schemaTogglesInputSchema)) body: SeoSchemaToggles,
    @Actor() actor: AuditActor,
  ): Promise<SeoSchemaToggles> {
    return this.seo.saveSchema(actor, body);
  }

  @Put('indexnow')
  @RequirePermissions('seo.edit')
  indexNow(
    @Body(new ZodPipe(indexNowInputSchema)) body: z.infer<typeof indexNowInputSchema>,
    @Actor() actor: AuditActor,
  ) {
    return this.seo.saveIndexNow(actor, body.enabled);
  }

  @Post('indexnow/submit-all')
  @RequirePermissions('seo.edit')
  submitAll(@Actor() actor: AuditActor) {
    return this.seo.submitAll(actor);
  }

  @Post('sitemap/regenerate')
  @RequirePermissions('seo.edit')
  regenerate(@Actor() actor: AuditActor) {
    return this.seo.regenerateSitemap(actor);
  }

  @Get('queries')
  @RequirePermissions('seo.edit')
  queries(
    @Query(new ZodPipe(searchQueriesQuerySchema)) q: z.infer<typeof searchQueriesQuerySchema>,
  ): Promise<AdminSearchQueriesDto> {
    return this.seo.queries(q.source, q.days);
  }

  @Post('queries/sync')
  @RequirePermissions('seo.edit')
  syncQueries(@Actor() actor: AuditActor) {
    return this.seo.syncQueries(actor);
  }

  @Get('cwv')
  @RequirePermissions('seo.edit')
  cwv(): Promise<AdminCwvDto> {
    return this.seo.cwv();
  }

  @Post('cwv/pagespeed')
  @RequirePermissions('seo.edit')
  pageSpeed(
    @Body(new ZodPipe(pageSpeedRunInputSchema)) body: z.infer<typeof pageSpeedRunInputSchema>,
    @Actor() actor: AuditActor,
  ): Promise<PageSpeedRunDto | null> {
    return this.seo.runPageSpeed(actor, body.path, body.strategy);
  }

  @Get('zero-results')
  @RequirePermissions('seo.edit')
  zeroResults(): Promise<AdminZeroResultDto[]> {
    return this.seo.zeroResults();
  }
}

/** `/v1/admin/seo` (A9). Core SEO services come from the global `SeoCoreModule`. */
@Module({ controllers: [AdminSeoController], providers: [AdminSeoService] })
export class AdminSeoModule {}
