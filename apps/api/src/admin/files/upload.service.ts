import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { ADMIN_UPLOAD_MAX_BYTES, DomainError } from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { catchError, type Observable, throwError } from 'rxjs';
import { randomBytes } from 'node:crypto';
import { FilesService } from '../../files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeImage } from './image-meta';

/** The part of a multer file the admin uses (memory storage). */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

/** Multer options for admin image routes: memory storage, one file, size-capped. */
export const IMAGE_UPLOAD_OPTIONS = {
  limits: { fileSize: ADMIN_UPLOAD_MAX_BYTES, files: 1, fields: 10 },
};

/**
 * Multer's own errors (413 too large, 400 unexpected field) become the admin's stable codes.
 * Put it before `FileInterceptor` in `@UseInterceptors` so it wraps it.
 */
@Injectable()
export class UploadErrorsInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((e: unknown) =>
          throwError(() =>
            e instanceof HttpException && e.getStatus() === 413
              ? new DomainError('FILE_TOO_LARGE', undefined, 'file')
              : e instanceof HttpException && e.getStatus() === 400
                ? new DomainError('FILE_TYPE_UNSUPPORTED', undefined, 'file')
                : e,
          ),
        ),
      );
  }
}

type Db = Pick<Prisma.TransactionClient, 'file'>;

/**
 * Admin uploads to the public bucket (catalog and gallery media). The object is written first and
 * the `File` row inside the caller's transaction; a failed transaction leaves an unreferenced
 * object, which `discard` removes.
 */
@Injectable()
export class AdminUploadService {
  private readonly logger = new Logger('AdminUpload');

  constructor(
    private readonly files: FilesService,
    private readonly prisma: PrismaService,
  ) {}

  /** Validates and stores an image under `<prefix>/<cuid>.<ext>`; returns the File row data. */
  async storeImage(file: UploadedImage | undefined, prefix: string) {
    if (!file || file.size === 0) throw new DomainError('FILE_TYPE_UNSUPPORTED', undefined, 'file');
    if (file.size > ADMIN_UPLOAD_MAX_BYTES)
      throw new DomainError('FILE_TOO_LARGE', undefined, 'file');
    // Metadata (Exif/GPS…) is stripped before anything is stored; unparsable files are refused.
    const image = sanitizeImage(file.buffer);
    if (!image) throw new DomainError('FILE_TYPE_UNSUPPORTED', undefined, 'file');
    const { bytes, meta } = image;
    // Random, unguessable object names: drafts' images are public URLs before the product is.
    const key = `${prefix}/${randomBytes(12).toString('base64url')}.${meta.ext}`;
    try {
      await this.files.put(key, bytes, meta.mime, true);
    } catch (e) {
      this.logger.error(`upload of ${key} failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new DomainError('FILE_STORAGE_FAILED');
    }
    return {
      key,
      isPublic: true,
      mime: meta.mime,
      size: bytes.length,
      width: meta.width,
      height: meta.height,
    };
  }

  url(key: string): string {
    return this.files.publicUrl(key);
  }

  /** Browser URL for any stored file: public URL, or a short-lived signed URL for private files. */
  async viewUrl(file: { key: string; isPublic: boolean }): Promise<string> {
    return file.isPublic ? this.files.publicUrl(file.key) : this.files.signedGetUrl(file.key, 600);
  }

  /**
   * Deletes File rows nothing references any more (product images, category images, selector
   * items, reviews) and their objects, after the caller's transaction committed. Best effort:
   * a storage error only leaves an orphan object.
   */
  async discardUnreferenced(fileIds: string[], db: Db = this.prisma): Promise<void> {
    if (fileIds.length === 0) return;
    const rows = await db.file.findMany({
      where: {
        id: { in: fileIds },
        productImages: { none: {} },
        categories: { none: {} },
        selectorItems: { none: {} },
      },
      select: { id: true, key: true, isPublic: true },
    });
    for (const f of rows) {
      const inReview = await this.prisma.review.count({
        where: { OR: [{ photoFileIds: { has: f.id } }, { beforeFileId: f.id }] },
      });
      if (inReview > 0) continue;
      await db.file.delete({ where: { id: f.id } }).catch(() => undefined);
      await this.files
        .remove(f.key, f.isPublic)
        .catch((e: unknown) =>
          this.logger.warn(
            `could not delete object ${f.key}: ${e instanceof Error ? e.message : e}`,
          ),
        );
    }
  }

  /** Removes an object stored by `storeImage` whose row was never committed. */
  async discardObject(key: string): Promise<void> {
    await this.files
      .remove(key, true)
      .catch((e: unknown) =>
        this.logger.warn(`could not delete object ${key}: ${e instanceof Error ? e.message : e}`),
      );
  }
}
