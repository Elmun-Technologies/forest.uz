import { readFile } from 'node:fs/promises';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface SeedStorage {
  upload(key: string, filePath: string, contentType: string): Promise<boolean>;
}

/** Uploads seed photos to the public bucket. Returns null when storage isn't configured. */
export async function createSeedStorage(): Promise<SeedStorage | null> {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET_PUBLIC;
  if (!endpoint || !bucket) return null;
  const client = new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    // Public read for the public bucket only (product images). Providers without policy support
    // (dev SeaweedFS uses its anonymous identity instead) are fine to ignore.
    await client
      .send(
        new PutBucketPolicyCommand({
          Bucket: bucket,
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: '*',
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${bucket}/*`],
              },
            ],
          }),
        }),
      )
      .catch(() => undefined);
  }
  const privateBucket = process.env.S3_BUCKET_PRIVATE;
  if (privateBucket) {
    await client
      .send(new HeadBucketCommand({ Bucket: privateBucket }))
      .catch(() => client.send(new CreateBucketCommand({ Bucket: privateBucket })));
  }
  return {
    async upload(key, filePath, contentType) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return false;
      } catch {
        const body = await readFile(filePath);
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
        return true;
      }
    },
  };
}
