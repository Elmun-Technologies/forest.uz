import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type AddressDto,
  type AddressUpdateInput,
  type ConsentsDto,
  type DataDeleteRequestDto,
  type Locale,
  type MeDto,
  type MeUpdateInput,
  type ProductCardDto,
  addressSchema,
  addressUpdateSchema,
  consentsSchema,
  favoriteSchema,
  idSchema,
  meUpdateSchema,
} from '@forest/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import { ReqLocale, ZodPipe } from '../../common/http';
import { CustomerGuard, CustomerId } from '../auth/customer.guard';
import { RateLimiter } from '../common/rate-limit';
import { MeService } from './me.service';

const NO_STORE = 'private, no-store';

@Controller('me')
@UseGuards(CustomerGuard)
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly limiter: RateLimiter,
  ) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  get(@CustomerId() id: string): Promise<MeDto> {
    return this.me.me(id);
  }

  @Patch()
  update(
    @CustomerId() id: string,
    @Body(new ZodPipe(meUpdateSchema)) body: MeUpdateInput,
  ): Promise<MeDto> {
    return this.me.update(id, body);
  }

  @Get('addresses')
  @Header('Cache-Control', NO_STORE)
  addresses(@CustomerId() id: string): Promise<AddressDto[]> {
    return this.me.addresses(id);
  }

  @Post('addresses')
  addAddress(
    @CustomerId() id: string,
    @Body(new ZodPipe(addressSchema)) body: z.infer<typeof addressSchema>,
  ): Promise<AddressDto> {
    return this.me.addAddress(id, body);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CustomerId() id: string,
    @Param('id', new ZodPipe(idSchema)) addressId: string,
    @Body(new ZodPipe(addressUpdateSchema)) body: AddressUpdateInput,
  ): Promise<AddressDto> {
    return this.me.updateAddress(id, addressId, body);
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  deleteAddress(
    @CustomerId() id: string,
    @Param('id', new ZodPipe(idSchema)) addressId: string,
  ): Promise<void> {
    return this.me.deleteAddress(id, addressId);
  }

  @Get('favorites')
  @Header('Cache-Control', NO_STORE)
  favorites(@CustomerId() id: string, @ReqLocale() locale: Locale): Promise<ProductCardDto[]> {
    return this.me.favorites(id, locale);
  }

  @Post('favorites')
  @HttpCode(204)
  addFavorite(
    @CustomerId() id: string,
    @Body(new ZodPipe(favoriteSchema)) body: { productId: string },
  ): Promise<void> {
    return this.me.addFavorite(id, body.productId);
  }

  @Delete('favorites/:productId')
  @HttpCode(204)
  removeFavorite(
    @CustomerId() id: string,
    @Param('productId', new ZodPipe(idSchema)) productId: string,
  ): Promise<void> {
    return this.me.removeFavorite(id, productId);
  }

  @Patch('consents')
  consents(
    @CustomerId() id: string,
    @Body(new ZodPipe(consentsSchema)) body: Partial<ConsentsDto>,
  ): Promise<ConsentsDto> {
    return this.me.updateConsents(id, body);
  }

  @Post('data-export')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  @Header('Content-Disposition', 'attachment; filename="forest-data.json"')
  async dataExport(
    @CustomerId() id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    await this.limiter.consume('me:export', id, 5, 3600);
    return this.me.exportData(id, req.ip ?? null);
  }

  @Post('data-delete')
  @HttpCode(202)
  dataDelete(@CustomerId() id: string, @Req() req: Request): Promise<DataDeleteRequestDto> {
    return this.me.requestDeletion(id, req.ip ?? null);
  }
}
