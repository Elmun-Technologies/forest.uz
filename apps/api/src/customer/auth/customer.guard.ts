import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import { DomainError } from '@forest/contracts';
import type { Request } from 'express';
import { SessionService } from '../../common/session';

const CUSTOMER = Symbol('customerId');

type CustomerRequest = Request & { [CUSTOMER]?: string | null };

async function resolve(sessions: SessionService, req: CustomerRequest): Promise<string | null> {
  if (req[CUSTOMER] === undefined) req[CUSTOMER] = (await sessions.read(req))?.customerId ?? null;
  return req[CUSTOMER];
}

/** Requires a customer session (`fr_session`); 401 UNAUTHORIZED otherwise. */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const id = await resolve(this.sessions, ctx.switchToHttp().getRequest<CustomerRequest>());
    if (!id) throw new DomainError('UNAUTHORIZED');
    return true;
  }
}

/** Never rejects; resolves the session so `@OptionalCustomerId()` can read it. */
@Injectable()
export class OptionalCustomerGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    await resolve(this.sessions, ctx.switchToHttp().getRequest<CustomerRequest>());
    return true;
  }
}

function resolved(ctx: ExecutionContext): string | null {
  const v = ctx.switchToHttp().getRequest<CustomerRequest>()[CUSTOMER];
  // Fail loudly: a missing guard would otherwise silently treat everyone as anonymous.
  if (v === undefined)
    throw new Error('@CustomerId/@OptionalCustomerId need CustomerGuard/OptionalCustomerGuard');
  return v;
}

/** Customer id of the session. Use with `@UseGuards(CustomerGuard)`. */
export const CustomerId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = resolved(ctx);
  if (!id) throw new DomainError('UNAUTHORIZED');
  return id;
});

/** Customer id or null for anonymous visitors. Use with `@UseGuards(OptionalCustomerGuard)`. */
export const OptionalCustomerId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | null => resolved(ctx),
);
