import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ChangePasswordRequestSchema, LoginRequestSchema, RegisterRequestSchema, type AuthState, type ChangePasswordRequest, type LoginRequest, type RegisterRequest } from '@mad/schema';
import { zodBody } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { AuthService, type Principal, type RequestContext } from './auth.service';
import { clearSessionCookie, clientIp, setSessionCookie } from './cookies';
import { CurrentPrincipal, PrincipalGuard } from './current-user';
import { Public } from './public.decorator';

@Controller('auth')
@UseGuards(PrincipalGuard)
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get secureCookies(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  private context(req: Request): RequestContext {
    return { ip: clientIp(req), userAgent: req.header('user-agent') ?? null };
  }

  /** Registration and login are public by definition; the guard still resolves any existing cookie. */
  @Public()
  @Post('register')
  async register(@Body(zodBody(RegisterRequestSchema)) body: RegisterRequest, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthState> {
    const issued = await this.auth.register(body, this.context(req));
    setSessionCookie(res, issued.token, { secure: this.secureCookies, maxAgeSeconds: this.auth.sessionTtlSeconds });
    return issued.state;
  }

  @Public()
  @Post('login')
  async login(@Body(zodBody(LoginRequestSchema)) body: LoginRequest, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthState> {
    const issued = await this.auth.login(body, this.context(req));
    setSessionCookie(res, issued.token, { secure: this.secureCookies, maxAgeSeconds: this.auth.sessionTtlSeconds });
    return issued.state;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentPrincipal() principal: Principal, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(principal.session.id);
    clearSessionCookie(res, this.secureCookies);
  }

  @Get('me')
  me(@CurrentPrincipal() principal: Principal): AuthState {
    return this.auth.toState(principal);
  }

  @Post('password')
  async changePassword(@CurrentPrincipal() principal: Principal, @Body(zodBody(ChangePasswordRequestSchema)) body: ChangePasswordRequest): Promise<{ revokedSessions: number }> {
    const revokedSessions = await this.auth.changePassword(principal, body);
    return { revokedSessions };
  }
}
