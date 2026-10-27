import type { Logger } from '@nestjs/common';
import type { FilesService } from '../files/files.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Bot review photos stay in the private bucket until the review is APPROVED with publish consent
 * (docs/09 "never public until review approved with consent"); then each object is copied to the
 * public bucket under the same key and its `File` row flips to public, so the gallery and review
 * blocks (public URLs only) can show it. Best effort, after commit: a failure leaves it private.
 */
export async function publishReviewPhotos(
  prisma: PrismaService,
  files: FilesService,
  reviewId: string,
  logger: Pick<Logger, 'warn'>,
): Promise<number> {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { status: true, photoConsent: true, photoFileIds: true },
  });
  if (!review || review.status !== 'APPROVED' || !review.photoConsent) return 0;
  const rows = await prisma.file.findMany({
    where: { id: { in: review.photoFileIds }, isPublic: false },
  });
  let published = 0;
  for (const f of rows) {
    try {
      const obj = await files.getPrivate(f.key);
      if (!obj) continue;
      await files.put(f.key, obj.body, f.mime, true);
      await prisma.file.update({ where: { id: f.id }, data: { isPublic: true } });
      await files.remove(f.key, false).catch(() => undefined);
      published++;
    } catch (e) {
      logger.warn(
        `publishing review photo ${f.id} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return published;
}
