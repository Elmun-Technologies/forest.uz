import { Body, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  type CustomerDetailDto,
  type CustomerEraseInput,
  customerEraseSchema,
  type CustomerEraseResultDto,
  type CustomerExportInput,
  customerExportSchema,
  type CustomerFilterOptionsDto,
  type CustomerListDto,
  type CustomerListQuery,
  customerListQuerySchema,
  type CustomerNoteDto,
  type CustomerNoteInput,
  customerNoteSchema,
  type CustomerPiiDto,
  type CustomerTagsInput,
  customerTagsSchema,
  formatTashkentDate,
} from '@forest/contracts';
import type { Response } from 'express';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { CustomerEraseService } from './customer-erase.service';
import { AdminCustomersService } from './customers.service';

/**
 * A4 Customers / A5 Customer 360°. List and detail: `customers.view` (masked); reveal:
 * `customers.pii`; CSV / data export: `customers.export`; erase: `customers.erase` (Owner).
 */
@AdminController('customers')
export class AdminCustomersController {
  constructor(
    private readonly customers: AdminCustomersService,
    private readonly eraser: CustomerEraseService,
  ) {}

  @Get()
  @RequirePermissions('customers.view')
  list(
    @Query(new ZodPipe(customerListQuerySchema)) q: CustomerListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerListDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.customers.list(q);
  }

  @Get('filters')
  @RequirePermissions('customers.view')
  filters(): Promise<CustomerFilterOptionsDto> {
    return this.customers.filterOptions();
  }

  @Post('export')
  @HttpCode(200)
  @RequirePermissions('customers.export')
  async exportCsv(
    @Body(new ZodPipe(customerExportSchema)) body: CustomerExportInput,
    @Actor() actor: AuditActor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.customers.exportCsv(actor, body);
    const day = formatTashkentDate(new Date()).split('.').reverse().join('-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mijozlar-${day}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return csv;
  }

  @Get(':id')
  @RequirePermissions('customers.view')
  detail(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerDetailDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.customers.detail(id);
  }

  @Post(':id/reveal')
  @HttpCode(200)
  @RequirePermissions('customers.pii')
  reveal(
    @Param('id') id: string,
    @Actor() actor: AuditActor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerPiiDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.customers.reveal(actor, id);
  }

  @Put(':id/tags')
  @RequirePermissions('customers.view')
  tags(
    @Param('id') id: string,
    @Body(new ZodPipe(customerTagsSchema)) body: CustomerTagsInput,
    @Actor() actor: AuditActor,
  ): Promise<{ tags: string[] }> {
    return this.customers.setTags(actor, id, body.tags);
  }

  @Post(':id/notes')
  @RequirePermissions('customers.view')
  note(
    @Param('id') id: string,
    @Body(new ZodPipe(customerNoteSchema)) body: CustomerNoteInput,
    @Actor() actor: AuditActor,
  ): Promise<CustomerNoteDto> {
    return this.customers.addNote(actor, id, body.text);
  }

  @Post(':id/export')
  @HttpCode(200)
  @RequirePermissions('customers.export')
  async exportOne(
    @Param('id') id: string,
    @Actor() actor: AuditActor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    const data = await this.customers.exportOne(actor, id);
    res.setHeader('Cache-Control', 'no-store');
    return data;
  }

  @Post(':id/erase')
  @HttpCode(200)
  @RequirePermissions('customers.erase')
  erase(
    @Param('id') id: string,
    @Body(new ZodPipe(customerEraseSchema)) body: CustomerEraseInput,
    @Actor() actor: AuditActor,
  ): Promise<CustomerEraseResultDto> {
    return this.eraser.erase(actor, id, body.confirm);
  }
}
