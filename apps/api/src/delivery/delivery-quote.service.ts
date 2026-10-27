import { Injectable, Logger, Module } from '@nestjs/common';
import type { DeliveryZone } from '@forest/contracts';
import { IntegrationsService } from '../integrations/integrations.service';
import type { DeliveryAddress } from '../integrations/providers/types';
import { RedisService } from '../redis/redis.module';

/** A line without a known weight counts as 1 kg (paint tins: 0.5–2.5 L). */
export const DEFAULT_ITEM_WEIGHT_GRAMS = 1000;
const CACHE_SECONDS = 600;

export function cartWeightGrams(lines: { qty: number; weightGrams: number | null }[]): number {
  return lines.reduce((sum, l) => sum + l.qty * (l.weightGrams ?? DEFAULT_ITEM_WEIGHT_GRAMS), 0);
}

/**
 * Live carrier price for zones that have it switched on (`liveQuote`, YANDEX only). Any miss —
 * no coordinates, provider error, non-UZS answer — keeps the zone price from settings, so
 * checkout never fails because of the carrier. Results are cached per zone + ~11 m pin + 0.5 kg
 * step, so the price shown in the cart is the price charged at checkout.
 */
@Injectable()
export class DeliveryQuoteService {
  private readonly logger = new Logger('DeliveryQuote');

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly redis: RedisService,
  ) {}

  async priceZone(
    zone: DeliveryZone,
    dest: DeliveryAddress,
    weightGrams: number,
  ): Promise<DeliveryZone> {
    if (zone.carrier !== 'YANDEX' || !zone.liveQuote || dest.lat == null || dest.lng == null)
      return zone;
    const key = `dq:yandex:${zone.key}:${dest.lat.toFixed(4)}:${dest.lng.toFixed(4)}:${Math.ceil(weightGrams / 500)}`;
    try {
      const cached = await this.redis.get(key);
      if (cached !== null && /^\d+$/.test(cached)) return { ...zone, priceSoum: Number(cached) };
      const provider = await this.integrations.delivery('yandex_delivery');
      const quote = await provider.quote(dest, weightGrams);
      if (!quote) return zone;
      // Customers pay whole so'm; a fractional carrier price rounds up.
      const priceSoum = Number((quote.priceTiyin + 99n) / 100n);
      await this.redis.set(key, String(priceSoum), 'EX', CACHE_SECONDS);
      return { ...zone, priceSoum };
    } catch (e) {
      this.logger.warn(`live quote for ${zone.key} failed, using zone price: ${String(e)}`);
      return zone;
    }
  }
}

@Module({ providers: [DeliveryQuoteService], exports: [DeliveryQuoteService] })
export class DeliveryQuoteModule {}
