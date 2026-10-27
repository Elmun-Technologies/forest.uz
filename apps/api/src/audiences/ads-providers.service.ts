import { Injectable } from '@nestjs/common';
import {
  AD_DESTINATION_INTEGRATION,
  AD_SIGNAL_INTEGRATION,
  type AdDestination,
  type AdSignalPlatform,
} from '@forest/contracts';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  FakeAdsState,
  FakeAudienceProvider,
  FakeConversionProvider,
} from '../integrations/providers/ads/fake';
import { adAdapter, type AdIntegrationKey } from '../integrations/providers/ads/health';
import type { AudienceListProvider, ConversionProvider } from '../integrations/providers/ads/types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ad adapters for audiences and signals. A platform is used only while its integration is
 * CONNECTED (CLAUDE.md §6): in `PROVIDERS_MODE=fake` the connected platform gets the in-memory
 * fake, otherwise the real adapter with the decrypted credentials.
 */
@Injectable()
export class AdsProvidersService {
  readonly fakes = new FakeAdsState();

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly prisma: PrismaService,
  ) {}

  get fakeMode(): boolean {
    return this.integrations.fakeMode;
  }

  /** Integration keys currently CONNECTED among `keys`. */
  async connectedKeys(keys: readonly string[]): Promise<Set<string>> {
    const rows = await this.prisma.integration.findMany({
      where: { key: { in: [...keys] }, status: 'CONNECTED' },
      select: { key: true },
    });
    return new Set(rows.map((r) => r.key));
  }

  private async credentials(key: AdIntegrationKey): Promise<Record<string, string> | null> {
    return this.integrations.connectedCredentials(key);
  }

  async audience(destination: AdDestination): Promise<AudienceListProvider | null> {
    const key = AD_DESTINATION_INTEGRATION[destination] as AdIntegrationKey;
    const creds = await this.credentials(key);
    if (!creds) return null;
    if (this.fakeMode) return new FakeAudienceProvider(destination, this.fakes);
    return adAdapter(key, creds, this.integrations.httpClient(`${key}:audience`));
  }

  async conversions(platform: AdSignalPlatform): Promise<ConversionProvider | null> {
    const key = AD_SIGNAL_INTEGRATION[platform] as AdIntegrationKey;
    const creds = await this.credentials(key);
    if (!creds) return null;
    if (this.fakeMode) return new FakeConversionProvider(platform, this.fakes);
    const adapter = adAdapter(key, creds, this.integrations.httpClient(`${key}:signals`));
    return 'send' in adapter ? adapter : null;
  }
}
