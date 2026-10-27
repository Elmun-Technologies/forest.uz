import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/**
 * Dev/e2e-only endpoints exist only when explicitly enabled AND providers are fake (no real SMS,
 * payments or couriers can be involved). Otherwise they are indistinguishable from a 404.
 */
export function assertDevEndpoints(env: Env): void {
  if (!env.DEV_ENDPOINTS || env.PROVIDERS_MODE !== 'fake') throw new NotFoundException();
}

const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest();

/**
 * `X-Dev-Token` check (constant time). Production requires DEV_ENDPOINTS_TOKEN (unset = nobody
 * passes); dev/test without a token stay open, as before tokens existed.
 */
export function devTokenOk(env: Env, header: string | string[] | undefined): boolean {
  const expected = env.DEV_ENDPOINTS_TOKEN;
  if (!expected) return env.NODE_ENV !== 'production';
  if (typeof header !== 'string' || !header) return false;
  return timingSafeEqual(digest(header), digest(expected));
}

const DEV_PUBLIC = 'forest:dev-public';
/**
 * The handler also answers without the token, in a reduced form it implements itself (the OTP
 * lookup of `GET /dev/outbox?to=`, so demo testers can log in).
 */
export const DevPublic = () => SetMetadata(DEV_PUBLIC, true);

/** Every dev controller: master switch (DEV_ENDPOINTS + fake mode), then the dev token. */
@Injectable()
export class DevEndpointsGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    assertDevEndpoints(this.env);
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[]> }>();
    if (devTokenOk(this.env, req.headers['x-dev-token'])) return true;
    if (this.reflector.get<boolean>(DEV_PUBLIC, ctx.getHandler())) return true;
    throw new NotFoundException();
  }
}
