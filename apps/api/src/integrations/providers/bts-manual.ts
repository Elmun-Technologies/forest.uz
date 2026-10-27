import type { DeliveryAddress, DeliveryProvider, ShipmentInput, ShipmentState } from './types';

/**
 * BTS Express in manual mode (docs/06: partner API docs not available yet — docs/13 q.11). No
 * network calls: the operator books the parcel in the BTS cabinet / branch and records the
 * waybill number and statuses with `ManualShipmentService.setManualShipment`; prices come from
 * the zone settings. Replace with a real adapter once BTS shares its API.
 */
export class BtsManualDeliveryProvider implements DeliveryProvider {
  readonly key = 'bts' as const;
  readonly manual = true;

  async quote(_address: DeliveryAddress, _weightGrams: number) {
    // Null = zone price from settings (no live quote without an API).
    return null;
  }

  async createShipment(input: ShipmentInput) {
    // Placeholder reference until the operator enters the BTS waybill number.
    return { externalId: `manual:${input.orderNumber}`, trackNumber: null };
  }

  async getState(_externalId: string): Promise<ShipmentState> {
    throw new Error('BTS manual mode: statuses are entered by the operator, nothing to poll');
  }

  async cancel(_externalId: string): Promise<void> {
    // Cancelled at the BTS branch/cabinet by the operator; nothing to call.
  }
}
