import type { FiscalProvider, FiscalReceiptInput } from './types';

/**
 * MVP fiscal fallback (docs/06 Fiscal) until an OFD / online cash register is chosen (docs/13
 * q.3): nothing is issued automatically; the operator issues the receipt on the cash register
 * and records its number or link (`FiscalService.recordManualReceipt`). The order cannot be
 * COMPLETED before that.
 */
export class ManualFiscalProvider implements FiscalProvider {
  readonly key = 'manual' as const;

  async issueReceipt(_input: FiscalReceiptInput): Promise<null> {
    return null;
  }
}
