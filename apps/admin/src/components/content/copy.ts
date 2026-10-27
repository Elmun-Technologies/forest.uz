import type { ArticleCategory } from '@forest/contracts/core';
import type { ContentBlock } from '@forest/contracts';

/** CMS editor copy and block helpers (Uzbek admin). */

export type Block = ContentBlock;

export const CATEGORY_LABEL: Record<ArticleCategory, string> = {
  furniture: 'Mebel',
  fabric: 'Divan va mato',
  video: 'Video darslar',
  colors: 'Rang tanlash',
};

export const BLOCK_TYPES = ['h2', 'h3', 'p', 'list', 'image', 'quote', 'note', 'faq'] as const;
type EditableType = (typeof BLOCK_TYPES)[number];

export const BLOCK_LABEL: Record<Block['type'], string> = {
  h2: 'Sarlavha',
  h3: 'Kichik sarlavha',
  p: 'Matn',
  list: "Ro'yxat",
  image: 'Rasm',
  quote: 'Iqtibos',
  note: 'Eslatma',
  faq: 'Savol-javob',
  dl: "Ta'riflar",
  table: 'Jadval',
};

export function emptyBlock(type: EditableType): Block {
  switch (type) {
    case 'h2':
    case 'h3':
    case 'p':
      return { type, text: '' };
    case 'note':
      return { type, tone: 'info', text: '' };
    case 'list':
      return { type, ordered: false, items: [] };
    case 'image':
      return { type, fileId: '', alt: '', caption: '' };
    case 'quote':
      return { type, text: '', cite: '' };
    case 'faq':
      return { type, items: [] };
  }
}

/** Blocks worth saving: empty text blocks and images without a file are dropped. */
export function cleanBlocks(blocks: Block[]): Block[] {
  return blocks.filter((b) => {
    switch (b.type) {
      case 'image':
        return !!b.fileId;
      case 'h2':
      case 'h3':
      case 'p':
      case 'note':
      case 'quote':
        return !!b.text.trim();
      case 'list':
      case 'faq':
      case 'dl':
        return b.items.length > 0;
      case 'table':
        return b.rows.length > 0;
    }
  });
}
