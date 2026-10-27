import {
  type ArticleData,
  articleDataSchema,
  type ContentBlock,
  contentBodySchema,
} from '@forest/contracts';

/** `Page.data` of CMS rows; invalid JSON reads as empty (never throws on a page view). */
export function pageData(data: unknown): ArticleData {
  const r = articleDataSchema.safeParse(data ?? {});
  return r.success ? r.data : {};
}

export function pageBlocks(body: unknown): ContentBlock[] {
  const r = contentBodySchema.safeParse(body);
  return r.success ? r.data : [];
}

/** File ids referenced by image blocks. */
export function blockFileIds(blocks: readonly ContentBlock[]): string[] {
  return blocks.flatMap((b) => (b.type === 'image' ? [b.fileId] : []));
}
