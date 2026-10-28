import {
  Body,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type AdminArticleDto,
  type AdminArticleListDto,
  type AdminUploadedImageDto,
  type ArticleDeleteInput,
  articleDeleteSchema,
  type ArticleSaveInput,
  articleSaveSchema,
  CMS_ARTICLE_KIND,
  CMS_PAGE_KIND,
  BRAND_PAGE_SLUG,
  cmsSlugSchema,
} from '@forest/contracts';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import {
  IMAGE_UPLOAD_OPTIONS,
  type UploadedImage,
  UploadErrorsInterceptor,
} from '../files/upload.service';
import { ContentAdminService } from './content-admin.service';

/** Ilhom articles + Brend story (`content.edit`, O/M/Mk — CLAUDE.md §6). */
@AdminController('content')
export class AdminContentController {
  constructor(private readonly content: ContentAdminService) {}

  @Get('articles')
  @RequirePermissions('content.edit')
  list(): Promise<AdminArticleListDto> {
    return this.content.list();
  }

  @Get('articles/:slug')
  @RequirePermissions('content.edit')
  get(@Param('slug', new ZodPipe(cmsSlugSchema)) slug: string): Promise<AdminArticleDto> {
    return this.content.get(CMS_ARTICLE_KIND, slug);
  }

  @Post('articles')
  @RequirePermissions('content.edit')
  create(
    @Body(new ZodPipe(articleSaveSchema)) body: ArticleSaveInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminArticleDto> {
    return this.content.saveArticle(actor, null, body);
  }

  @Put('articles/:slug')
  @RequirePermissions('content.edit')
  save(
    @Param('slug', new ZodPipe(cmsSlugSchema)) slug: string,
    @Body(new ZodPipe(articleSaveSchema)) body: ArticleSaveInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminArticleDto> {
    return this.content.saveArticle(actor, slug, body);
  }

  @Post('articles/:slug/delete')
  @HttpCode(200)
  @RequirePermissions('content.edit')
  async remove(
    @Param('slug', new ZodPipe(cmsSlugSchema)) slug: string,
    @Body(new ZodPipe(articleDeleteSchema)) body: ArticleDeleteInput,
    @Actor() actor: AuditActor,
  ): Promise<{ ok: true }> {
    await this.content.remove(actor, slug, body.confirm);
    return { ok: true };
  }

  @Get('brand')
  @RequirePermissions('content.edit')
  brand(): Promise<AdminArticleDto> {
    return this.content.get(CMS_PAGE_KIND, BRAND_PAGE_SLUG);
  }

  @Put('brand')
  @RequirePermissions('content.edit')
  saveBrand(
    @Body(new ZodPipe(articleSaveSchema)) body: ArticleSaveInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminArticleDto> {
    return this.content.saveBrand(actor, body);
  }

  @Post('images')
  @RequirePermissions('content.edit')
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  upload(
    @UploadedFile() file: UploadedImage | undefined,
    @Actor() actor: AuditActor,
  ): Promise<AdminUploadedImageDto> {
    return this.content.upload(actor, file);
  }
}
