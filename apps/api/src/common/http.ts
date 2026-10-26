import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
  type PipeTransform,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import {
  type ApiErrorBody,
  DomainError,
  type ErrorCode,
  type Locale,
  errorMessage,
  isLocale,
  localeFromAcceptLanguage,
} from '@forest/contracts';
import type { Request, Response } from 'express';
import { z, type ZodType } from 'zod';

export function requestLocale(req: Request): Locale {
  const q = req.query?.locale;
  if (typeof q === 'string' && isLocale(q)) return q;
  return localeFromAcceptLanguage(req.headers['accept-language']);
}

/** `@ReqLocale()` — uz | ru from `?locale=` or Accept-Language. */
export const ReqLocale = createParamDecorator((_: unknown, ctx: ExecutionContext): Locale =>
  requestLocale(ctx.switchToHttp().getRequest<Request>()),
);

/** Validates and transforms input with a shared zod schema; failures become VALIDATION_FAILED. */
@Injectable()
export class ZodPipe<T extends ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value);
    if (r.success) return r.data;
    const first = r.error.issues[0];
    const field = first?.path.join('.') || undefined;
    // Custom issues carry a stable ErrorCode as message (e.g. PHONE_INCOMPLETE from uzPhoneSchema).
    const code = (first?.code === 'custom' && first.message) || 'VALIDATION_FAILED';
    throw new DomainError(
      code as ErrorCode,
      { issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      field,
    );
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const locale = requestLocale(req);
    let status = 500;
    let body: ApiErrorBody;

    if (exception instanceof DomainError) {
      status = exception.httpStatus;
      body = {
        error: {
          code: exception.code,
          message: errorMessage(exception.code, locale, stringVars(exception.details)),
          ...(exception.field ? { field: exception.field } : {}),
          ...(exception.details && status < 500 ? { details: exception.details } : {}),
        },
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const code: ErrorCode =
        status === 404
          ? 'NOT_FOUND'
          : status === 401
            ? 'UNAUTHORIZED'
            : status === 403
              ? 'FORBIDDEN'
              : status === 429
                ? 'RATE_LIMITED'
                : exception instanceof BadRequestException
                  ? 'VALIDATION_FAILED'
                  : 'INTERNAL';
      body = { error: { code, message: errorMessage(code, locale) } };
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      body = { error: { code: 'INTERNAL', message: errorMessage('INTERNAL', locale) } };
    }
    res.status(status).json(body);
  }
}

function stringVars(details: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(details ?? {}))
    if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
  return out;
}

/** JSON replacer: BigInt must never leak to clients unconverted (DTOs convert money explicitly). */
export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
