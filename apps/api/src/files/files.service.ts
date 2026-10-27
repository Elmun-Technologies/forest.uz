import { Global, Inject, Injectable, Module } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ImageDto, Locale } from '@forest/contracts';
import { t } from '@forest/contracts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

interface FileLike {
  key: string;
  isPublic: boolean;
  width: number | null;
  height: number | null;
}

/** Object storage access: public URLs for catalog media, signed URLs for private files. */
@Injectable()
export class FilesService {
  private readonly s3: S3Client;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.s3 = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
  }

  publicUrl(key: string): string {
    return `${this.env.S3_PUBLIC_URL.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  image(file: FileLike | null | undefined, alt: unknown, locale: Locale): ImageDto | null {
    if (!file || !file.isPublic) return null;
    return {
      url: this.publicUrl(file.key),
      alt: t(alt, locale),
      width: file.width,
      height: file.height,
    };
  }

  async signedGetUrl(key: string, expiresInSec = 300): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET_PRIVATE, Key: key }),
      {
        expiresIn: expiresInSec,
      },
    );
  }

  async put(key: string, body: Buffer, contentType: string, isPublic: boolean): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: isPublic ? this.env.S3_BUCKET_PUBLIC : this.env.S3_BUCKET_PRIVATE,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(isPublic ? { CacheControl: 'public, max-age=31536000, immutable' } : {}),
      }),
    );
  }

  async remove(key: string, isPublic: boolean): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: isPublic ? this.env.S3_BUCKET_PUBLIC : this.env.S3_BUCKET_PRIVATE,
        Key: key,
      }),
    );
  }
}

@Global()
@Module({ providers: [FilesService], exports: [FilesService] })
export class FilesModule {}
