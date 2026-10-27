import type { AdminPromoDto } from '@forest/contracts/core';
import { soum } from '../products/format';

/** Table "Chegirma" cell: −10% · 50 000 · Bepul yetkazish · Sovg'a: <mahsulot>. */
export function discountLabel(p: Pick<AdminPromoDto, 'type' | 'value' | 'gift'>): string {
  switch (p.type) {
    case 'PERCENT':
      return `−${p.value}%`;
    case 'FIXED':
      return `−${soum(p.value)}`;
    case 'FREE_SHIPPING':
      return 'Bepul yetkazish';
    case 'GIFT':
      return p.gift ? `Sovg'a: ${p.gift.productName}` : "Sovg'a";
  }
}
