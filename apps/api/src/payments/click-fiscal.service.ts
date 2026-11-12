import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { t } from '@forest/contracts';
import type { Prisma } from '@forest/db';
import type { Job, Queue } from 'bullmq';
import type { ReceiptLineInput } from '../commerce/fiscal-lines';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IntegrationsService } from '../integrations/integrations.service';
import { buildClickOfdPayload, clickMerchantAuth } from '../integrations/providers/click';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export const PAYMENTS_QUEUE = 'payments';
export const CLICK_FISCALIZE = 'payments.click.fiscalize';

/** Fiscalization progress of one Click payment, kept in `Payment.providerData.ofd`. */
export interface ClickOfdState {
  /** `pending` until submitted; `submitted` waits for the receipt link; the rest are final. */
  state: 'pending' | 'submitted' | 'done' | 'failed';
  attempts: number;
  nextAt: number;
  submittedAt?: number;
  /** Why it can't be (or wasn't) fiscalized — shown to staff, never contains PII. */
  reason?: string;
}

/**
 * Limits: a payment is retried for at most a week (sale receipts are due at payment time; after
 * that staff record the receipt by hand), submissions back off 1 min → 6 h, and the receipt link
 * is polled for up to an hour after a successful submission.
 */
export const CLICK_OFD_POLICY = {
  windowMs: 7 * 24 * 3600_000,
  batch: 20,
  maxSubmitAttempts: 8,
  linkPollMs: 3600_000,
  configRetryMs: 3600_000,
} as const;

const backoffMs = (attempts: number) =>
  Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 6 * 3600_000);

type Row = Prisma.PaymentGetPayload<{
  include: {
    order: { select: { number: true; totalTiyin: true; shippingTiyin: true; items: true } };
  };
}>;

/**
 * Click fiscalization (docs.click.uz → Merchant API → Data Fiscalization; mandatory when a shop
 * sells under more than one IKPU): after Complete, the order's lines go to
 * `POST ofd_data/submit_items` for the payment (`payment_id` = `click_paydoc_id`), then the fiscal
 * receipt link from `GET ofd_data/:service_id/:payment_id` is stored as `fiscalReceiptUrl` —
 * the order's fiscal evidence for closing (CLAUDE.md §6). Runs from a job, never inside the
 * webhook (Click must get its answer fast; no HTTP inside a transaction). Before every submission
 * it first asks for an existing receipt, so a crash between submit and record never files twice.
 */
@Injectable()
export class ClickFiscalService {
  private readonly logger = new Logger(ClickFiscalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** One pass over due payments; returns how many were looked at. */
  async fiscalizeDue(now = Date.now()): Promise<number> {
    if (this.integrations.fakeMode) return 0;
    const creds = await this.integrations.connectedCredentials('click');
    if (!creds || creds.fiscalize === 'off' || !creds.merchantUserId || !creds.secretKey) return 0;
    const rows = await this.prisma.payment.findMany({
      where: {
        method: 'CLICK',
        status: 'PAID',
        fiscalReceiptUrl: null,
        performedAt: { gte: new Date(now - CLICK_OFD_POLICY.windowMs) },
      },
      include: {
        order: { select: { number: true, totalTiyin: true, shippingTiyin: true, items: true } },
      },
      orderBy: { performedAt: 'asc' },
      take: 200,
    });
    const due = rows.filter((r) => {
      const ofd = ofdState(r);
      return (ofd.state === 'pending' || ofd.state === 'submitted') && ofd.nextAt <= now;
    });
    const legal = (await this.settings.get('store.info')).legal;
    for (const row of due.slice(0, CLICK_OFD_POLICY.batch)) {
      try {
        await this.process(row, creds, legal.stir, now);
      } catch (e) {
        this.logger.error(`click fiscalization ${row.order.number}: ${String(e)}`);
      }
    }
    return due.length;
  }

  private async process(
    row: Row,
    creds: Record<string, string>,
    sellerTaxId: string | null,
    now: number,
  ): Promise<void> {
    const ofd = ofdState(row);
    const paydocId = (row.providerData as { clickPaydocId?: string } | null)?.clickPaydocId ?? '';
    const auth = () => clickMerchantAuth(creds.merchantUserId!, creds.secretKey!, now / 1000);

    // Already registered (an earlier run, or a crash after submitting): just take the link.
    const existing = await this.fetchReceiptUrl(creds.serviceId ?? '', paydocId, auth());
    if (existing) return this.finish(row, ofd, existing, now);

    if (ofd.state === 'submitted') {
      if (now - (ofd.submittedAt ?? now) > CLICK_OFD_POLICY.linkPollMs)
        return this.save(
          row,
          { ...ofd, state: 'failed', reason: 'no receipt link from Click' },
          'link',
        );
      return this.save(row, { ...ofd, nextAt: now + 60_000 });
    }

    const built = buildClickOfdPayload({
      serviceId: creds.serviceId ?? '',
      paydocId,
      lines: row.order.items.map(toLine),
      shipping: shippingLine(row.order.shippingTiyin, creds),
      totalTiyin: row.amountTiyin,
      sellerTaxId,
    });
    if ('problem' in built) {
      // Settings may still be filled in (TIN, delivery codes): re-check hourly within the window.
      return this.save(
        row,
        { ...ofd, reason: built.problem, nextAt: now + CLICK_OFD_POLICY.configRetryMs },
        'skip',
      );
    }

    const attempts = ofd.attempts + 1;
    const res = await this.integrations.httpClient('click:fiscal', { maxRetries: 0 }).request({
      method: 'POST',
      url: `${this.env.CLICK_MERCHANT_API_URL}/payment/ofd_data/submit_items`,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Auth: auth() },
      body: JSON.stringify(built.payload),
      timeoutMs: 15_000,
    });
    const answer = parseJson(res.text) as { error_code?: unknown; error_note?: unknown } | null;
    if (res.status < 300 && answer?.error_code === 0) {
      await this.log(row, true, 'submitted');
      return this.save(row, {
        state: 'submitted',
        attempts,
        submittedAt: now,
        nextAt: now + 30_000,
      });
    }
    const reason = `HTTP ${res.status}, error_code ${String(answer?.error_code ?? '?')}: ${String(answer?.error_note ?? '').slice(0, 120)}`;
    const failed = attempts >= CLICK_OFD_POLICY.maxSubmitAttempts;
    await this.save(
      row,
      { state: failed ? 'failed' : 'pending', attempts, reason, nextAt: now + backoffMs(attempts) },
      failed ? 'submit' : undefined,
    );
    if (!failed) await this.log(row, false, reason);
  }

