import { Body, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  type StaffDto,
  type StaffInviteInput,
  staffInviteSchema,
  type StaffInviteResultDto,
  type StaffUpdateInput,
  staffUpdateSchema,
} from '@forest/contracts';
import { ZodPipe } from '../../common/http';
import { Actor, AdminController, RequirePermissions } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { StaffService } from './staff.service';

/** A16 "Xodimlar": Owner only (`settings.staff`). */
@AdminController('staff')
export class AdminStaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions('settings.staff')
  list(): Promise<StaffDto[]> {
    return this.staff.list();
  }

  @Post()
  @RequirePermissions('settings.staff')
  invite(
    @Body(new ZodPipe(staffInviteSchema)) body: StaffInviteInput,
    @Actor() actor: AuditActor,
  ): Promise<StaffInviteResultDto> {
    return this.staff.invite(actor, body);
  }

  @Post(':id/invite')
  @HttpCode(200)
  @RequirePermissions('settings.staff')
  reissueInvite(
    @Param('id') id: string,
    @Actor() actor: AuditActor,
  ): Promise<StaffInviteResultDto> {
    return this.staff.reissueInvite(actor, id);
  }

  @Patch(':id')
  @RequirePermissions('settings.staff')
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(staffUpdateSchema)) body: StaffUpdateInput,
    @Actor() actor: AuditActor,
  ): Promise<StaffDto> {
    return this.staff.update(actor, id, body);
  }

  @Post(':id/reset-totp')
  @HttpCode(200)
  @RequirePermissions('settings.staff')
  resetTotp(@Param('id') id: string, @Actor() actor: AuditActor): Promise<StaffDto> {
    return this.staff.resetTotp(actor, id);
  }
}
