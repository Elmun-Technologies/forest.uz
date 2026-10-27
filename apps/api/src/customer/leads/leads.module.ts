import { Body, Controller, HttpCode, Module, Post, Req } from '@nestjs/common';
import { type LeadResultDto, type Locale, leadSchema, waitlistSchema } from '@forest/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import { ReqLocale, ZodPipe } from '../../common/http';
import { CustomerCommonModule } from '../common/customer-common.module';
import { LeadsService } from './leads.service';

@Controller()
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post('leads')
  @HttpCode(200)
  create(
    @Body(new ZodPipe(leadSchema)) body: z.infer<typeof leadSchema>,
    @Req() req: Request,
    @ReqLocale() locale: Locale,
  ): Promise<LeadResultDto> {
    return this.leads.create(body, req.ip ?? null, locale);
  }

  @Post('catalog/waitlist')
  @HttpCode(200)
  async waitlist(
    @Body(new ZodPipe(waitlistSchema)) body: z.infer<typeof waitlistSchema>,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    await this.leads.waitlist(body, req.ip ?? null);
    return { ok: true };
  }
}

@Module({
  imports: [CustomerCommonModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
