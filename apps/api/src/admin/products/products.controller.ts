import {
  Body,
  Delete,
  Get,
  HttpCode,
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
  type AdminProductDto,
  type AdminProductListQuery,
  adminProductListQuerySchema,
  type AdminProductPageDto,
  type AdminProductsMetaDto,
  type IdOrderInput,
  idOrderSchema,
  type ImageAltInput,
  imageAltSchema,
  type ProductCreateInput,
  productCreateSchema,
  type ProductRelationsInput,
  productRelationsSchema,
  type ProductUpdateInput,
  productUpdateSchema,
  type VariantCreateInput,
  variantCreateSchema,
  type VariantUpdateInput,
  variantUpdateSchema,
} from '@forest/contracts';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import {
  AdminUploadService,
  IMAGE_UPLOAD_OPTIONS,
  type UploadedImage,
  UploadErrorsInterceptor,
} from '../files/upload.service';
import { CatalogSourceService } from './catalog-source.service';
import { AdminProductImagesService } from './images.service';
import { AdminProductsService } from './products.service';
import { AdminVariantsService } from './variants.service';

/** A11 Mahsulotlar: view = every role (`products.view`), changes = O/M/Mk (`products.edit`). */
@AdminController('products')
export class AdminProductsController {
  constructor(
    private readonly products: AdminProductsService,
    private readonly variants: AdminVariantsService,
    private readonly images: AdminProductImagesService,
  ) {}

  @Get('meta')
  @RequirePermissions('products.view')
  meta(): Promise<AdminProductsMetaDto> {
    return this.products.meta();
  }

  @Get('options')
  @RequirePermissions('products.view')
  options() {
    return this.products.options();
  }

  @Get()
  @RequirePermissions('products.view')
  list(
    @Query(new ZodPipe(adminProductListQuerySchema)) q: AdminProductListQuery,
  ): Promise<AdminProductPageDto> {
    return this.products.list(q);
  }

  @Get(':id')
  @RequirePermissions('products.view')
  get(@Param('id') id: string): Promise<AdminProductDto> {
    return this.products.get(id);
  }

  @Post()
  @RequirePermissions('products.edit')
  create(
    @Body(new ZodPipe(productCreateSchema)) body: ProductCreateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminProductDto> {
    return this.products.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('products.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(productUpdateSchema)) body: ProductUpdateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminProductDto> {
    return this.products.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('products.edit')
  remove(@Param('id') id: string, @Actor() actor: AuditActor): Promise<void> {
    return this.products.remove(actor, id);
  }

  @Put(':id/relations')
  @RequirePermissions('products.edit')
  relations(
    @Param('id') id: string,
    @Body(new ZodPipe(productRelationsSchema)) body: ProductRelationsInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminProductDto> {
    return this.products.setRelations(actor, id, body);
  }

  // ───────── variants ─────────

  @Post(':id/variants')
  @RequirePermissions('products.edit')
  createVariant(
    @Param('id') id: string,
    @Body(new ZodPipe(variantCreateSchema)) body: VariantCreateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminProductDto> {
    return this.variants.create(actor, id, body);
  }

  @Put(':id/variants/order')
  @RequirePermissions('products.edit')
  reorderVariants(
    @Param('id') id: string,
    @Body(new ZodPipe(idOrderSchema)) body: IdOrderInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminProductDto> {
    return this.variants.reorder(actor, id, body);
  }

  @Patch('variants/:variantId')
  @RequirePermissions('products.edit')
  updateVariant(
    @Param('variantId') variantId: string,
    @Body(new ZodPipe(variantUpdateSchema)) body: VariantUpdateInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminProductDto> {
    return this.variants.update(actor, variantId, body);
  }

  @Delete('variants/:variantId')
  @RequirePermissions('products.edit')
  removeVariant(
    @Param('variantId') variantId: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminProductDto> {
    return this.variants.remove(actor, variantId);
  }

  // ───────── images ─────────

  @Post(':id/images')
  @RequirePermissions('products.edit')
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Actor() actor: AuditActor,
  ): Promise<AdminProductDto> {
    return this.images.upload(actor, id, file);
  }

  @Put(':id/images/order')
  @RequirePermissions('products.edit')
  reorderImages(
    @Param('id') id: string,
    @Body(new ZodPipe(idOrderSchema)) body: IdOrderInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminProductDto> {
    return this.images.reorder(actor, id, body);
  }

  @Patch('images/:imageId')
  @RequirePermissions('products.edit')
  updateImage(
    @Param('imageId') imageId: string,
    @Body(new ZodPipe(imageAltSchema)) body: ImageAltInput,
    @Actor() actor: AuditActor,
  ): Promise<AdminProductDto> {
    return this.images.updateAlt(actor, imageId, body);
  }

  @Delete('images/:imageId')
  @RequirePermissions('products.edit')
  removeImage(
    @Param('imageId') imageId: string,
    @Actor() actor: AuditActor,
  ): Promise<AdminProductDto> {
    return this.images.remove(actor, imageId);
  }
}

/** Admin catalog building blocks shared with reviews/promo (uploads, catalog source switch). */
@Module({
  providers: [AdminUploadService, CatalogSourceService, UploadErrorsInterceptor],
  exports: [AdminUploadService, CatalogSourceService, UploadErrorsInterceptor],
})
export class AdminCatalogCoreModule {}

@Module({
  imports: [AdminCatalogCoreModule],
  controllers: [AdminProductsController],
  providers: [AdminProductsService, AdminVariantsService, AdminProductImagesService],
})
export class AdminProductsModule {}
