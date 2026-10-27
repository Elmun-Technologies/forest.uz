import { Injectable } from '@nestjs/common';
import { type Locale, fillTemplate, t } from '@forest/contracts';
import { IntegrationsService } from '../../integrations/integrations.service';
import { applyParkedEskizStatus } from '../../messaging/eskiz-status';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.module';

export interface TemplateSmsInput {
  phone: string;
  templateKey: string;
  locale: Locale;
  vars: Record<string, string | number>;
  customerId?: string | null;
  /** Store the rendered text in `Message`. Off for secrets (OTP codes must not persist in plain text). */
  record: boolean;
  marketing?: boolean;
}

/** Renders a DB `MessageTemplate` (Eskiz-approved wording) and sends it by SMS. */
@Injectable()
export class TemplateSms {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly redis: RedisService,
  ) {}

  async render(
    key: string,
    locale: Locale,
    vars: Record<string, string | number>,
  ): Promise<string> {
    const tpl = await this.prisma.messageTemplate.findUnique({ where: { key } });
    if (!tpl?.active) throw new Error(`message template "${key}" is missing or inactive`);
    // Eskiz delivers only approved texts (CLAUDE.md §6 messaging engine).
    if (!tpl.smsApproved) throw new Error(`SMS text "${key}" is not marked Eskiz-approved`);
    const text = fillTemplate(t(tpl.body, locale), vars);
    if (text === null) throw new Error(`message template "${key}" has unresolved variables`);
    return text;
  }

  async send(input: TemplateSmsInput): Promise<void> {
    const text = await this.render(input.templateKey, input.locale, input.vars);
    const record = (data: { status: 'SENT' | 'FAILED'; providerId?: string; error?: string }) =>
      input.record
        ? this.prisma.message.create({
            data: {
              customerId: input.customerId ?? null,
              channel: 'SMS',
              templateKey: input.templateKey,
              body: text,
              marketing: input.marketing ?? false,
              status: data.status,
              providerId: data.providerId ?? null,
              error: data.error?.slice(0, 300) ?? null,
              sentAt: data.status === 'SENT' ? new Date() : null,
            },
          })
        : Promise.resolve();
    try {
      const sms = await this.integrations.sms();
      const { providerId } = await sms.send({
        phone: input.phone,
        text,
        templateKey: input.templateKey,
      });
      await record({ status: 'SENT', providerId });
      // A delivery report that beat the write above was parked by the Eskiz callback.
      // Best effort: the SMS went out, a Redis hiccup must not record it as failed.
      if (input.record)
        await applyParkedEskizStatus(this.redis, this.prisma, providerId).catch(() => false);
    } catch (e) {
      await record({ status: 'FAILED', error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }
}
