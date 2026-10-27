/** BullMQ queue `seo` (CLAUDE.md §5). */
export const SEO_QUEUE = 'seo';
export const SITEMAP_REGENERATE = 'seo.sitemap.regenerate';
export const INDEXNOW_FLUSH = 'seo.indexnow.flush';
export const QUERIES_SYNC = 'seo.queries.sync';
export const NOT_FOUND_PRUNE = 'seo.notfound.prune';

/** Debounce window for publish/update bursts (sitemap rebuild, IndexNow ping). */
export const SEO_DEBOUNCE_MS = 60_000;
