/** Queue and job names (CLAUDE.md §5). */
export const AUDIENCES_QUEUE = 'audiences';
/** Hourly: every active segment → refresh + destination sync. */
export const REFRESH_ALL = 'audiences.refresh';
/** One segment now (admin save / "Yangilash"). */
export const REFRESH_SEGMENT = 'audiences.segment.refresh';
export const SIGNALS_COLLECT = 'ads.signals.collect';
export const SIGNALS_SEND = 'ads.signals.send';
