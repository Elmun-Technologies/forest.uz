import type { Logger } from '@nestjs/common';
import type { FilesService } from '../files/files.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Bot review photos stay in the private bucket until the review is APPROVED with publish consent
 * (docs/09 "never public until review approved with consent"); then each object is copied to the
 * public bucket under the same key and its `File` row flips to public, so the gallery and review
 * blocks (public URLs only) can show it. Best effort, after commit: a failure leaves it private.
 * `unpublishReviewPhotos` reverses it (rejection, consent withdrawn).
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
      // The private original stays: withdrawn consent / rejection makes it private again.
      published++;
    } catch (e) {
      logger.warn(
        `publishing review photo ${f.id} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return published;
}

/**
 * A bot review that is no longer publishable (REJECTED, or consent withdrawn): its customer photos
 * go back to private — the public copies are deleted and the `File` rows flip (the private
 * originals were kept on publish). Staff "before" uploads are not customer photos and stay.
 */
export async function unpublishReviewPhotos(
  prisma: PrismaService,
  files: FilesService,
  reviewId: string,
  logger: Pick<Logger, 'warn'>,
): Promise<number> {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { status: true, photoConsent: true, photoFileIds: true, source: true },
  });
  if (!review || review.source !== 'bot') return 0;
  if (review.status === 'APPROVED' && review.photoConsent) return 0;
  const rows = await prisma.file.findMany({
    where: { id: { in: review.photoFileIds }, isPublic: true },
  });
  let done = 0;
  for (const f of rows) {
    try {
      if (!(await files.getPrivate(f.key))) {
        logger.warn(`review photo ${f.id} has no private original; left public`);
        continue;
      }
      await prisma.file.update({ where: { id: f.id }, data: { isPublic: false } });
      await files.remove(f.key, true);
      done++;
    } catch (e) {
      logger.warn(
        `unpublishing review photo ${f.id} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return done;
}
