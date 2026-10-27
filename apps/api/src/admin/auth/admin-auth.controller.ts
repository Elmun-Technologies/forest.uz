import { Body, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  type AcceptInviteInput,
  acceptInviteSchema,
  type AdminLoginInput,
  adminLoginSchema,
  type AdminMeDto,
  type InviteInfoDto,
  type TotpCodeInput,
  totpCodeSchema,
  type TotpSetupDto,
} from '@forest/contracts';
import type { Request, Response } from 'express';
import { ZodPipe } from '../../common/http';
import type { AdminContext } from '../admin-access';
import { Actor, Admin, AdminController, AdminPublic, AdminSession } from '../admin-http';
import type { AuditActor } from '../audit/audit.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminSessionService } from './admin-session.service';

/**
 * `/v1/admin/auth/*` — the only admin controller allowed to use `@AdminPublic` / `@AdminSession`
 * (enforced by the route-metadata test). Mutations still need the CSRF double-submit token: the
 * admin UI gets one from `GET auth/csrf` before the login form posts.
 */
@AdminController('auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly sessions: AdminSessionService,
  ) {}

  @Get('csrf')
  @AdminPublic()
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response): { token: string } {
    res.setHeader('Cache-Control', 'no-store');
    return { token: this.sessions.ensureCsrfCookie(req, res) };
  }

  @Post('login')
  @HttpCode(200)
  @AdminPublic()
  login(
    @Body(new ZodPipe(adminLoginSchema)) body: AdminLoginInput,
    @Actor() actor: AuditActor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminMeDto> {
    return this.auth.login(body, actor, req, res);
  }

  @Get('me')
  @AdminSession('totp', 'setup')
  me(@Admin() ctx: AdminContext, @Res({ passthrough: true }) res: Response): AdminMeDto {
    res.setHeader('Cache-Control', 'no-store');
    return this.auth.me(ctx);
  }

  @Post('totp/setup')
  @HttpCode(200)
  @AdminSession('setup')
  totpSetup(
    @Admin() ctx: AdminContext,
    @Actor() actor: AuditActor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TotpSetupDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.auth.setupTotp(ctx, actor);
  }

  @Post('totp/verify')
  @HttpCode(200)
  @AdminSession('totp', 'setup')
  totpVerify(
    @Admin() ctx: AdminContext,
    @Body(new ZodPipe(totpCodeSchema)) body: TotpCodeInput,
    @Actor() actor: AuditActor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminMeDto> {
    return this.auth.verifyTotp(ctx, body.code, actor, res);
  }

  @Post('logout')
  @HttpCode(204)
  @AdminSession('totp', 'setup')
  logout(
    @Admin() ctx: AdminContext,
    @Actor() actor: AuditActor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    return this.auth.logout(ctx, actor, req, res);
  }

  @Get('invite/:token')
  @AdminPublic()
  invite(@Param('token') token: string): Promise<InviteInfoDto> {
    return this.auth.inviteInfo(token);
  }

  @Post('accept-invite')
  @HttpCode(200)
  @AdminPublic()
  acceptInvite(
    @Body(new ZodPipe(acceptInviteSchema)) body: AcceptInviteInput,
    @Actor() actor: AuditActor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminMeDto> {
    return this.auth.acceptInvite(body, actor, req, res);
  }
}
