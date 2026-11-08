import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export const SESSION_COOKIE = 'tutor_session';
const IS_PUBLIC = 'isPublic';

/** Opt a route out of the global auth guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthUser {
  id: string;
}

type AuthedRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new UnauthorizedException();
  return req.user;
});

/**
 * Global guard: every route requires a valid session unless marked @Public().
 * The JWT lives in an httpOnly cookie, so page scripts (and any XSS) cannot read it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];

    if (typeof token === 'string' && token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
        req.user = { id: payload.sub };
      } catch {
        // Invalid or expired token: treat as anonymous.
      }
    }
    if (isPublic) return true;
    if (!req.user)
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Please sign in' });
    return true;
  }
}
