import { describe, expect, it } from 'vitest';
import {
  type LeadPromptVisitor,
  leadPromptAllowed,
  leadPromptDecision,
  leadPromptMode,
  leadTrigger,
} from './lead-prompt';

const fresh: LeadPromptVisitor = {
  identified: false,
  leadCaptured: false,
  shownThisSession: false,
  consentAnswered: true,
};

describe('lead prompt rules', () => {
  it('phones get the bar, lg+ the dialog', () => {
    expect(leadPromptMode(false)).toBe('bar');
    expect(leadPromptMode(true)).toBe('dialog');
  });

  it('exit intent only with a fine pointer at lg+; otherwise only the timer (no scroll-up)', () => {
    expect(leadTrigger(true, true)).toBe('exit-intent');
    expect(leadTrigger(true, false)).toBe('timer');
    expect(leadTrigger(false, true)).toBe('timer');
    expect(leadTrigger(false, false)).toBe('timer');
  });

  it('the bar never shows on product pages, cart, checkout or account flows', () => {
    for (const path of [
      '/p/chalk-white',
      '/savat',
      '/checkout',
      '/kirish',
      '/kabinet/buyurtmalar',
      '/t/abc',
      '/buyurtma/F-10001',
    ]) {
      expect(leadPromptAllowed(path, 'bar')).toBe(false);
    }
    for (const path of ['/', '/katalog', '/katalog/mebel-uchun', '/qidiruv', '/brend', '/ilhom']) {
      expect(leadPromptAllowed(path, 'bar')).toBe(true);
    }
  });

  it('desktop keeps the popup on product pages but not in flows', () => {
    expect(leadPromptAllowed('/p/chalk-white', 'dialog')).toBe(true);
    expect(leadPromptAllowed('/savat', 'dialog')).toBe(false);
    expect(leadPromptAllowed('/checkout', 'dialog')).toBe(false);
  });

  it('suppression and consent rules', () => {
    expect(leadPromptDecision('/', 'bar', fresh)).toBe('show');
    expect(leadPromptDecision('/', 'bar', { ...fresh, identified: true })).toBe('never');
    expect(leadPromptDecision('/', 'bar', { ...fresh, leadCaptured: true })).toBe('never');
    expect(leadPromptDecision('/', 'dialog', { ...fresh, shownThisSession: true })).toBe('never');
    // Cookie banner still open: try again on the next trigger.
    expect(leadPromptDecision('/', 'bar', { ...fresh, consentAnswered: false })).toBe('wait');
    // On a product page the phone bar waits for a page where it may show.
    expect(leadPromptDecision('/p/x', 'bar', fresh)).toBe('wait');
    expect(leadPromptDecision('/p/x', 'dialog', fresh)).toBe('show');
  });
});
