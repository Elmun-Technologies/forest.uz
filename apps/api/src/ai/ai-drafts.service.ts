import { Injectable, Logger } from '@nestjs/common';
import {
  AI_DRAFT_POLICY,
  type AiDraftKind,
  type AiProductDescriptionDraftDto,
  type AiReplyDraftDto,
  type AiSeoDraftDto,
  CMS_ARTICLE_KIND,
  DomainError,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  t,
} from '@forest/contracts';
import type { AuditActor } from '../admin/audit/audit.service';
import { AuditService } from '../admin/audit/audit.service';
import { RateLimiter } from '../customer/common/rate-limit';
import { IntegrationsService } from '../integrations/integrations.service';
import type { AiCompletion } from '../integrations/providers/types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { pageData } from '../cms/page-data';
import {
  clip,
  factsBlock,
  PRODUCT_SCHEMA,
  PRODUCT_SYSTEM,
  REPLY_SCHEMA,
  REPLY_SYSTEM,
  scrubPii,
  SEO_SCHEMA,
  SEO_SYSTEM,
} from './prompts';

type Pair = { uz: string; ru: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const pairOf = (v: unknown): Pair => ({
  uz: isObj(v) && typeof v.uz === 'string' ? v.uz : '',
  ru: isObj(v) && typeof v.ru === 'string' ? v.ru : '',
});

/**
 * AI drafts (CLAUDE.md §6): builds a PII-free prompt from stored data, asks the `claude`
 * integration for schema-shaped JSON and returns it unsaved. Rate-limited, audited (no prompt or
 * output text), token usage logged.
 */
@Injectable()
export class AiDraftsService {
  private readonly logger = new Logger('AiDrafts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly settings: SettingsService,
  ) {}

  async productDescription(
    actor: AuditActor,
    productId: string,
    hint: string,
  ): Promise<AiProductDescriptionDraftDto> {
    const p = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { where: { active: true }, orderBy: { sort: 'asc' } },
        categories: { include: { category: { select: { name: true } } } },
      },
    });
    if (!p) throw new DomainError('PRODUCT_NOT_FOUND');
    const name = pairOf(p.name);
    if (!name.uz && !name.ru) throw new DomainError('AI_DRAFT_NO_SOURCE');
    const specs = Array.isArray(p.specs)
      ? p.specs.flatMap((s) =>
          isObj(s)
            ? [
                `${pairOf(s.key).uz || pairOf(s.key).ru}: ${pairOf(s.value).uz || pairOf(s.value).ru}`,
              ]
            : [],
        )
      : [];
    const facts = factsBlock({
      'name (uz)': name.uz,
      'name (ru)': name.ru,
      type: p.type === 'BUNDLE' ? 'kit (bundle of products)' : 'single product',
      categories: p.categories.map((c) => t(c.category.name, 'uz')),
      'current short description (uz)': pairOf(p.shortDesc).uz,
      'current short description (ru)': pairOf(p.shortDesc).ru,
      'current description (uz)': clip(pairOf(p.description).uz, 1500),
      specs,
      surfaces: p.surfaces,
      'coverage m2 per litre': p.coverageM2PerL?.toString() ?? null,
      'drying time minutes': p.dryTimeMinutes,
      variants: p.variants.map((v) => pairOf(v.label).uz || v.sku),
      'staff note': scrubPii(hint),
    });
    const { draft, completion, model } = await this.run(actor, 'product_description', {
      system: PRODUCT_SYSTEM,
      prompt: `Product facts:\n${facts}\n\nWrite shortDesc and description in uz and ru.`,
      schema: PRODUCT_SCHEMA,
    });
    const out = {
      shortDesc: {
        uz: clip(pairOf(draft.shortDesc).uz, 400),
        ru: clip(pairOf(draft.shortDesc).ru, 400),
      },
      description: {
        uz: clip(pairOf(draft.description).uz, 8000),
        ru: clip(pairOf(draft.description).ru, 8000),
      },
    };
    await this.done(actor, 'product_description', 'Product', productId, completion);
    return { ...out, model, fake: completion.model === 'fake' };
  }

  async seo(actor: AuditActor, path: string): Promise<AiSeoDraftDto> {
    const facts = await this.pageFacts(path);
    const { draft, completion, model } = await this.run(actor, 'seo', {
      system: SEO_SYSTEM,
      prompt: `Page: ${path}\n${facts}\n\nWrite title and description for uz and ru.`,
      schema: SEO_SCHEMA,
    });
    const part = (l: 'uz' | 'ru') => {
      const v = isObj(draft[l]) ? draft[l] : {};
      return {
        title: clip(v.title, SEO_TITLE_MAX),
        description: clip(v.description, SEO_DESCRIPTION_MAX),
      };
    };
    await this.done(actor, 'seo', 'SeoMeta', path, completion);
    return { uz: part('uz'), ru: part('ru'), model, fake: completion.model === 'fake' };
  }

  async reply(
    actor: AuditActor,
    conversationId: string,
    locale?: 'uz' | 'ru',
  ): Promise<AiReplyDraftDto> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        customer: { select: { locale: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: AI_DRAFT_POLICY.replyContext },
      },
    });
    if (!conv) throw new DomainError('NOT_FOUND');
    const messages = [...conv.messages].reverse().filter((m) => m.text?.trim());
    if (!messages.length) throw new DomainError('AI_DRAFT_NO_SOURCE');
    const lang =
      locale ??
      (/[а-яё]/i.test(messages.findLast((m) => m.fromCustomer)?.text ?? '')
        ? 'ru'
        : (conv.customer?.locale ?? 'uz'));
    const [store, zones] = await Promise.all([
      this.settings.get('store.info'),
      this.settings.get('delivery.zones'),
    ]);
    const shopFacts = factsBlock({
      'shop phone': store.phone,
      'working hours': store.hours[lang],
      'delivery zones': zones
        .filter((z) => z.active)
        .map((z) => `${z.name[lang]}: ${z.etaLabel[lang]}`),
      payments: 'Payme, Click, cash or card on delivery',
    });
    const transcript = messages
      .map((m) => `${m.fromCustomer ? 'Customer' : 'Operator'}: ${scrubPii(clip(m.text, 1000))}`)
      .join('\n');
    const { draft, completion, model } = await this.run(actor, 'reply', {
      system: REPLY_SYSTEM,
      prompt: `Shop facts:\n${shopFacts}\n\nConversation (oldest first):\n${transcript}\n\nWrite the operator's next reply in ${lang === 'ru' ? 'Russian' : 'Uzbek (Latin)'}.`,
      schema: REPLY_SCHEMA,
    });
    await this.done(actor, 'reply', 'Conversation', conversationId, completion);
    return { text: clip(draft.text, 1000), locale: lang, model, fake: completion.model === 'fake' };
  }

  /** Facts of a storefront page for SEO drafts (product, category, article, home/catalog). */
  private async pageFacts(path: string): Promise<string> {
    const [, kind, slug] = /^\/(p|katalog|ilhom)\/([a-z0-9-]+)$/.exec(path) ?? [];
    if (kind === 'p' && slug) {
      const p = await this.prisma.product.findUnique({ where: { slug } });
      if (!p) throw new DomainError('PRODUCT_NOT_FOUND');
      return factsBlock({
        type: 'product page',
        'name (uz)': pairOf(p.name).uz,
        'name (ru)': pairOf(p.name).ru,
        'short description (uz)': pairOf(p.shortDesc).uz,
        'short description (ru)': pairOf(p.shortDesc).ru,
      });
    }
    if (kind === 'katalog' && slug) {
      const c = await this.prisma.category.findUnique({ where: { slug } });
      if (!c) throw new DomainError('NOT_FOUND');
      return factsBlock({
        type: 'catalog category page',
        'name (uz)': pairOf(c.name).uz,
        'name (ru)': pairOf(c.name).ru,
        'seo text (uz)': clip(pairOf(c.seoText).uz, 800),
      });
    }
    if (kind === 'ilhom' && slug) {
      const rows = await this.prisma.page.findMany({ where: { kind: CMS_ARTICLE_KIND, slug } });
      if (!rows.length) throw new DomainError('NOT_FOUND');
      const of = (l: string) => rows.find((r) => r.locale === l);
      return factsBlock({
        type: 'inspiration article',
        'title (uz)': of('uz')?.title,
        'title (ru)': of('ru')?.title,
        'excerpt (uz)': pageData(of('uz')?.data).excerpt,
        'excerpt (ru)': pageData(of('ru')?.data).excerpt,
      });
    }
    const generic: Record<string, string> = {
      '/': 'home page of the shop: renew old furniture and sofas in one day with European paints',
      '/katalog': 'full catalog of furniture and fabric paints, wax, brushes and kits',
      '/ilhom': 'inspiration: before/after projects, video lessons and colour advice',
      '/brend': 'about the Forest brand, its values and partnership for craftsmen',
    };
    if (generic[path]) return factsBlock({ type: generic[path] });
    throw new DomainError('SEO_PAGE_UNKNOWN');
  }

  private async run(
    actor: AuditActor,
    kind: AiDraftKind,
    req: { system: string; prompt: string; schema: Record<string, unknown> },
  ): Promise<{ draft: Record<string, unknown>; completion: AiCompletion; model: string }> {
    await this.limiter.consume(
      'ai-draft',
      actor.staffId ?? 'system',
      AI_DRAFT_POLICY.perStaffPerMin,
      60,
      'AI_DRAFT_LIMITED',
    );
    await this.limiter.consume(
      'ai-draft-day',
      'all',
      AI_DRAFT_POLICY.perDay,
      86_400,
      'AI_DRAFT_LIMITED',
    );
    const provider = await this.integrations.ai();
    let completion: AiCompletion;
    try {
      completion = await provider.complete({ ...req, maxTokens: AI_DRAFT_POLICY.maxTokens });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ai draft ${kind} failed: ${message}`);
      await this.log(kind, false, `error: ${message}`);
      throw new DomainError('AI_DRAFT_FAILED');
    }
    let draft: unknown = null;
    if (!completion.stopped) {
      try {
        draft = JSON.parse(completion.text);
      } catch {
        draft = null;
      }
    }
    if (!isObj(draft)) {
      await this.log(kind, false, `${completion.model}: ${completion.stopped ?? 'invalid JSON'}`);
      throw new DomainError('AI_DRAFT_FAILED');
    }
    return { draft, completion, model: completion.model };
  }

  private async done(
    actor: AuditActor,
    kind: AiDraftKind,
    entity: string,
    entityId: string,
    c: AiCompletion,
  ): Promise<void> {
    await this.audit.record(actor, {
      action: 'ai.draft',
      entity,
      entityId,
      after: { kind, model: c.model, inputTokens: c.inputTokens, outputTokens: c.outputTokens },
    });
    await this.log(kind, true, `${c.model}: in ${c.inputTokens}, out ${c.outputTokens} tokens`);
  }

  private async log(kind: AiDraftKind, ok: boolean, message: string): Promise<void> {
    await this.integrations
      .log('claude', { direction: 'OUT', kind: `ai.draft.${kind}`, ok, message })
      .catch((e: unknown) => this.logger.warn(`integration log failed: ${String(e)}`));
  }
}
