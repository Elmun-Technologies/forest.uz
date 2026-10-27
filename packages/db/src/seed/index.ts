/**
 * Idempotent dev/staging seed. Creates missing rows only, so admin edits survive re-runs;
 * pass `--force` to overwrite catalog/content with the seed values.
 * Never run against production (guarded by NODE_ENV).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { normalizeSearch, normalizeUzPhone } from '@forest/contracts';
import { Prisma, PrismaClient } from '../../generated/client';
import {
  alternatives,
  categories,
  crossSell,
  IKPU_PLACEHOLDER,
  products,
  upsell,
} from './data/catalog';
import {
  homeFaq,
  legalPages,
  messageTemplates,
  promoCodes,
  selectorItems,
  synonyms,
} from './data/content';
import { settings } from './data/settings';
import { createSeedStorage } from './storage';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const photosDir = path.join(repoRoot, 'design/assets/photos');
const force = process.argv.includes('--force');

/** Pixel sizes of the stock photos (used for width/height → no CLS). */
const PHOTO_SIZES: Record<string, [number, number]> = {
  'brush-hand.jpg': [1400, 935],
  'brushes-jar.jpg': [1400, 934],
  'classic-green-sofa.jpg': [1251, 1400],
  'corner-sofa.jpg': [1120, 1400],
  'dark-fabric.jpg': [933, 1400],
  'green-couch.jpg': [933, 1400],
  'green-fabric.jpg': [933, 1400],
  'green-spray-bottle.jpg': [1400, 1400],
  'green-velvet-living.jpg': [933, 1400],
  'hero-after.jpg': [1600, 1200],
  'hero-before.jpg': [1600, 1200],
  'hero-brand.jpg': [1400, 1050],
  'kreslo.jpg': [900, 1200],
  'oshxona.jpg': [1200, 800],
  'painting-materials.jpg': [1400, 934],
  'parquet.jpg': [1400, 934],
  'shkaf.jpg': [900, 1200],
  'sprayer-hand.jpg': [933, 1400],
  'stol.jpg': [1200, 675],
  'wax-varnish.jpg': [1400, 934],
  'white-couch.jpg': [933, 1400],
  'white-dresser.jpg': [1400, 934],
  'white-shelf-bedroom.jpg': [1400, 935],
  'woman-delivery.jpg': [933, 1400],
  'woman-green-sofa.jpg': [1400, 934],
};

const prisma = new PrismaClient();
const json = (v: unknown) => v as Prisma.InputJsonValue;

async function seedFiles(): Promise<Map<string, string>> {
  const storage = await createSeedStorage().catch((e: unknown) => {
    console.warn(`! object storage unavailable, images will 404 until it is up: ${String(e)}`);
    return null;
  });
  const ids = new Map<string, string>();
  let uploaded = 0;
  for (const [name, [width, height]] of Object.entries(PHOTO_SIZES)) {
    const key = `seed/photos/${name}`;
    const filePath = path.join(photosDir, name);
    if (storage && existsSync(filePath)) {
      if (await storage.upload(key, filePath, 'image/jpeg')) uploaded++;
    }
    const file = await prisma.file.upsert({
      where: { key },
      update: {},
      create: { key, mime: 'image/jpeg', size: 0, width, height, isPublic: true },
    });
    ids.set(name, file.id);
  }
  console.log(`✓ files: ${ids.size} (${uploaded} uploaded)`);
  return ids;
}

async function seedSettings() {
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({
      where: { key },
      update: force ? { value: json(value) } : {},
      create: { key, value: json(value) },
    });
  }
  console.log(`✓ settings: ${Object.keys(settings).length}`);
}

