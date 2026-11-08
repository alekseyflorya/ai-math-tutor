import { Body, Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  LocaleSchema,
  LoginSchema,
  RegisterSchema,
  UpdateMeSchema,
  type LoginInput,
  type RegisterInput,
  type UserView,
} from '@tutor/shared';
import { z } from 'zod';
import { AppConfig } from '../config/config.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { CurrentUser, Public, SESSION_COOKIE, type AuthUser } from './auth.guard';
import type { User } from '../db/schema';

const DemoSchema = z.object({ locale: LocaleSchema.default('en') });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserView> {
    return this.startSession(await this.auth.register(body), res);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserView> {
    return this.startSession(await this.auth.login(body), res);
  }

  /** Every click creates an isolated demo account; throttled so it can't be used to flood the DB. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  @HttpCode(200)
  @Post('demo')
  async demo(
    @Body(new ZodValidationPipe(DemoSchema)) body: z.infer<typeof DemoSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserView> {
    return this.startSession(await this.auth.createDemoUser(body.locale), res);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<UserView> {
    return this.auth.toView(await this.auth.getUser(user.id));
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateMeSchema)) body: z.infer<typeof UpdateMeSchema>,
  ): Promise<UserView> {
    return this.auth.toView(await this.auth.setLocale(user.id, body.locale));
  }

  private async startSession(user: User, res: Response): Promise<UserView> {
    const token = await this.auth.signSession(user);
    res.cookie(SESSION_COOKIE, token, {
      ...this.cookieOptions(),
      maxAge: this.config.get('JWT_TTL_DAYS') * 24 * 60 * 60 * 1000,
    });
    return this.auth.toView(user);
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE'),
      sameSite: 'lax' as const,
      path: '/',
    };
  }
}
