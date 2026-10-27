import { z } from 'zod';
import { REVIEW_STATUSES } from '../admin-catalog-types';

/** Admin A15 inputs (`/v1/admin/reviews/*`). */

const flag = z
  .enum(['1', '0', 'true', 'false'])
  .transform((v) => v === '1' || v === 'true')
  .optional();

export const adminReviewListQuerySchema = z.object({
  status: z.enum(REVIEW_STATUSES).default('PENDING'),
  /** Only ≤ 3★. */
  low: flag,
  /** Only reviews with photos. */
  photos: flag,
  source: z.enum(['web', 'bot']).optional(),
  productId: z.string().max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminReviewListQuery = z.infer<typeof adminReviewListQuerySchema>;

export const reviewModerateSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
});
export type ReviewModerateInput = z.infer<typeof reviewModerateSchema>;

/** Public reply under the review; blank removes it. */
export const reviewReplySchema = z.object({
  reply: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => v || null)
    .nullable(),
});
export type ReviewReplyInput = z.infer<typeof reviewReplySchema>;

export const reviewGallerySchema = z
  .object({
    inGallery: z.boolean(),
    /** One of the review's photos to show as "after" (moved to the first position). */
    afterFileId: z.string().min(1).max(64),
    /** "Before" photo: one of the review's photos or a staff upload; null clears the pair. */
    beforeFileId: z.string().min(1).max(64).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { path: ['inGallery'] });
export type ReviewGalleryInput = z.infer<typeof reviewGallerySchema>;