async function seedCatalog(files: Map<string, string>) {
  const seller = await prisma.seller.upsert({
    where: { slug: 'forest' },
    update: {},
    create: { slug: 'forest', name: 'Forest', isOfficial: true },
  });

  const categoryIds = new Map<string, string>();
  for (const c of categories) {
    const data = {
      name: json(c.name),
      seoText: json(c.seoText),
      sort: c.sort,
      imageId: files.get(c.photo) ?? null,
    };
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: force ? data : {},
      create: { slug: c.slug, ...data },
    });
    categoryIds.set(c.slug, row.id);
  }

  const productIds = new Map<string, string>();
  const variantIds = new Map<string, string>();
  for (const p of products) {
    const searchText = normalizeSearch(
      [
        p.name.uz,
        p.name.ru,
        p.shortDesc.uz,
        p.shortDesc.ru,
        ...p.variants.flatMap((v) => [v.label.uz, v.label.ru, v.sku]),
        ...(p.synonyms ?? []),
      ].join(' '),
    );
    const data = {
      type: p.type,
      status: 'ACTIVE' as const,
      sellerId: seller.id,
      name: json(p.name),
      subtitle: p.subtitle ? json(p.subtitle) : Prisma.JsonNull,
      shortDesc: json(p.shortDesc),
      description: json(p.description),
      howToApply: p.howToApply ? json(p.howToApply) : Prisma.JsonNull,
      specs: p.specs ? json(p.specs) : Prisma.JsonNull,
      badges: p.badges,
      surfaces: p.surfaces,
      coverageM2PerL: p.coverageM2PerL ?? null,
      dryTimeMinutes: p.dryTimeMinutes ?? null,
      isBestseller: p.isBestseller,
      bestsellerSort: p.bestsellerSort ?? null,
      popularity: p.popularity,
      searchText,
    };
    const existing = await prisma.product.findUnique({ where: { slug: p.slug } });
    const product = existing
      ? force
        ? await prisma.product.update({ where: { id: existing.id }, data })
        : existing
      : await prisma.product.create({ data: { slug: p.slug, ...data } });
    productIds.set(p.slug, product.id);

    await prisma.productCategory.upsert({
      where: {
        productId_categoryId: { productId: product.id, categoryId: categoryIds.get(p.category)! },
      },
      update: {},
      create: { productId: product.id, categoryId: categoryIds.get(p.category)! },
    });

    for (const [i, v] of p.variants.entries()) {
      const vdata = {
        productId: product.id,
        label: json(v.label),
        colorHex: v.colorHex ?? null,
        volumeMl: v.volumeMl ?? null,
        priceTiyin: BigInt(v.priceSoum) * 100n,
        compareAtTiyin: v.compareAtSoum ? BigInt(v.compareAtSoum) * 100n : null,
        ikpu: IKPU_PLACEHOLDER,
        vatPercent: 12,
        weightGrams: v.weightGrams ?? null,
        stock: v.stock,
        lowStockAt: v.lowStockAt ?? settings['catalog.rules'].lowStockDefault,
        sort: i,
      };
      const row = await prisma.variant.upsert({
        where: { sku: v.sku },
        update: force ? vdata : {},
        create: { sku: v.sku, ...vdata },
      });
      variantIds.set(v.sku, row.id);
    }

    if (force || !existing) {
      await prisma.productImage.deleteMany({ where: { productId: product.id } });
      await prisma.productImage.createMany({
        data: p.photos.map((ph, i) => ({
          productId: product.id,
          fileId: files.get(ph.file)!,
          alt: json(ph.alt),
          sort: i,
        })),
      });
    }
  }

  for (const p of products.filter((x) => x.components)) {
    for (const c of p.components ?? []) {
      await prisma.bundleItem.upsert({
        where: {
          bundleId_variantId: {
            bundleId: productIds.get(p.slug)!,
            variantId: variantIds.get(c.sku)!,
          },
        },
        update: { qty: c.qty },
        create: {
          bundleId: productIds.get(p.slug)!,
          variantId: variantIds.get(c.sku)!,
          qty: c.qty,
        },
      });
    }
  }

  const relations: [Record<string, string[]>, string][] = [
    [crossSell, 'CROSS_SELL'],
    [upsell, 'UPSELL'],
    [alternatives, 'ALTERNATIVE'],
  ];
  for (const [map, kind] of relations) {
    for (const [from, tos] of Object.entries(map)) {
      for (const [sort, to] of tos.entries()) {
        await prisma.productRelation.upsert({
          where: {
            fromId_toId_kind: { fromId: productIds.get(from)!, toId: productIds.get(to)!, kind },
          },
          update: { sort },
          create: { fromId: productIds.get(from)!, toId: productIds.get(to)!, kind, sort },
        });
      }
    }
  }
  console.log(
    `✓ catalog: ${categories.length} categories, ${products.length} products, ${variantIds.size} variants`,
  );
}

