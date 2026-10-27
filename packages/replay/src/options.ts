import type { record } from 'rrweb';

type RecordOptions = NonNullable<Parameters<typeof record>[0]>;

/** Elements whose text is masked (phone, name, address, comment, order contact blocks). */
export const PRIVATE_SELECTOR = '[data-private]';
/** Elements not recorded at all (a grey box of the same size in the replay). */
export const BLOCK_SELECTOR = '[data-private="block"]';
/** Constant mask: the replay doesn't even reveal how long a value is. */
export const INPUT_MASK = '•••';

export const maskInput = (text: string): string => (text ? INPUT_MASK : '');
export const maskText = (text: string): string => text.replace(/\S/g, '•');

/**
 * Privacy-first rrweb options (docs/07, docs/14): all inputs masked, `[data-private]` masked or
 * blocked, no canvas, fonts, images inlining, cross-origin iframes, network or console capture;
 * scripts/comments/meta dropped; pointer moves sampled.
 */
export const RECORD_OPTIONS = {
  maskAllInputs: true,
  maskInputFn: maskInput,
  maskTextSelector: PRIVATE_SELECTOR,
  maskTextFn: maskText,
  blockSelector: BLOCK_SELECTOR,
  recordCanvas: false,
  collectFonts: false,
  inlineImages: false,
  recordCrossOriginIframes: false,
  slimDOMOptions: 'all',
  sampling: { mousemove: 100, scroll: 150, media: 800, input: 'last' },
} satisfies Omit<RecordOptions, 'emit'>;
