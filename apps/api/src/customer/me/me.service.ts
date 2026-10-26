import { Injectable } from '@nestjs/common';
import {
  type AddressDto,
  type AddressUpdateInput,
  type ConsentsDto,
  type DataDeleteRequestDto,
  DomainError,
  type Locale,
  type MeDto,
  type MeUpdateInput,
  type ProductCardDto,
  UZ_REGIONS,
  addressSchema,
  t,
  tiyinToSoumInt,
} from '@forest/contracts';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { ConsentsService } from '../common/consents';
import { CatalogService } from '../../catalog/catalog.service';

type AddressInput = z.infer<typeof addressSchema>;

const MAX_ADDRESSES = 10;
const MAX_FAVORITES = 200;
const REGION_CODES = new Set<string>(UZ_REGIONS.map((r) => r.code));

function toAddressDto(a: {
  id: string;
  label: string | null;
  region: string;
  district: string | null;
  line: string;
  isDefault: boolean;
}): AddressDto {
  return {
    id: a.id,
    label: a.label,
    region: a.region,
    district: a.district,
    line: a.line,
    isDefault: a.isDefault,
  };
}

function assertRegion(region: string | undefined): void {
  if (region !== undefined && !REGION_CODES.has(region))
    throw new DomainError('VALIDATION_FAILED', undefined, 'region');
}

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consents: ConsentsService,
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
  ) {}

  async me(customerId: string): Promise<MeDto> {
    const c = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { _count: { select: { orders: true, favorites: true, addresses: true } } },
    });
    // Session outlived the customer row (erased): treat as logged out.
    if (!c || c.deletedAt) throw new DomainError('UNAUTHORIZED');
    return {
      id: c.id,
      publicId: c.publicId,
      name: c.name,
      phone: c.phone,
      locale: c.locale,
      customerSince: c.createdAt.toISOString(),
      consents: await this.consents.current(c.id),
      ordersCount: c._count.orders,
      favoritesCount: c._count.favorites,
      addressesCount: c._count.addresses,
    };
  }

  async update(customerId: string, input: MeUpdateInput): Promise<MeDto> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
      },
    });
    return this.me(customerId);
  }

  // ───────── Addresses ─────────

  async addresses(customerId: string): Promise<AddressDto[]> {
    const rows = await this.prisma.address.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toAddressDto);
  }

  async addAddress(customerId: string, input: AddressInput): Promise<AddressDto> {
    assertRegion(input.region);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { customerId } });
      if (count >= MAX_ADDRESSES)
        throw new DomainError('VALIDATION_FAILED', { max: MAX_ADDRESSES }, 'addresses');
      // The first address is the default one, whatever the client sent.
      const isDefault = input.isDefault || count === 0;
      if (isDefault)
        await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      const row = await tx.address.create({
        data: {
          customerId,
          label: input.label ?? null,
          region: input.region,
          district: input.district ?? null,
          line: input.line,
          isDefault,
        },
      });
      return toAddressDto(row);
    });
  }

  async updateAddress(
    customerId: string,
    id: string,
    input: AddressUpdateInput,
  ): Promise<AddressDto> {
    assertRegion(input.region);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findFirst({ where: { id, customerId } });
      if (!existing) throw new DomainError('NOT_FOUND');
      if (input.isDefault === true)
        await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      // There is always one default: unsetting it is ignored until another address becomes default.
      const isDefault = input.isDefault === false && existing.isDefault ? true : input.isDefault;
      const row = await tx.address.update({
        where: { id },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.region !== undefined ? { region: input.region } : {}),
          ...(input.district !== undefined ? { district: input.district } : {}),
          ...(input.line !== undefined ? { line: input.line } : {}),
          ...(isDefault !== undefined ? { isDefault } : {}),
        },
      });
      return toAddressDto(row);
    });
  }

  async deleteAddress(customerId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findFirst({ where: { id, customerId } });
      if (!existing) throw new DomainError('NOT_FOUND');
      await tx.address.delete({ where: { id } });
      if (existing.isDefault) {
        const next = await tx.address.findFirst({ where: { customerId }, orderBy: { id: 'desc' } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  // ───────── Favorites ─────────

  async favorites(customerId: string, locale: Locale): Promise<ProductCardDto[]> {
    const rows = await this.prisma.favorite.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
    return this.catalog.byIds(
      rows.map((r) => r.productId),
      locale,
    );
  }

  async addFavorite(customerId: string, productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!product) throw new DomainError('PRODUCT_NOT_FOUND', undefined, 'productId');
    const count = await this.prisma.favorite.count({ where: { customerId } });
    if (count >= MAX_FAVORITES)
      throw new DomainError('VALIDATION_FAILED', { max: MAX_FAVORITES }, 'productId');
    await this.prisma.favorite.createMany({
      data: [{ customerId, productId }],
      skipDuplicates: true,
    });
  }

  async removeFavorite(customerId: string, productId: string): Promise<void> {
    await this.prisma.favorite.deleteMany({ where: { customerId, productId } });
  }

  // ───────── Consents & data rights ─────────

  updateConsents(customerId: string, changes: Partial<ConsentsDto>): Promise<ConsentsDto> {
    return this.prisma.$transaction((tx) =>
      this.consents.record(tx, customerId, changes, 'cabinet'),
    );
  }

  /** Everything we hold about the customer that they can see (docs/14 data subject requests). */
  async exportData(customerId: string, ip: string | null): Promise<Record<string, unknown>> {
    const c = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        addresses: true,
        consents: { orderBy: { createdAt: 'asc' } },
        favorites: true,
        orders: { include: { items: true }, orderBy: { createdAt: 'asc' } },
        reviews: { orderBy: { createdAt: 'asc' } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!c || c.deletedAt) throw new DomainError('UNAUTHORIZED');
    const products = await this.prisma.product.findMany({
      where: { id: { in: c.favorites.map((f) => f.productId) } },
      select: { id: true, slug: true },
    });
    const slugOf = new Map(products.map((p) => [p.id, p.slug]));
    const locale = c.locale;
    await this.prisma.auditLog.create({
      data: { action: 'customer.data_export', entity: 'Customer', entityId: c.id, ip },
    });
    return {
      exportedAt: new Date().toISOString(),
      profile: {
        publicId: c.publicId,
        phone: c.phone,
        name: c.name,
        locale: c.locale,
        telegramUsername: c.telegramUsername,
        customerSince: c.createdAt.toISOString(),
        leadSource: c.leadSource,
        leadAt: c.leadAt?.toISOString() ?? null,
      },
      addresses: c.addresses.map(toAddressDto),
      consents: c.consents.map((x) => ({
        channel: x.channel,
        granted: x.granted,
        source: x.source,
        at: x.createdAt.toISOString(),
      })),
      favorites: c.favorites.map((f) => ({
        productSlug: slugOf.get(f.productId) ?? null,
        addedAt: f.createdAt.toISOString(),
      })),
      orders: c.orders.map((o) => ({
        number: o.number,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        contactName: o.contactName,
        contactPhone: o.contactPhone,
        address: o.address,
        paymentMethod: o.paymentMethod,
        totalSoum: tiyinToSoumInt(o.totalTiyin),
        items: o.items.map((i) => ({
          name: t(i.nameSnapshot, locale),
          sku: i.sku,
          qty: i.qty,
          priceSoum: tiyinToSoumInt(i.priceTiyin),
        })),
      })),
      reviews: c.reviews.map((r) => ({
        rating: r.rating,
        text: r.text,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      messages: c.messages.map((m) => ({
        channel: m.channel,
        templateKey: m.templateKey,
        body: m.body,
        status: m.status,
        at: m.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Records an erasure request; anonymization itself is a Phase 3 job that reads these audit rows.
   * Repeated requests return the pending one instead of piling up.
   */
  async requestDeletion(customerId: string, ip: string | null): Promise<DataDeleteRequestDto> {
    const { deletionSlaDays } = await this.settings.get('store.info');
    const dueBy = (from: Date) => new Date(from.getTime() + deletionSlaDays * 86_400_000);
    const pending = await this.prisma.auditLog.findFirst({
      where: { action: 'customer.erase_requested', entity: 'Customer', entityId: customerId },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      return {
        requestedAt: pending.createdAt.toISOString(),
        dueBy: dueBy(pending.createdAt).toISOString(),
      };
    }
    const now = new Date();
    const row = await this.prisma.auditLog.create({
      data: {
        action: 'customer.erase_requested',
        entity: 'Customer',
        entityId: customerId,
        after: { dueBy: dueBy(now).toISOString(), source: 'cabinet' },
        ip,
      },
    });
    return { requestedAt: row.createdAt.toISOString(), dueBy: dueBy(row.createdAt).toISOString() };
  }
}
