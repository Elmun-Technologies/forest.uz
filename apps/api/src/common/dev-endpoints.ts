import { NotFoundException } from '@nestjs/common';
import type { Env } from '../config/env';

/**
 * Dev/e2e-only endpoints exist only when explicitly enabled AND providers are fake (no real SMS,
 * payments or couriers can be involved). Otherwise they are indistinguishable from a 404.
 */
export function assertDevEndpoints(env: Env): void {
  if (!env.DEV_ENDPOINTS || env.PROVIDERS_MODE !== 'fake') throw new NotFoundException();
}