async function seedContent(files: Map<string, string>) {
  for (const page of legalPages) {
    for (const locale of ['uz', 'ru'] as const) {
      const data = {
        title: page.title[locale],
        body: json(page.body[locale]),
        version: settings['store.info'].offerVersion,
        published: true,
        data: json({ subtitle: page.subtitle[locale] }),
      };
      await prisma.page.upsert({
        where: { kind_slug_locale: { kind: 'LEGAL', slug: page.slug, locale } },
        update: force ? data : {},
        create: { kind: 'LEGAL', slug: page.slug, locale, ...data },
      });
    }
  }
  for (const locale of ['uz', 'ru'] as const) {
    const data = {
      title: locale === 'uz' ? "Xarid oldidan so'raladi" : 'Частые вопросы',
      body: json([{ type: 'faq', items: homeFaq[locale] }]),
      published: true,
    };
    await prisma.page.upsert({
      where: { kind_slug_locale: { kind: 'FAQ', slug: 'home', locale } },
      update: force ? data : {},
      create: { kind: 'FAQ', slug: 'home', locale, ...data },
    });
  }

  for (const s of selectorItems) {
    const data = {
      name: json(s.name),
      kind: json(s.kind),
      imageId: files.get(s.photo) ?? null,
      title: json(s.title),
      contents: json(s.contents),
      items: json(s.items),
      areaLabel: json(s.area),
      timeLabel: json(s.time),
      // "Buy new" price is a placeholder in the design → comparison hidden until the owner sets it.
      newItemPriceSoum: null,
      sort: s.sort,
    };
    await prisma.selectorItem.upsert({
      where: { key: s.key },
      update: force ? data : {},
      create: { key: s.key, ...data },
    });
  }

  for (const t of messageTemplates) {
    const data = {
      body: json(t.body),
      buttons: t.buttons ? json(t.buttons) : Prisma.JsonNull,
      delayMin: t.delayMin ?? 0,
      smsFallback: t.smsFallback ?? false,
    };
    await prisma.messageTemplate.upsert({
      where: { key: t.key },
      update: force ? data : {},
      create: { key: t.key, ...data },
    });
  }

  for (const p of promoCodes) {
    await prisma.promoCode.upsert({ where: { code: p.code }, update: {}, create: { ...p } });
  }

  for (const s of synonyms) {
    await prisma.searchSynonym.upsert({
      where: { term: s.term },
      update: { synonyms: s.synonyms },
      create: s,
    });
  }
  console.log(
    `✓ content: ${legalPages.length} legal pages ×2, FAQ, ${selectorItems.length} selector items, ${messageTemplates.length} templates, ${promoCodes.length} promo codes`,
  );
}

async function seedOwner() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_INITIAL_PASSWORD;
  if (!email || !password) {
    console.warn('! OWNER_EMAIL / OWNER_INITIAL_PASSWORD not set — owner account not created');
    return;
  }
  const existing = await prisma.staff.findUnique({ where: { email } });
  if (existing) return console.log('✓ owner exists');
  await prisma.staff.create({
    data: {
      email,
      name: 'Elmurodov',
      role: 'OWNER',
      phone: normalizeUzPhone(process.env.OWNER_PHONE ?? '') ?? null,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
  console.log(`✓ owner created: ${email} (change the password and enable 2FA on first login)`);
}

async function seedIntegrations() {
  // Registry rows are created lazily by the API; seed only marks everything disconnected (fake mode).
  const keys = [
    'payme',
    'click',
    'cod',
    'yandex_delivery',
    'bts',
    'moysklad',
    'eskiz',
    'telegram',
    'fiscal_ofd',
  ];
  for (const key of keys) {
    await prisma.integration.upsert({
      where: { key },
      update: {},
      create: { key, status: 'DISCONNECTED' },
    });
  }
}

/**
 * `--force` (dev reset): release every open reservation so repeated e2e runs don't drain the
 * seeded stock (COD orders hold stock for 24 h). Unpaid/unconfirmed (NEW) orders whose hold is
 * released are cancelled like the expiry job does it (payments EXPIRED, OrderEvent), so no order
 * stays "waiting" without stock; orders past NEW are kept as they are.
 */
async function releaseReservations() {
  if (!force) return;
  const now = new Date();
  const held = await prisma.reservation.findMany({
    where: { releasedAt: null },
    select: { orderId: true },
    distinct: ['orderId'],
  });
  const zombies = (
    await prisma.order.findMany({
      where: { id: { in: held.map((r) => r.orderId) }, status: 'NEW' },
      select: { id: true },
    })
  ).map((o) => o.id);
  const reason = 'dev_seed_reset';
  const [released] = await prisma.$transaction([
    prisma.reservation.updateMany({ where: { releasedAt: null }, data: { releasedAt: now } }),
    prisma.variant.updateMany({ where: { reserved: { gt: 0 } }, data: { reserved: 0 } }),
    prisma.payment.updateMany({
      where: { orderId: { in: zombies }, status: { in: ['PENDING', 'FAILED', 'COD_PENDING'] } },
      data: { status: 'EXPIRED' },
    }),
    prisma.order.updateMany({
      where: { id: { in: zombies }, status: 'NEW' },
      data: { status: 'CANCELLED', cancelReason: reason },
    }),
    prisma.orderEvent.createMany({
      data: zombies.map((orderId) => ({
        orderId,
        type: 'STATUS_CHANGED',
        from: 'NEW',
        to: 'CANCELLED',
        actorType: 'SYSTEM' as const,
        data: { reason },
      })),
    }),
  ]);
  console.log(
    `✓ reservations released: ${released.count}, unconfirmed orders cancelled: ${zombies.length}`,
  );
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--allow-production')) {
    throw new Error('Refusing to seed production. Pass --allow-production if you really mean it.');
  }
  const files = await seedFiles();
  await seedSettings();
  await seedCatalog(files);
  await releaseReservations();
  await seedContent(files);
  await seedOwner();
  await seedIntegrations();
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
