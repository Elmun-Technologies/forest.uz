import {
  type ContentBlock,
  type DeliveryZone,
  type SettingValue,
  containsPlaceholder,
  fillTemplate,
  formatUzPhone,
} from '@forest/contracts';

export type ContentVars = Record<string, string | number | null | undefined>;

/**
 * Variables available to CMS text (`{store.phoneFormatted}`, `{returns.returnDays}` …).
 * Missing company data stays null so the blocks using it are hidden, never shown as `[…]`.
 */
export function buildContentVars(
  store: SettingValue<'store.info'>,
  returns: SettingValue<'returns.rules'>,
  zones: readonly DeliveryZone[],
): ContentVars {
  const express = [...zones]
    .filter((z) => z.active && z.carrier === 'YANDEX')
    .sort((a, b) => a.sort - b.sort)[0];
  return {
    'store.name': store.name,
    'store.domain': store.domain,
    'store.email': store.email,
    'store.phone': store.phone,
    'store.phoneFormatted': formatUzPhone(store.phone),
    'store.telegramBot': store.telegramBot,
    'store.offerVersion': store.offerVersion,
    'store.deletionSlaDays': store.deletionSlaDays,
    'store.legal.entityName': store.legal.entityName,
    'store.legal.stir': store.legal.stir,
    'store.legal.address': store.legal.address,
    'store.legal.bank': store.legal.bank,
    'store.legal.mfo': store.legal.mfo,
    'store.legal.account': store.legal.account,
    'returns.returnDays': returns.returnDays,
    'returns.defectReportHours': returns.defectReportHours,
    'returns.refundBusinessDays': returns.refundBusinessDays,
    'delivery.cutoff': express?.rule.cutoff,
    'delivery.afterCutoffBy': express?.rule.afterCutoffBy,
  };
}

/** Filled text, or null when a variable is missing or the text still holds a `[placeholder]`. */
export function fillText(text: string, vars: ContentVars): string | null {
  const out = fillTemplate(text, vars);
  return out === null || containsPlaceholder(out) ? null : out;
}

function fillBlock(block: ContentBlock, vars: ContentVars): ContentBlock | null {
  const f = (s: string) => fillText(s, vars);
  switch (block.type) {
    case 'h2':
    case 'h3':
    case 'p':
    case 'note': {
      const text = f(block.text);
      return text === null ? null : { ...block, text };
    }
    case 'list': {
      const items = block.items.map(f).filter((s): s is string => s !== null);
      return items.length ? { ...block, items } : null;
    }
    case 'dl': {
      const items = block.items.flatMap((i) => {
        const term = f(i.term);
        const desc = f(i.desc);
        return term === null || desc === null ? [] : [{ term, desc }];
      });
      return items.length ? { ...block, items } : null;
    }
    case 'faq': {
      const items = block.items.flatMap((i) => {
        const q = f(i.q);
        const a = f(i.a);
        return q === null || a === null ? [] : [{ q, a }];
      });
      return items.length ? { ...block, items } : null;
    }
    case 'quote': {
      const text = f(block.text);
      return text === null ? null : { ...block, text, cite: f(block.cite) ?? '' };
    }
    case 'image':
      // A caption/alt with a missing variable is dropped; the picture itself stays.
      return { ...block, alt: f(block.alt) ?? '', caption: f(block.caption) ?? '' };
    case 'table': {
      const head = block.head.map(f);
      if (head.some((h) => h === null)) return null;
      const rows = block.rows.flatMap((r) => {
        const cells = r.map(f);
        return cells.some((c) => c === null) ? [] : [cells as string[]];
      });
      return rows.length ? { ...block, head: head as string[], rows } : null;
    }
  }
}

const LEVEL: Partial<Record<ContentBlock['type'], number>> = { h2: 2, h3: 3 };

/**
 * Resolves variables in every block and removes what can't be shown: blocks/items with missing
 * data, then headings left without any content under them.
 */
export function fillBlocks(blocks: readonly ContentBlock[], vars: ContentVars): ContentBlock[] {
  let out = blocks.map((b) => fillBlock(b, vars)).filter((b): b is ContentBlock => b !== null);
  // Repeat: dropping an empty h3 can leave its parent h2 empty too.
  for (;;) {
    const kept = out.filter((b, i) => {
      const level = LEVEL[b.type];
      if (level === undefined) return true;
      const next = out[i + 1];
      const nextLevel = next ? LEVEL[next.type] : undefined;
      return next !== undefined && (nextLevel === undefined || nextLevel > level);
    });
    if (kept.length === out.length) return kept;
    out = kept;
  }
}
