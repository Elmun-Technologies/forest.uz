import { Injectable } from '@nestjs/common';
import {
  type AdminProductDto,
  DomainError,
  type IdOrderInput,
  type ImageAltInput,
} from '@forest/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AdminUploadService, type UploadedImage } from '../files/upload.service';
import { AdminProductsService, lockProduct } from './products.service';
import { assertPermutation } from './variants.service';

/** A11 "Rasmlar": upload to the public bucket, alt UZ/RU, drag order, delete. */
@Injectable()
export class AdminProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly uploads: AdminUploadService,
    private readonly products: AdminProductsService,
  ) {}

  async upload(
    actor: AuditActor,
    productId: string,
    file: UploadedImage | undefined,
  ): Promise<AdminProductDto> {
    const exists = await this.prisma.product.count({ where: { id: productId } });
    if (!exists) throw new DomainError('PRODUCT_NOT_FOUND');
    const stored = await this.uploads.storeImage(file, `products/${productId}`);
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockProduct(tx, productId);
        const last = await tx.productImage.aggregate({
          where: { productId },
          _max: { sort: true },
        });
        const row = await tx.file.create({ data: stored });
        const image = await tx.productImage.create({
          data: {
            productId,
            fileId: row.id,
            alt: { uz: '', ru: '' },
            sort: (last._max.sort ?? -1) + 1,
          },
        });
        await this.audit.record(
          actor,
          {
            action: 'product.image_add',
            entity: 'Product',
            entityId: productId,
            after: {
              imageId: image.id,
              key: stored.key,
              width: stored.width,
              height: stored.height,
            },
          },
          tx,
        );
      });
    } catch (e) {
      await this.uploads.discardObject(stored.key);
      throw e;
    }
    return this.products.get(productId);
  }

  async updateAlt(
    actor: AuditActor,
    imageId: string,
    input: ImageAltInput,
  ): Promise<AdminProductDto> {
    const image = await this.find(imageId);
    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.update({ where: { id: imageId }, data: { alt: input.alt } });
      await this.audit.record(
        actor,
        {
          action: 'product.image_update',
          entity: 'Product',
          entityId: image.productId,
          before: { imageId, alt: image.alt },
          after: { imageId, alt: input.alt },
        },
        tx,
      );
    });
    return this.products.get(image.productId);
  }

  async reorder(
    actor: AuditActor,
    productId: string,
    input: IdOrderInput,
  ): Promise<AdminProductDto> {
    await this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, productId);
      const images = await tx.productImage.findMany({
        where: { productId },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      assertPermutation(
        images.map((i) => i.id),
        input.ids,
      );
      for (const [sort, id] of input.ids.entries())
        await tx.productImage.update({ where: { id }, data: { sort } });
      await this.audit.record(
        actor,
        {
          action: 'product.image_reorder',
          entity: 'Product',
          entityId: productId,
          before: { ids: images.map((i) => i.id) },
          after: { ids: input.ids },
        },
        tx,
      );
    });
    return this.products.get(productId);
  }

  async remove(actor: AuditActor, imageId: string): Promise<AdminProductDto> {
    const image = await this.find(imageId);
    await this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, image.productId);
      await tx.productImage.delete({ where: { id: imageId } });
      await this.audit.record(
        actor,
        {
          action: 'product.image_delete',
          entity: 'Product',
          entityId: image.productId,
          before: { imageId, fileId: image.fileId, alt: image.alt },
        },
        tx,
      );
    });
    await this.uploads.discardUnreferenced([image.fileId]);
    return this.products.get(image.productId);
  }

  private async find(imageId: string) {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image) throw new DomainError('NOT_FOUND');
    return image;
  }
}
