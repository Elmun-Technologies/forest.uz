import { Global, Inject, Injectable, Module } from '@nestjs/common';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
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
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
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

  /** Private object with its user metadata; null when it doesn't exist. */
  async getPrivate(
    key: string,
  ): Promise<{ body: Buffer; metadata: Record<string, string> } | null> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.env.S3_BUCKET_PRIVATE, Key: key }),
      );
      const bytes = await res.Body?.transformToByteArray();
      return { body: Buffer.from(bytes ?? []), metadata: res.Metadata ?? {} };
    } catch (e) {
      if (e instanceof NoSuchKey) return null;
      throw e;
    }
  }

  async putPrivate(
    key: string,
    body: Buffer,
    contentType: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET_PRIVATE,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: metadata,
      }),
    );
  }

  /**
   * Private bucket listing under `prefix`: object keys, or with `delimiter` the next-level
   * "folders" (common prefixes). Follows continuation tokens.
   */
  async listPrivate(
    prefix: string,
    delimiter?: string,
  ): Promise<{ keys: string[]; prefixes: string[] }> {
    const keys: string[] = [];
    const prefixes: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.env.S3_BUCKET_PRIVATE,
          Prefix: prefix,
          Delimiter: delimiter,
          ContinuationToken: token,
        }),
      );
      for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
      for (const p of res.CommonPrefixes ?? []) if (p.Prefix) prefixes.push(p.Prefix);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return { keys, prefixes };
  }

  /** Deletes private objects in batches of 1000 (S3 DeleteObjects limit). */
  async removeManyPrivate(keys: readonly string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.env.S3_BUCKET_PRIVATE,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
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