  private async fetchReceiptUrl(
    serviceId: string,
    paydocId: string,
    auth: string,
  ): Promise<string | null> {
    if (!serviceId || !paydocId) return null;
    const res = await this.integrations.httpClient('click:fiscal', { maxRetries: 0 }).request({
      method: 'GET',
      url: `${this.env.CLICK_MERCHANT_API_URL}/payment/ofd_data/${encodeURIComponent(serviceId)}/${encodeURIComponent(paydocId)}`,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Auth: auth },
      timeoutMs: 10_000,
    });
    if (res.status >= 300) return null;
    const body = parseJson(res.text) as { qrCodeURL?: unknown } | null;
    const url = typeof body?.qrCodeURL === 'string' ? body.qrCodeURL.trim() : '';
    return /^https:\/\/\S{1,490}$/.test(url) ? url : null;
  }

  private async finish(row: Row, ofd: ClickOfdState, url: string, now: number): Promise<void> {
    await this.prisma.payment.update({
      where: { id: row.id },
      data: {
        fiscalReceiptUrl: url,
        providerData: {
          ...asObject(row.providerData),
          ofd: { ...ofd, state: 'done', nextAt: now },
        },
      },
    });
    await this.log(row, true, 'receipt link stored');
  }

  /** `final` marks a terminal problem worth an IntegrationLog failure row (feeds the bot alert). */
  private async save(
    row: Row,
    ofd: ClickOfdState,
    final?: 'skip' | 'submit' | 'link',
  ): Promise<void> {
    const before = ofdState(row);
    await this.prisma.payment.update({
      where: { id: row.id },
      data: { providerData: { ...asObject(row.providerData), ofd: { ...ofd } } },
    });
    // A config problem is logged once, not on every hourly re-check.
    if (final === 'skip' && before.reason === ofd.reason) return;
    if (final) await this.log(row, false, ofd.reason ?? final);
  }

  private async log(row: Row, ok: boolean, message: string): Promise<void> {
    await this.integrations
      .log('click', {
        direction: 'OUT',
        kind: 'fiscal.submit_items',
        ok,
        message: `${row.order.number}: ${message}`,
      })
      .catch((e: unknown) => this.logger.warn(`integration log failed: ${String(e)}`));
  }
}

function ofdState(row: { providerData: Prisma.JsonValue }): ClickOfdState {
  const ofd = (asObject(row.providerData).ofd ?? null) as Partial<ClickOfdState> | null;
  return {
    state: ofd?.state ?? 'pending',
    attempts: ofd?.attempts ?? 0,
    nextAt: ofd?.nextAt ?? 0,
    ...(ofd?.submittedAt ? { submittedAt: ofd.submittedAt } : {}),
    ...(ofd?.reason ? { reason: ofd.reason } : {}),
  };
}

function asObject(v: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, Prisma.JsonValue>)
    : {};
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Same fiscal title as the Payme receipt: Uzbek product name + variant (volume/colour). */
function toLine(i: Row['order']['items'][number]): ReceiptLineInput {
  const snap = i.nameSnapshot as { product?: unknown; variant?: unknown };
  return {
    title: [t(snap.product, 'uz'), t(snap.variant, 'uz')].filter(Boolean).join(', '),
    ikpu: i.ikpu,
    packageCode: i.packageCode,
    vatPercent: i.vatPercent,
    qty: i.qty,
    unitPriceTiyin: i.priceTiyin,
    discountTiyin: i.discountTiyin,
  };
}

function shippingLine(priceTiyin: bigint, creds: Record<string, string>) {
  if (priceTiyin <= 0n) return null;
  const vat = Number(creds.shippingVatPercent ?? '12');
  return {
    title: 'Yetkazib berish xizmati',
    ikpu: creds.shippingIkpu ?? '',
    packageCode: creds.shippingPackageCode ?? null,
    vatPercent: Number.isInteger(vat) && vat >= 0 && vat <= 100 ? vat : 12,
    priceTiyin,
  };
}

/** Every minute: fiscalize Click payments that are due (see `ClickFiscalService`). */
@Processor(PAYMENTS_QUEUE)
export class PaymentsProcessor extends WorkerHost {
  constructor(private readonly fiscal: ClickFiscalService) {
    super();
  }

  async process(job: Job): Promise<number> {
    return job.name === CLICK_FISCALIZE ? this.fiscal.fiscalizeDue() : 0;
  }
}

@Injectable()
export class PaymentsScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(PAYMENTS_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      CLICK_FISCALIZE,
      { every: 60_000 },
      { name: CLICK_FISCALIZE },
    );
  }
}
