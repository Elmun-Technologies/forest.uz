import {
  Body,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type AdminGalleryItemDto,
  type AdminReviewDto,
  type AdminReviewListQuery,
  adminReviewListQuerySchema,
  type AdminReviewPageDto,
  type AdminReviewsSummaryDto,
  type IdOrderInput,
  idOrderSchema,
  type ReviewGalleryInput,
  reviewGallerySchema,
  type ReviewModerateInput,
  reviewModerateSchema,
  type ReviewReplyInput,
  reviewReplySchema,
} from '@forest/contracts';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import {
  IMAGE_UPLOAD_OPTIONS,
  type UploadedImage,
  UploadErrorsInterceptor,
} from '../files/upload.service';
import { AdminCatalogCoreModule } from '../products/products.controller';
import { AdminReviewsService } from './reviews.service';

/** A15: view = O/M/Op/Mk (`reviews.view`), moderation and gallery = O/M/Mk (`reviews.moderate`). */
@AdminController('reviews')
export class AdminReviewsController {
  constructor(private readonly reviews: AdminReviewsService) {}

  @Get('summary')
  @RequirePermissions('reviews.view')
  summary(): Promise<AdminReviewsSummaryDto> {
    return this.reviews.summary();
  }

  /** Sidebar badge (pending moderation). */
  @Get('pending-count')
  @RequirePermissions('reviews.view')
  async pendingCount(): Promise<{ count: number }> {
    return { count: await this.reviews.pendingCount() };
  }

  @Get('gallery')
  @RequirePermissions('reviews.view')
  galleryItems(): Promise<AdminGalleryItemDto[]> {
    return this.reviews.galleryItems();
  }

  @Put('gallery/order')
  @RequirePermissions('reviews.moderate')
  reorderGallery(
    @Body(new ZodPipe(idOrderSchema)) body: IdOrderInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminGalleryItemDto[]> {
    return this.reviews.reorderGallery(actor, body);
  }

  @Get()
  @RequirePermissions('reviews.view')
  list(
    @Query(new ZodPipe(adminReviewListQuerySchema)) q: AdminReviewListQuery,
  ): Promise<AdminReviewPageDto> {
    return this.reviews.list(q);
  }

  @Patch(':id/status')
  @RequirePermissions('reviews.moderate')
  moderate(
    @Param('id') id: string,
    @Body(new ZodPipe(reviewModerateSchema)) body: ReviewModerateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminReviewDto> {
    return this.reviews.moderate(actor, id, body);
  }

  @Patch(':id/reply')
  @RequirePermissions('reviews.moderate')
  reply(
    @Param('id') id: string,
    @Body(new ZodPipe(reviewReplySchema)) body: ReviewReplyInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminReviewDto> {
    return this.reviews.reply(actor, id, body);
  }

  @Patch(':id/gallery')
  @RequirePermissions('reviews.moderate')
  gallery(
    @Param('id') id: string,
    @Body(new ZodPipe(reviewGallerySchema)) body: ReviewGalleryInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminReviewDto> {
    return this.reviews.gallery(actor, id, body);
  }

  @Post(':id/before-photo')
  @RequirePermissions('reviews.moderate')
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  uploadBefore(
    @Param('id') id: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Actor() actor: AuditActor,
  ): Promise<AdminReviewDto> {
    return this.reviews.uploadBefore(actor, id, file);
  }
}

@Module({
  imports: [AdminCatalogCoreModule],
  controllers: [AdminReviewsController],
  providers: [AdminReviewsService],
})
export class AdminReviewsModule {}
