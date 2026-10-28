import {
  Body,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DELIVERY_STATUSES } from '@forest/contracts';
import { Prisma } from '@forest/db';
import { z } from 'zod';
import { assertDevEndpoints, DevEndpointsGuard } from '../common/dev-endpoints';
import { ZodPipe } from '../common/http';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { StoredCourier, StoredHistoryEntry } from './yandex-shipment.service';

const devShipmentSchema = z.object({
  publicId: z.string().min(1).max(64),
  status: z.enum(DELIVERY_STATUSES),
  carrier: z.enum(['YANDEX', 'BTS']).optional(),
  externalId: z.string().max(128).optional(),
  trackNumber: z.string().max(64).optional(),
  branch: z.string().max(200).optional(),
  courier: z
    .object({
      name: z.string().max(100),
      phone: z.string().max(32),
      phoneExt: z.string().max(16).optional(),
      phoneExpiresAt: z.iso.datetime().optional(),
      car: z.string().max(100).optional(),
      plate: z.string().max(32).optional(),
      etaAt: z.iso.datetime().optional(),
      distanceKm: z.number().nonnegative().optional(),
    })
    .optional(),
  note: z.string().max(200).optional(),
});

/**
 * Dev/e2e only: puts an order's shipment into a given carrier state so tracking/order pages can
 * be rendered without a real Yandex/BTS (no state machine, no notifications). 404 unless
 * DEV_ENDPOINTS=true and PROVIDERS_MODE=fake.
 */
@Controller('dev')
@UseGuards(DevEndpointsGuard)
export class DevShipmentController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('shipment')
  @HttpCode(200)
  async set(
    @Body(new ZodPipe(devShipmentSchema)) body: z.infer<typeof devShipmentSchema>,
  ): Promise<{ ok: true }> {
    assertDevEndpoints(this.env);
    const order = await this.prisma.order.findUnique({
      where: { publicId: body.publicId },
      include: { shipments: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    const shipment = order?.shipments[0];
    if (!shipment) throw new NotFoundException();
    const at = new Date().toISOString();
    const history = [...((shipment.history as StoredHistoryEntry[] | null) ?? [])];
    history.push({
      at,
      status: body.status,
      providerStatus: null,
      place: body.status === 'AT_BRANCH' && body.branch ? body.branch : '',
      note: body.note ?? '',
    });
    const courier: StoredCourier | undefined = body.courier && {
      name: body.courier.name,
      phone: body.courier.phone,
      phoneExt: body.courier.phoneExt ?? null,
      phoneExpiresAt: body.courier.phoneExpiresAt ?? null,
      car: body.courier.car ?? null,
      plate: body.courier.plate ?? null,
      transport: null,
      etaAt: body.courier.etaAt ?? null,
      distanceKm: body.courier.distanceKm ?? null,
    };
    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: body.status,
        ...(body.carrier ? { carrier: body.carrier } : {}),
        ...(body.externalId !== undefined ? { externalId: body.externalId } : {}),
        ...(body.trackNumber !== undefined ? { trackNumber: body.trackNumber } : {}),
        ...(body.branch !== undefined ? { branch: { name: body.branch } } : {}),
        ...(courier ? { courier: courier as unknown as Prisma.InputJsonValue } : {}),
        history: history as unknown as Prisma.InputJsonValue,
      },
    });
    return { ok: true };
  }
}
